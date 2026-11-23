import { ZONE, ZONE_COUNT, CARD_COUNT, MODE_COUNT, SEAT_ABILITY_HEADS, cardUniqueId } from './zones.js';
import { syncBeliefFromState, createBelief } from './belief.js';

/** Scalar layout after 78 zone ids (each zone id as float 0..1). */
export const SCALAR = {
  PHASE_POUCH: 0,
  PHASE_DRAFT: 1,
  PHASE_TRICK: 2,
  PHASE_REWARD: 3,
  PHASE_ASCEND: 4,
  SELF_PATH: 5,
  SELF_SEQ: 6,
  SELF_DIGEST: 7,
  SELF_ABIL_USED: 8,
  SELF_MBREAK: 9,
  SELF_HAND_N: 10,
  SELF_POUCH_N: 11,
  OPP_PATH: 12,
  OPP_SEQ: 13,
  OPP_DIGEST: 14,
  OPP_ABIL_USED: 15,
  OPP_MBREAK: 16,
  OPP_HAND_N: 17,
  OPP_POUCH_N: 18,
  DECK_N: 19,
  GRAVE_N: 20,
  ROUND: 21,
  MY_TURN: 22,
  PENDING_TYPE: 23,
  LAST_ACTOR: 24,
  LAST_MODE: 25,
  LAST_CARD: 26,
  CAN_ASCEND: 27,
  TRUMP_ID: 28,
  SELF_SEQ_NORM: 29,
  OPP_SEQ_NORM: 30
};

export const SCALAR_SIZE = 40;
export const OBS_SIZE = CARD_COUNT + SCALAR_SIZE; // 78 zones + 40 scalars

const PENDING_CODE = {
  none: 0,
  INTERRUPT: 0.1,
  TARGET_CARD: 0.2,
  TARGET_CHAOS: 0.25,
  TARGET_ABILITY: 0.3,
  CHOOSE_DISCARD: 0.4,
  GAMBLE_SUIT: 0.5,
  DECK_REORDER: 0.6,
  FIGURINE_SWAP: 0.7,
  OTHER: 0.9
};

function phaseFlags(phase) {
  const p = String(phase || '').toUpperCase();
  return {
    pouch: p.includes('POUCH') ? 1 : 0,
    draft: p.includes('DRAFT') ? 1 : 0,
    trick: p === 'TRICK' || p.includes('TRICK') && !p.includes('REWARD') ? 1 : 0,
    reward: p.includes('REWARD') ? 1 : 0,
    ascend: p.includes('ASCEND') ? 1 : 0
  };
}

function pendingCode(pi) {
  if (!pi?.type) return PENDING_CODE.none;
  return PENDING_CODE[pi.type] ?? PENDING_CODE.OTHER;
}

/**
 * @param {object} state - { players, deck, grave, trumpCard, centerDraft, trickPlays, phase, round, pendingInteraction, lastAction, peekedDeck }
 * @param {number} viewerSeat
 * @param {object} [belief] - optional; synced from state if omitted
 */
export function extractAscentObs(state, viewerSeat, belief = null) {
  const b = belief || syncBeliefFromState(createBelief(), state, viewerSeat);
  if (belief) syncBeliefFromState(belief, state, viewerSeat);

  const vec = new Float32Array(OBS_SIZE);
  for (let i = 0; i < CARD_COUNT; i++) {
    vec[i] = (b.zones[i] || 0) / (ZONE_COUNT - 1);
  }

  const me = state.players?.[viewerSeat];
  const opp = (state.players || []).find(p => p.id !== viewerSeat) || null;
  const ph = phaseFlags(state.phase);
  const base = CARD_COUNT;
  const s = (idx, v) => { vec[base + idx] = v; };

  s(SCALAR.PHASE_POUCH, ph.pouch);
  s(SCALAR.PHASE_DRAFT, ph.draft);
  s(SCALAR.PHASE_TRICK, ph.trick);
  s(SCALAR.PHASE_REWARD, ph.reward);
  s(SCALAR.PHASE_ASCEND, ph.ascend);

  if (me) {
    s(SCALAR.SELF_PATH, (me.pathwayId || 0) / 21);
    s(SCALAR.SELF_SEQ, (me.seq ?? 9) / 9);
    s(SCALAR.SELF_SEQ_NORM, (me.seq ?? 9) / 9);
    s(SCALAR.SELF_DIGEST, me.actingDone ? 1 : 0);
    s(SCALAR.SELF_ABIL_USED, me.abilityUsed ? 1 : 0);
    s(SCALAR.SELF_MBREAK, (me.skipNextTurn || me.skippedThisRound) ? 1 : 0);
    s(SCALAR.SELF_HAND_N, Math.min(1, (me.hand?.length || 0) / 10));
    s(SCALAR.SELF_POUCH_N, Math.min(1, (me.pouch?.length || 0) / 3));
  }
  if (opp) {
    s(SCALAR.OPP_PATH, (opp.pathwayId || 0) / 21);
    s(SCALAR.OPP_SEQ, (opp.seq ?? 9) / 9);
    s(SCALAR.OPP_SEQ_NORM, (opp.seq ?? 9) / 9);
    s(SCALAR.OPP_DIGEST, opp.actingDone ? 1 : 0);
    s(SCALAR.OPP_ABIL_USED, opp.abilityUsed ? 1 : 0);
    s(SCALAR.OPP_MBREAK, (opp.skipNextTurn || opp.skippedThisRound) ? 1 : 0);
    s(SCALAR.OPP_HAND_N, Math.min(1, (opp.hand?.length || 0) / 10));
    s(SCALAR.OPP_POUCH_N, Math.min(1, (opp.pouch?.length || 0) / 3));
  }

  s(SCALAR.DECK_N, Math.min(1, (state.deck?.length || 0) / 78));
  s(SCALAR.GRAVE_N, Math.min(1, (state.grave?.length || 0) / 78));
  s(SCALAR.ROUND, Math.min(1, (state.round || 1) / 40));
  s(SCALAR.MY_TURN, state.toMove === viewerSeat ? 1 : 0);
  s(SCALAR.PENDING_TYPE, pendingCode(state.pendingInteraction));

  const la = state.lastAction || {};
  s(SCALAR.LAST_ACTOR, la.seat != null ? ((la.seat === viewerSeat) ? 0 : 1) : 0.5);
  s(SCALAR.LAST_MODE, (la.mode || 0) / Math.max(1, MODE_COUNT - 1));
  s(SCALAR.LAST_CARD, la.cardId != null && la.cardId >= 0 ? la.cardId / 77 : -0.05);

  const canAsc = !!(me && state.canAscend);
  s(SCALAR.CAN_ASCEND, canAsc ? 1 : 0);
  const tid = state.trumpCard ? cardUniqueId(state.trumpCard) : -1;
  s(SCALAR.TRUMP_ID, tid >= 0 ? tid / 77 : -0.05);

  return vec;
}

export { ZONE, ZONE_COUNT, CARD_COUNT };
