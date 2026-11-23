import { SUITS, getCardSuit, PATHWAYS } from '../data/constants.js';
import { getHandLimit, findValidAscensionSubset, evaluateTrickWinner } from '../utils/rules.js';
import { isFaceCard } from '../utils/cards.js';

/** Tactical per-card context for Medium/Hard CardId nets (outputs 39..49). */
function buildCardKeySigns(state, pId, candidates, phaseTag = 'trick') {
  const p = state?.players?.[pId];
  if (!p || !candidates?.length) return candidates?.map(() => new Array(11).fill(0)) || [];
  const leadPlay = state.trickPlays && state.trickPlays[0];
  const oppLeading = state.players
    ? state.players.filter(o => o.id !== p.id).sort((a, b) => a.seq - b.seq)[0]
    : null;
  return candidates.map(c => {
    const isMinor = c.type === 'minor';
    const completesNow = isMinor && (c.rank <= p.seq || c.rank === 10)
      && findValidAscensionSubset([...p.pouch, c], p.seq, p.mods) !== null;
    const isExact = isMinor && (c.rank === p.seq || (c.rank === 10 && (phaseTag !== 'pouch' || completesNow)));
    const isKey = isMinor && (isExact || completesNow);
    const isPair = isMinor && c.rank < p.seq && p.pouch.some(pc => pc.rank && pc.rank + c.rank === p.seq);
    const keyVal = isKey ? (phaseTag === 'trick' ? -2.2 : 2.0) : 0;
    const pairVal = isPair ? (phaseTag === 'trick' ? -1.0 : 1.2) : 0;
    const rankStr = isMinor && c.rank <= 10 ? (phaseTag === 'trick' ? c.rank / 10 : (c.rank <= p.seq ? 0.5 : -0.8)) : 0;
    const isTrump = state.trumpCard && getCardSuit(c) === getCardSuit(state.trumpCard)
      ? (phaseTag === 'trick' ? 1.0 : 0.4) : 0;
    const drawRescue = isMinor
      && ((c.suit === 'pentacles') || (c.suit === 'cups' && (state.grave?.length || 0) > 0))
      && p.hand.length <= 4 ? 1.2 : 0;
    const defReserve = isMinor && (c.rank === 11 || c.rank === 12 || c.rank === 13) && phaseTag === 'trick' ? 1.8 : 0;
    let canWin = 0;
    if (phaseTag === 'trick' && isMinor && c.rank !== 14) {
      if (leadPlay) {
        const simPlay = {
          playerId: p.id, card: c,
          effValue: Math.min(10, (c.rank <= 10 ? c.rank : 0) + (p.mods?.trickBonus || 0)),
          effSuit: c.suit, isTenOverride: c.rank === 10
        };
        const w = evaluateTrickWinner([...state.trickPlays, simPlay], state.trumpCard, state.roundMods || {});
        canWin = (w && w.playerId === p.id) ? 1.2 : -0.4;
      } else if (c.rank === 10 || (state.trumpCard && getCardSuit(c) === getCardSuit(state.trumpCard)
        && (c.type === 'major' || c.rank >= 6))) {
        canWin = 0.6;
      }
    }
    let disrupt = 0;
    if (phaseTag === 'trick' && isMinor && oppLeading) {
      if (c.suit === 'swords' && oppLeading.pouch.length >= 1) disrupt = oppLeading.pouch.length >= 2 ? 1.4 : 0.8;
      else if (c.suit === 'wands' && oppLeading.hand.length <= 3) disrupt = 1.2;
      else if (c.rank === 14 && oppLeading.hand.length >= 3) disrupt = 0.9;
    }
    const nextLook = (phaseTag !== 'trick' && isMinor && p.seq > 1 && c.rank <= p.seq - 1) ? 0.7 : 0;
    const exactVal = isExact ? (phaseTag === 'trick' ? -2.0 : 1.8) : 0;
    let endgameHoard = 0;
    if (isMinor) {
      if (c.rank === 10) endgameHoard = phaseTag === 'trick' ? -2.4 : (phaseTag === 'draft' ? 2.4 : (completesNow ? 2.5 : -1.5));
      else if (c.rank === 1) endgameHoard = phaseTag === 'trick' ? -2.2 : (phaseTag === 'draft' ? 2.0 : (p.seq === 1 ? 2.5 : -0.6));
      else if (c.rank === 2 && p.seq >= 2) endgameHoard = phaseTag === 'trick' ? -1.4 : (phaseTag === 'draft' ? 1.3 : (p.seq === 2 ? 2.0 : -0.3));
      else if (c.rank === 3 && p.seq >= 3) endgameHoard = phaseTag === 'trick' ? -0.9 : (phaseTag === 'draft' ? 0.9 : 0);
      if (c.suit === 'cups' && state.grave?.[0]?.type === 'minor' && state.grave[0].rank <= Math.min(3, p.seq)) {
        endgameHoard += (phaseTag === 'trick' || phaseTag === 'draft') ? 2.0 : 0;
      }
    }
    return [keyVal, pairVal, rankStr, isTrump, drawRescue, defReserve, canWin, disrupt, nextLook, exactVal, endgameHoard];
  });
}

function extractBoardFeatures(state, pId, handLimitMode) {
  const p = state?.players?.[pId];
  if (!p) return new Array(16).fill(0);
  const opps = state.players.filter(o => o.id !== pId);
  const cap = getHandLimit(p.seq, handLimitMode);
  const canAsc = findValidAscensionSubset(p.pouch, p.seq, p.mods) !== null ? 1 : 0;
  const bestOppSeq = opps.length ? Math.min(...opps.map(o => o.seq)) : 9;
  const avgOppHand = opps.length ? opps.reduce((a, o) => a + o.hand.length, 0) / opps.length : 5;
  const avgOppPouch = opps.length ? opps.reduce((a, o) => a + o.pouch.length, 0) / opps.length : 1;
  const majorCnt = p.hand.filter(c => c.type === 'major').length;
  return [
    p.seq / 9,
    Math.min(1, p.hand.length / 10),
    p.pouch.length / 3,
    p.actingDone ? 1 : 0,
    Math.min(1, (p.abilityCastsThisSeq || 0) / 3),
    canAsc,
    Math.min(1, state.deck.length / 78),
    Math.min(1, state.grave.length / 78),
    (state.trumpCard?.rank || 5) / 14,
    (state.trickPlays[0]?.card?.rank || 0) / 10,
    bestOppSeq / 9,
    Math.min(1, avgOppHand / 10),
    avgOppPouch / 3,
    Math.min(1, state.round / 25),
    cap / 10,
    Math.min(1, majorCnt / 3)
  ];
}

// Unique 0..77 Card ID mapping: S1..S14 (0-13), W1..W14 (14-27), P1..P14 (28-41), C1..C14 (42-55), X0..X21 (56-77)
function getCardUniqueId(c) {
  if (!c) return -1;
  if (c.type === 'major') return 56 + (c.majorId || 0);
  const sIdx = SUITS.indexOf(c.suit);
  if (sIdx === -1) return -1;
  return sIdx * 14 + Math.max(0, Math.min(13, (c.rank || 1) - 1));
}

// 72-Input Compact Factorized Feature Extractor (Clear, Non-Sparse Card + Zone + Opponent Visibility):
// [0..13]  14 Hand Rank counts (A..K)
// [14..17] 4 Hand Suit counts (Swd, Wnd, Pnt, Cup)
// [18..28] 11 Bipolar Major Arcana visibility (+1 for Major 2k, -1 for Major 2k+1, 0 unknown)
// [29..42] 14 Pouch (+1) & Market/Trump (+0.5) Rank indicators
// [43..46] 4 Top-5 Grave Suit counts
// [47..50] 4 Known Top-5 Deck / Revealed Opp Hand Suit hints
// [51..55] 5 Pathway & Sequence context (pathwayId/21, seq/9, canAscend, actingDone, casts/3)
// [56..71] 16 Board Scalars (Hand, Cap, Pouch, Deck, Grave, Trump, Lead, Opp Seqs/Hands, Round/50)
const NN_HIGH_VAL_ABILITY_TAGS = new Set([
  'draw_2', 'omniscient_eye', 'author_coincidence', 'life_giver', 'white_angel', 'reboot_trick',
  'steal_trump_hand', 'steal_pouch_safe', 'crimson_moon', 'reaper_strike', 'devil_desire',
  'filthy_monarch', 'hijack_trump', 'steal_time', 'undying_revive', 'pale_emperor',
  'soul_harvest', 'grave_best_to_hand', 'witch_burn', 'tsunami_aoe', 'plague_aoe', 'catastrophe_aoe',
  'pleasure_gift', 'pleasure_gift', 'student_deduce', 'mysticism_cycle', 'telepathist_reveal', 'copy_ability', 'grafting', 'prisoner_restraint'
]);

// Schema v2 feature width: 88 base + 2 race/ability + 22 Chaos-in-hand = 112
export const CARD_ID_FEATURE_SIZE = 112;
export const NN_SCHEMA_VERSION = 2;

function extractCardIdFeatures(state, pId, handLimitMode, phaseTag = 'trick') {
  const vec = new Float32Array(CARD_ID_FEATURE_SIZE);
  const p = state?.players?.[pId];
  if (!p) return vec;

  // Hand Ranks [0..13], Suits [14..17], and 11 Bipolar Major Arcana [18..28]
  for (const c of p.hand) {
    if (c.type === 'minor') {
      const rIdx = Math.max(0, Math.min(13, (c.rank || 1) - 1));
      vec[rIdx] = Math.min(1, vec[rIdx] + 0.35);
      const sIdx = SUITS.indexOf(c.suit);
      if (sIdx >= 0) vec[14 + sIdx] = Math.min(1, vec[14 + sIdx] + 0.25);
    } else if (c.type === 'major') {
      const pairIdx = Math.floor((c.majorId || 0) / 2);
      vec[18 + pairIdx] = (c.majorId % 2 === 0) ? 1.0 : -1.0;
    }
  }

  // Market / Trump [29..42] (+0.5) & Pouch (+1.0)
  const market = [...(state.centerDraft || []), ...(state.trumpCard ? [state.trumpCard] : [])];
  for (const c of market) {
    if (c.type === 'minor') {
      const rIdx = Math.max(0, Math.min(13, (c.rank || 1) - 1));
      vec[29 + rIdx] = Math.max(vec[29 + rIdx], 0.5);
    } else if (c.type === 'major') {
      const pairIdx = Math.floor((c.majorId || 0) / 2);
      if (vec[18 + pairIdx] === 0) vec[18 + pairIdx] = (c.majorId % 2 === 0) ? 0.5 : -0.5;
    }
  }
  for (const c of p.pouch) {
    if (c.type === 'minor') {
      const rIdx = Math.max(0, Math.min(13, (c.rank || 1) - 1));
      vec[29 + rIdx] = 1.0;
    }
  }

  // Top-5 Grave Suits [43..46]
  for (const c of (state.grave || []).slice(0, 5)) {
    const sIdx = SUITS.indexOf(c.suit);
    if (sIdx >= 0) vec[43 + sIdx] = Math.min(1, vec[43 + sIdx] + 0.25);
  }

  // Known Top-5 Deck & Revealed Opp Hand Suits [47..50]
  const knownCards = [
    ...(state.knownDeckIds ? (state.deck || []).slice(0, 5).filter(c => state.knownDeckIds.has(c.uid)) : []),
    ...(state.revealedOppCards || [])
  ];
  for (const c of knownCards) {
    const sIdx = SUITS.indexOf(c.suit);
    if (sIdx >= 0) vec[47 + sIdx] = Math.min(1, vec[47 + sIdx] + 0.35);
  }

  // Pathway & Sequence context [51..55]
  vec[51] = (p.pathwayId || 0) / 21;
  vec[52] = p.seq / 9;
  vec[53] = findValidAscensionSubset(p.pouch, p.seq, p.mods) ? 1.0 : 0.0;
  vec[54] = p.actingDone ? 1.0 : 0.0;
  vec[55] = Math.min(1, (p.abilityCastsThisSeq || 0) / 3);

  // 16 Board Scalars [56..71]
  const scalars = extractBoardFeatures(state, pId, handLimitMode);
  for (let i = 0; i < 16; i++) vec[56 + i] = scalars[i];
  // 4 Explicit Phase Context Bits [72..75] (Pouch, Draft, Trick, Ascend)
  vec[72] = phaseTag === 'pouch' ? 1.0 : 0.0;
  vec[73] = phaseTag === 'draft' ? 1.0 : 0.0;
  vec[74] = phaseTag === 'trick' ? 1.0 : 0.0;
  vec[75] = phaseTag === 'ascend' ? 1.0 : 0.0;

  // Per-Opponent Targeting Features [76..84] (3 Opponents x [seq/9, hand/10, pouch/3]) so selectTarget outputs [36..38] see each rival!
  const opps = (state.players || []).filter(o => o.id !== pId && !o.skippedThisRound);
  for (let k = 0; k < 3; k++) {
    const o = opps[k];
    if (o) {
      vec[76 + k * 3] = (o.seq || 0) / 9;
      vec[77 + k * 3] = Math.min(1, (o.hand?.length || 0) / 10);
      vec[78 + k * 3] = Math.min(1, (o.pouch?.length || 0) / 3);
    }
  }

  // 3 Tactical Decision Context Bits [85..87]: Free 1st Cast, High-Value Ability, Trump-Is-Ascension-Key
  const curTag = PATHWAYS[p.pathwayId]?.seqs[p.seq]?.tag || '';
  vec[85] = !p.actingDone ? 1.0 : 0.0;
  vec[86] = NN_HIGH_VAL_ABILITY_TAGS.has(curTag) ? 1.0 : 0.0;
  const tc = state.trumpCard;
  vec[87] = (tc && tc.type === 'minor' && (tc.rank === 10 || tc.rank === 1 || tc.rank === p.seq || !!findValidAscensionSubset([...p.pouch, tc], p.seq, p.mods))) ? 1.0 : 0.0;

  // Schema v2 [88..111]: identity among all 198 Sequence abilities + 22 Chaos Event presence
  // Ability index = pathwayId * 9 + (9 - seq)  → 0..197
  const abilityIdx = Math.max(0, Math.min(197, (p.pathwayId || 0) * 9 + Math.max(0, 9 - (p.seq || 9))));
  vec[88] = abilityIdx / 197;
  const bestOpp = (state.players || []).filter(o => o.id !== pId).reduce((m, o) => Math.min(m, o.seq ?? 9), 9);
  vec[89] = Math.max(-1, Math.min(1, ((p.seq || 9) - bestOpp) / 9)); // race gap (negative = ahead)
  for (const c of p.hand) {
    if (c.type === 'major') {
      const mid = Math.max(0, Math.min(21, c.majorId || 0));
      vec[90 + mid] = 1.0;
    }
  }
  return vec;
}

// Card-ID nets: Medium 112×64×51 (schema 2) · Hard 112×160×51 (schema 3)
// Outputs:
//  [0..13]  14 Rank scores (A..K)
//  [14..17] 4 Suit scores (Swd, Wnd, Pnt, Cup)
//  [18..28] 11 Bipolar Major Arcana scores (+ for 2k, - for 2k+1)
//  [29..35] 7 Explicit Actions (29:SeqAbility, 30:Chaos, 31:Gamble, 32:RecklessAsc, 33:TuckYes, 34:UnclogPouch, 35:Interrupt)

export {
  extractBoardFeatures,
  getCardUniqueId,
  NN_HIGH_VAL_ABILITY_TAGS,
  extractCardIdFeatures,
  buildCardKeySigns
};
