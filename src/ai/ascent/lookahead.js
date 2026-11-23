import { extractAscentObs } from './obs.js';
import { getLegalActions } from './legal.js';
import { beliefHasOppInstantThreat } from './belief.js';
import { MODE } from './zones.js';

const DEFAULT_DEPTH = 5;
const BEAM = 2;

function cloneState(state) {
  const { rng, beliefs, traj, ...rest } = state;
  const c = JSON.parse(JSON.stringify(rest));
  c.rng = rng || Math.random;
  // Fresh beliefs from cloned public state (avoid mutating live Int8Arrays)
  c.beliefs = beliefs;
  return c;
}

/**
 * Depth-limited search. Opp interrupt branches only if belief shows threat card in opp hand.
 */
export function chooseWithLookahead(net, state, seat, belief, applyFn, exploreRate = 0, depth = DEFAULT_DEPTH) {
  const legal = getLegalActions(state, seat);
  if (!legal.length) return { action: { mode: MODE.PASS }, legal: [], idx: 0 };
  if (legal.length === 1) return { action: legal[0], legal, idx: 0 };

  const obs = extractAscentObs(state, seat, belief);
  // Wide sets or depth≤1: policy only (keeps browser training from freezing)
  if (legal.length > 12 || depth <= 1) {
    const scoredQuick = net.scoreActions(obs, legal, exploreRate);
    return { action: legal[scoredQuick.bestIdx], legal, idx: scoredQuick.bestIdx, value: scoredQuick.value };
  }
  const scored = net.scoreActions(obs, legal, 0);
  const order = legal.map((_, i) => i).sort((a, b) => scored.scores[b] - scored.scores[a]);
  const beam = order.slice(0, Math.min(BEAM, order.length));

  let bestIdx = beam[0];
  let bestVal = -Infinity;

  for (const idx of beam) {
    try {
      const st = cloneState(state);
      const reward = { v: 0 };
      applyFn(st, seat, legal[idx], reward);
      const v = expectimax(net, st, seat, belief, applyFn, depth - 1, reward);
      const rootPrior = scored.scores[idx] * 0.05;
      if (v + rootPrior > bestVal) {
        bestVal = v + rootPrior;
        bestIdx = idx;
      }
    } catch (_) {
      /* skip broken branch */
    }
  }

  let pick = bestIdx;
  if (exploreRate > 0 && Math.random() < exploreRate) {
    pick = beam[Math.floor(Math.random() * beam.length)];
  }
  return { action: legal[pick], legal, idx: pick, value: bestVal };
}

function expectimax(net, state, rootSeat, belief, applyFn, depth, rewardAcc) {
  if (depth <= 0 || state.winnerId != null) {
    const obs = extractAscentObs(state, rootSeat, belief);
    const h = net.encode(obs);
    // Ascent-shaped leaf: value + seq progress
    const me = state.players?.[rootSeat];
    const opp = (state.players || []).find(p => p.id !== rootSeat);
    const seqTerm = me ? (9 - (me.seq ?? 9)) / 9 : 0;
    const oppPen = opp ? (9 - (opp.seq ?? 9)) / 9 : 0;
    return net.valueOf(h) + seqTerm * 1.4 - oppPen * 0.9 + (rewardAcc?.v || 0);
  }

  const toMove = state.toMove;
  if (toMove == null) {
    const obs = extractAscentObs(state, rootSeat, belief);
    return net.valueOf(net.encode(obs));
  }

  // Belief-gated: if evaluating opp reply after our attack, skip instant branches without threat
  if (state.awaitingInterrupt && toMove !== rootSeat) {
    const threat = beliefHasOppInstantThreat(belief, {
      swords: state.awaitingInterrupt === 'sword',
      wands: state.awaitingInterrupt === 'wand',
      anyMajor: true
    });
    if (!threat) {
      // Force pass
      const st = cloneState(state);
      st.awaitingInterrupt = null;
      st.toMove = state.resumeToMove ?? rootSeat;
      return expectimax(net, st, rootSeat, belief, applyFn, depth - 1, rewardAcc);
    }
  }

  const legal = getLegalActions(state, toMove);
  if (!legal.length) return expectimax(net, state, rootSeat, belief, applyFn, depth - 1, rewardAcc);

  const obs = extractAscentObs(state, toMove, belief);
  const scored = net.scoreActions(obs, legal, 0);
  const order = legal.map((_, i) => i).sort((a, b) => scored.scores[b] - scored.scores[a]);
  const beam = order.slice(0, Math.min(BEAM, order.length));

  if (toMove === rootSeat) {
    let best = -Infinity;
    for (const idx of beam) {
      const st = cloneState(state);
      const r = { v: rewardAcc?.v || 0 };
      applyFn(st, toMove, legal[idx], r);
      const v = expectimax(net, st, rootSeat, belief, applyFn, depth - 1, r);
      if (v > best) best = v;
    }
    return best;
  }

  // Opp: average top beam (expectimax)
  let sum = 0;
  for (const idx of beam) {
    const st = cloneState(state);
    const r = { v: rewardAcc?.v || 0 };
    applyFn(st, toMove, legal[idx], r);
    sum += expectimax(net, st, rootSeat, belief, applyFn, depth - 1, r);
  }
  return sum / beam.length;
}
