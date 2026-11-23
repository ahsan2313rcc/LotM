import { SUITS, getCardSuit } from '../data/constants.js';
import { getHandLimit } from '../utils/rules.js';

/** Visible card identity 0..77 (suit/rank or major id). Empty = -1. No effect knowledge. */
export function cardId(c) {
  if (!c) return -1;
  if (c.type === 'major') return 56 + Math.max(0, Math.min(21, c.majorId || 0));
  const sIdx = SUITS.indexOf(c.suit);
  if (sIdx < 0) return -1;
  return sIdx * 14 + Math.max(0, Math.min(13, (c.rank || 1) - 1));
}

export const CARD_VOCAB = 78;
export const META_COUNT = 8; // cast, chaos, gamble, recklessAsc, tuck, unclog, interrupt, draftPreferAsc
export const OBS_SIZE = 72;

/**
 * Observation = only what a seat can see publicly / privately.
 * No "this card wins the trick", ability-value tags, or rule encodings.
 */
export function extractObservation(state, pId, handLimitMode = '10-7', phaseTag = 'trick') {
  const vec = new Float32Array(OBS_SIZE);
  const p = state?.players?.[pId];
  if (!p) return vec;

  // [0..3] phase
  vec[0] = phaseTag === 'pouch' ? 1 : 0;
  vec[1] = phaseTag === 'draft' ? 1 : 0;
  vec[2] = phaseTag === 'trick' ? 1 : 0;
  vec[3] = phaseTag === 'ascend' ? 1 : 0;

  // [4..10] self public+private scalars
  vec[4] = (p.pathwayId || 0) / 21;
  vec[5] = (p.seq ?? 9) / 9;
  vec[6] = p.actingDone ? 1 : 0;
  vec[7] = p.abilityUsed ? 1 : 0;
  vec[8] = Math.min(1, (p.abilityCastsThisSeq || 0) / 3);
  vec[9] = Math.min(1, (p.hand?.length || 0) / 10);
  vec[10] = Math.min(1, (p.pouch?.length || 0) / 3);

  // [11..14] table sizes / progress
  const cap = getHandLimit(p.seq, handLimitMode);
  vec[11] = Math.min(1, (state.deck?.length || 0) / 78);
  vec[12] = Math.min(1, (state.grave?.length || 0) / 78);
  vec[13] = Math.min(1, (state.round || 1) / 40);
  vec[14] = cap / 10;

  // [15] trump identity (normalized id)
  vec[15] = cardId(state.trumpCard) >= 0 ? cardId(state.trumpCard) / 77 : -0.05;

  // [16..25] hand slots (up to 10) as identity / 77
  for (let i = 0; i < 10; i++) {
    const c = p.hand?.[i];
    vec[16 + i] = c ? cardId(c) / 77 : -0.05;
  }
  // [26..28] pouch slots
  for (let i = 0; i < 3; i++) {
    const c = p.pouch?.[i];
    vec[26 + i] = c ? cardId(c) / 77 : -0.05;
  }
  // [29..32] draft / market
  const market = state.centerDraft || [];
  for (let i = 0; i < 4; i++) {
    const c = market[i];
    vec[29 + i] = c ? cardId(c) / 77 : -0.05;
  }
  // [33..40] trick plays (seat + card) × 4
  const plays = state.trickPlays || [];
  for (let i = 0; i < 4; i++) {
    const pl = plays[i];
    vec[33 + i * 2] = pl ? ((pl.playerId ?? 0) / 3) : -0.05;
    vec[34 + i * 2] = pl?.card ? cardId(pl.card) / 77 : -0.05;
  }
  // [41..43] grave top 3 identities
  for (let i = 0; i < 3; i++) {
    const c = state.grave?.[i];
    vec[41 + i] = c ? cardId(c) / 77 : -0.05;
  }
  // [44..58] up to 3 opponents × 5 public fields
  const opps = (state.players || []).filter(o => o.id !== pId);
  for (let k = 0; k < 3; k++) {
    const o = opps[k];
    const base = 44 + k * 5;
    if (o) {
      vec[base] = (o.pathwayId || 0) / 21;
      vec[base + 1] = (o.seq ?? 9) / 9;
      vec[base + 2] = Math.min(1, (o.hand?.length || 0) / 10);
      vec[base + 3] = Math.min(1, (o.pouch?.length || 0) / 3);
      vec[base + 4] = (o.skippedThisRound || o.inactive) ? 1 : 0;
    } else {
      vec[base] = vec[base + 1] = vec[base + 2] = vec[base + 3] = vec[base + 4] = -0.05;
    }
  }
  // [59..71] spare / counts
  vec[59] = opps.length / 3;
  vec[60] = plays.length / 4;
  vec[61] = market.length / 4;
  vec[62] = state.trumpCard ? (getCardSuit(state.trumpCard) === 'major' ? 1 : SUITS.indexOf(getCardSuit(state.trumpCard)) / 3) : -0.05;
  vec[63] = p.skipNextTurn ? 1 : 0;
  // leave 64..71 zero as growth room
  return vec;
}

export function getCardUniqueId(c) {
  return cardId(c);
}
