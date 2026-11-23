import { extractAscentObs } from './obs.js';
import { MODE } from './zones.js';

const BEAM = 3;

function cloneMock(state) {
  return JSON.parse(JSON.stringify(state));
}

/** Light apply for lookahead value — card leaves hand / center; meta is a no-op on board. */
function lightApply(state, seat, action) {
  const p = state.players?.[seat];
  if (!p || !action) return;
  if (action.cardUid) {
    const fromHand = (p.hand || []).findIndex(c => c.uid === action.cardUid);
    if (fromHand >= 0) {
      const [c] = p.hand.splice(fromHand, 1);
      if (action.mode === MODE.TUCK) p.pouch = p.pouch || [], p.pouch.push(c);
      else if (action.mode === MODE.DRAFT) { /* already leaving center */ }
      else {
        state.trickPlays = state.trickPlays || [];
        state.trickPlays.push({ playerId: seat, card: c });
      }
    } else if (state.centerDraft) {
      const i = state.centerDraft.findIndex(c => c.uid === action.cardUid);
      if (i >= 0) p.hand.push(state.centerDraft.splice(i, 1)[0]);
    }
  }
  // Crude turn pass for 2P value
  const n = state.players?.length || 2;
  state.toMove = (seat + 1) % n;
}

function leafValue(net, state, rootSeat) {
  const obs = extractAscentObs(state, rootSeat);
  const h = net.encode(obs);
  const me = state.players?.[rootSeat];
  const opp = (state.players || []).find(x => x.id !== rootSeat);
  const seqTerm = me ? (9 - (me.seq ?? 9)) / 9 : 0;
  const oppPen = opp ? (9 - (opp.seq ?? 9)) / 9 : 0;
  return net.valueOf(h) + seqTerm * 1.35 - oppPen * 0.85;
}

function expectimax(net, state, rootSeat, depth) {
  if (depth <= 0) return leafValue(net, state, rootSeat);
  const seat = state.toMove ?? rootSeat;
  // Opponent / next: just leaf (fast). Deeper search only expands root beam.
  if (seat !== rootSeat) return leafValue(net, state, rootSeat);
  return leafValue(net, state, rootSeat);
}

/**
 * Choose among legal ascent actions with optional lookahead depth (1 = policy only).
 * @returns {{ bestIdx: number, scores: number[], value: number }}
 */
export function ascentChoose(net, mockState, seat, legal, exploreRate = 0, lookaheadDepth = 1) {
  const phase = mockState.phase || 'TRICK';
  const obs = extractAscentObs({ ...mockState, phase, toMove: seat }, seat);
  if (!legal?.length) return { bestIdx: 0, scores: [], value: 0 };

  const depth = Math.max(1, Math.min(5, Number(lookaheadDepth) || 1));
  const scored = net.scoreActions(obs, legal, 0);

  if (depth <= 1 || legal.length === 1) {
    const { bestIdx, scores, value } = net.scoreActions(obs, legal, exploreRate);
    return { bestIdx, scores, value };
  }

  const order = legal.map((_, i) => i).sort((a, b) => scored.scores[b] - scored.scores[a]);
  const beam = order.slice(0, Math.min(BEAM, order.length));
  let bestIdx = beam[0];
  let bestVal = -Infinity;

  for (const idx of beam) {
    try {
      const st = cloneMock({ ...mockState, phase, toMove: seat, players: mockState.players });
      // ensure players are deep-copied
      st.players = mockState.players.map(p => ({
        ...p,
        hand: [...(p.hand || [])],
        pouch: [...(p.pouch || [])],
        mods: { ...(p.mods || {}) }
      }));
      st.centerDraft = mockState.centerDraft ? [...mockState.centerDraft] : [];
      st.trickPlays = mockState.trickPlays ? [...mockState.trickPlays] : [];
      lightApply(st, seat, legal[idx]);
      const v = expectimax(net, st, seat, depth - 1) + scored.scores[idx] * 0.08;
      if (v > bestVal) {
        bestVal = v;
        bestIdx = idx;
      }
    } catch (_) { /* skip */ }
  }

  if (exploreRate > 0 && Math.random() < exploreRate) {
    bestIdx = beam[Math.floor(Math.random() * beam.length)];
  }
  return { bestIdx, scores: scored.scores, value: bestVal };
}
