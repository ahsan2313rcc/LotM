/**
 * Bridge: headless/live state → fogged obs + legal action vectors for PolicyNet.
 * Matches python_train/lotm_env/obs.py compact layout (small=180/32, medium=650/48).
 */
import { findValidAscensionSubset } from '../utils/rules.js';

export const AT = {
  PASS: 0, TUCK: 1, DRAFT: 2, PLAY: 3, ASCEND: 4, TAKE_TRUMP: 5, GAMBLE: 6, DONE: 7
};

const SUITS = ['swords', 'wands', 'pentacles', 'cups'];

export function cardId(c) {
  if (!c) return -1;
  if (c.type === 'major') return 56 + Math.max(0, Math.min(21, c.majorId ?? 0));
  const s = SUITS.indexOf(c.suit);
  if (s < 0) return -1;
  return s * 14 + Math.max(0, Math.min(13, (c.rank || 1) - 1));
}

function encodeAction(kind, card = null, targetRel = -1, extra = 0, actDim = 32) {
  const v = new Float32Array(actDim);
  if (kind >= 0 && kind < 8) v[kind] = 1;
  if (card) {
    const cid = cardId(card);
    v[8] = cid / 77;
    if (card.type === 'major') {
      v[9] = 1;
      v[10] = (card.majorId || 0) / 21;
    } else {
      const si = SUITS.indexOf(card.suit);
      if (si >= 0) v[11 + si] = 1;
      v[15] = (card.rank || 0) / 14;
      if (card.rank && card.rank <= 10) v[16] = card.rank / 10;
      if (card.rank === 12 || card.rank === 13) v[17] = 1;
    }
  }
  if (targetRel >= 0) v[18 + Math.min(targetRel, 2)] = 1;
  v[21] = extra;
  return v;
}

function multiHot(cards, dim = 78) {
  const v = new Float32Array(dim);
  for (const c of cards || []) {
    const i = cardId(c);
    if (i >= 0 && i < dim) v[i] = 1;
  }
  return v;
}

/** Compact 180-d fogged obs (small tier). */
export function foggedObsSmall(state, seat) {
  const players = state.players;
  const me = players[seat];
  const opp = players[1 - seat] || players[(seat + 1) % players.length];
  const phase = String(state.phase || 'TRICK');
  const v = new Float32Array(180);
  v[0] = (me.hand?.length || 0) / 10;
  v[1] = (me.pouch?.length || 0) / 5;
  v[2] = (me.seq ?? 9) / 9;
  v[3] = me.actingDone ? 1 : 0;
  v[4] = me.abilityUsed ? 1 : 0;
  v[5] = (me.pathwayId ?? 0) / 21;
  v[6] = (opp?.seq ?? 9) / 9;
  v[7] = (opp?.hand?.length || 0) / 10;
  v[8] = (opp?.pouch?.length || 0) / 5;
  v[9] = (opp?.pathwayId ?? 0) / 21;
  v[10] = (state.round || 1) / Math.max(1, state.maxRounds || 50);
  v[11] = (state.deck?.length || 0) / 78;
  v[12] = (state.grave?.length || 0) / 78;
  for (const [i, p] of ['POUCH', 'DRAFT', 'TRICK', 'REWARD', 'ASCEND'].entries()) {
    if (phase.includes(p)) v[13 + i] = 1;
  }
  for (const c of me.hand || []) {
    if (c.type === 'minor' && c.rank) v[18 + Math.min(13, c.rank - 1)] += 0.15;
    else if (c.type === 'major') v[32] += 0.2;
  }
  for (const c of me.pouch || []) {
    if (c.type === 'minor' && c.rank && c.rank <= 10) v[33 + c.rank - 1] += 0.2;
  }
  v[44] = findValidAscensionSubset(me.pouch || [], me.seq, me.mods || {}) ? 1 : 0;
  v[45] = state.toMove === seat ? 1 : 0;
  if (state.trumpCard) v[46] = cardId(state.trumpCard) / 77;
  v[47] = (state.centerDraft?.length || 0) / 5;
  v[48] = (state.trickPlays?.length || 0) / 4;
  for (const c of me.hand || []) {
    if (c.type === 'minor') {
      const si = SUITS.indexOf(c.suit);
      if (si >= 0) v[49 + si] += 0.2;
    }
  }
  for (const c of [...(me.hand || []), ...(me.pouch || [])]) {
    const idx = 60 + (cardId(c) % 100);
    if (idx < 180) v[idx] = 1;
  }
  return v;
}

export function foggedObsMedium(state, seat) {
  const players = state.players;
  const me = players[seat];
  const opp = players[1 - seat] || players[(seat + 1) % players.length];
  const phase = String(state.phase || 'TRICK');
  const v = new Float32Array(650);
  v.set(multiHot(me.hand), 0);
  v.set(multiHot(me.pouch), 78);
  v[156] = (me.seq ?? 9) / 9;
  v[157] = me.actingDone ? 1 : 0;
  v[158] = (me.pathwayId ?? 0) / 21;
  v[159] = (opp?.seq ?? 9) / 9;
  v[160] = (opp?.hand?.length || 0) / 10;
  v[161] = (opp?.pouch?.length || 0) / 5;
  v[162] = (opp?.pathwayId ?? 0) / 21;
  v[163] = (state.round || 1) / Math.max(1, state.maxRounds || 50);
  v[164] = (state.deck?.length || 0) / 78;
  v[165] = (state.grave?.length || 0) / 78;
  for (const [i, p] of ['POUCH', 'DRAFT', 'TRICK', 'REWARD', 'ASCEND'].entries()) {
    if (phase.includes(p)) v[166 + i] = 1;
  }
  v[171] = state.toMove === seat ? 1 : 0;
  v[172] = findValidAscensionSubset(me.pouch || [], me.seq, me.mods || {}) ? 1 : 0;
  if (state.trumpCard) {
    const tid = cardId(state.trumpCard);
    if (tid >= 0) v[173 + tid] = 1;
  }
  v.set(multiHot(state.centerDraft), 251);
  v.set(multiHot((state.grave || []).slice(0, 40)), 329);
  v[485] = (me.hand?.length || 0) / 10;
  v[486] = (me.pouch?.length || 0) / 5;
  v[487] = me.abilityUsed ? 1 : 0;
  return v;
}

export function foggedObs(state, seat, tier = 'small') {
  return tier === 'medium' ? foggedObsMedium(state, seat) : foggedObsSmall(state, seat);
}

/**
 * Build legal candidates for a decision context used by headless card/meta picks.
 * context: 'draft' | 'trick' | 'pouch' | 'ascend' | 'meta_yesno'
 */
export function legalCandidates(state, seat, context, payload = {}, actDim = 32) {
  const me = state.players[seat];
  const out = [];
  if (context === 'draft') {
    for (const c of payload.candidates || state.centerDraft || []) {
      out.push({ action: { type: 'draft', card: c }, vec: encodeAction(AT.DRAFT, c, -1, 0, actDim) });
    }
  } else if (context === 'trick' || context === 'pouch') {
    const kind = context === 'pouch' ? AT.TUCK : AT.PLAY;
    for (const c of payload.candidates || me.hand || []) {
      out.push({ action: { type: context, card: c }, vec: encodeAction(kind, c, 0, 0, actDim) });
    }
  } else if (context === 'ascend') {
    out.push({ action: { type: 'pass' }, vec: encodeAction(AT.PASS, null, -1, 0, actDim) });
    out.push({ action: { type: 'ascend' }, vec: encodeAction(AT.ASCEND, null, -1, me.actingDone ? 1 : 0.5, actDim) });
  } else if (context === 'meta_yesno') {
    out.push({ action: { type: 'no' }, vec: encodeAction(AT.PASS, null, -1, 0, actDim) });
    out.push({ action: { type: 'yes' }, vec: encodeAction(payload.yesKind || AT.PLAY, null, -1, 0, actDim) });
  } else if (context === 'target') {
    (payload.opps || []).forEach((o, i) => {
      out.push({ action: { type: 'target', opp: o }, vec: encodeAction(AT.PLAY, null, i, 0, actDim) });
    });
  }
  if (!out.length) out.push({ action: { type: 'pass' }, vec: encodeAction(AT.PASS, null, -1, 0, actDim) });
  return out;
}

export function policyPick(net, state, seat, context, payload = {}, tier = 'small') {
  if (!net) return null;
  const actDim = net.actDim || (tier === 'medium' ? 48 : 32);
  const obs = foggedObs(state, seat, tier);
  const cands = legalCandidates(state, seat, context, payload, actDim);
  const { index } = net.selectAction(obs, cands.map(c => c.vec), { stochastic: false });
  return cands[index]?.action ?? null;
}
