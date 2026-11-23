/**
 * Feature extractors for browser RL tiers:
 *   Small  16 · Medium 40 · Large 100
 */
import { SUITS, getCardSuit } from '../../data/constants.js';
import { getHandLimit, findValidAscensionSubset } from '../../utils/rules.js';

export const TIER_DIMS = {
  small: { inSize: 16, hidSize: 24, outSize: 8 },
  medium: { inSize: 40, hidSize: 48, outSize: 20 },
  large: { inSize: 100, hidSize: 96, outSize: 40 }
};

export function cardUidId(c) {
  if (!c) return -1;
  if (c.type === 'major') return 56 + (c.majorId ?? 0);
  const s = SUITS.indexOf(c.suit);
  if (s < 0) return -1;
  return s * 14 + Math.max(0, Math.min(13, (c.rank || 1) - 1));
}

/** Fogged zone for each of the 78 cards (Large card channels). */
export const CARD_LOC = {
  DECK_OR_UNKNOWN: 0, // deck or hidden (opp private)
  SELF_HAND: 1,
  SELF_POUCH: 2,
  OPP_HAND: 3,        // only when revealed / known
  OPP_POUCH: 4,       // only when revealed / known
  GRAVE: 5,
  TRUMP: 6,
  CENTER: 7           // center draft
};
export const CARD_LOC_N = 8;

function phaseOneHot(phase, n = 5) {
  const p = String(phase || '').toUpperCase();
  const v = new Array(n).fill(0);
  if (p.includes('POUCH')) v[0] = 1;
  else if (p.includes('DRAFT')) v[1] = 1;
  else if (p.includes('REWARD') || p.includes('GAMBLE')) v[3] = 1;
  else if (p.includes('ASCEND')) v[4] = 1;
  else v[2] = 1; // trick / default
  return v;
}

function phaseBucket(phase) {
  const ph = String(phase || 'TRICK').toUpperCase();
  if (ph.includes('POUCH')) return 'pp';
  if (ph.includes('DRAFT')) return 'pd';
  if (ph.includes('REWARD') || ph.includes('GAMBLE')) return 'pr';
  if (ph.includes('ASCEND')) return 'pa';
  if (ph.includes('INTERRUPT')) return 'pi';
  if (ph.includes('DISCARD')) return 'px';
  return 'pt';
}

function seqRelBucket(state, seat) {
  const p = state?.players?.[seat];
  const opp = (state.players || []).find(o => o.id !== seat);
  const mySeq = p?.seq ?? 9;
  const oppSeq = opp?.seq ?? 9;
  return mySeq < oppSeq ? 'lead' : mySeq > oppSeq ? 'trail' : 'same';
}

function trumpTypeBucket(state) {
  if (!state.trumpCard) return 'tnone';
  if (state.trumpCard.type === 'major') return 'tmaj';
  const s = getCardSuit(state.trumpCard) || state.trumpCard.suit;
  return s === 'swords' ? 'tS' : s === 'wands' ? 'tW' : s === 'pentacles' ? 'tP' : s === 'cups' ? 'tC' : 'tnone';
}

function roundBucket(round) {
  const r = round || 1;
  return r < 10 ? 're' : r < 20 ? 'rm' : 'rl';
}

function actingPairBucket(state, seat) {
  const p = state?.players?.[seat];
  const opp = (state.players || []).find(o => o.id !== seat);
  const a = p?.actingDone ? 1 : 0;
  const b = opp?.actingDone ? 1 : 0;
  return `a${a}${b}`; // 00,01,10,11
}

/**
 * Build fogged location map for all 78 cards from seat's POV.
 * Public zones (grave, trump, center) are known; opp hand/pouch only if revealed sets exist.
 */
export function buildCardLocations(state, seat) {
  const loc = new Uint8Array(78); // default 0 = deck/unknown
  const mark = (c, code) => {
    const id = cardUidId(c);
    if (id >= 0 && id < 78) loc[id] = code;
  };
  const me = state?.players?.[seat];
  const opp = (state.players || []).find(o => o.id !== seat);
  for (const c of me?.hand || []) mark(c, CARD_LOC.SELF_HAND);
  for (const c of me?.pouch || []) mark(c, CARD_LOC.SELF_POUCH);
  // Revealed opponent cards (optional arrays on state / player)
  const knownHand = state?.knownOppHands?.[opp?.id] || opp?.knownHand || [];
  const knownPouch = state?.knownOppPouches?.[opp?.id] || opp?.knownPouch || [];
  for (const c of knownHand) mark(c, CARD_LOC.OPP_HAND);
  for (const c of knownPouch) mark(c, CARD_LOC.OPP_POUCH);
  for (const c of state?.grave || []) mark(c, CARD_LOC.GRAVE);
  if (state?.trumpCard) mark(state.trumpCard, CARD_LOC.TRUMP);
  for (const c of state?.centerDraft || []) mark(c, CARD_LOC.CENTER);
  // Cards currently in the trick pile (treat as public / grave-bound)
  for (const tp of state?.trickPlays || []) {
    if (tp?.card) mark(tp.card, CARD_LOC.GRAVE);
  }
  return loc;
}

/** Small ~16: phase / seq / trump / tempo — mirrors classic Easy board vector. */
export function extractSmall(state, seat, handLimitMode = '10-7') {
  const p = state?.players?.[seat];
  if (!p) return new Array(16).fill(0);
  const opps = (state.players || []).filter(o => o.id !== seat);
  const cap = getHandLimit(p.seq, handLimitMode);
  const canAsc = findValidAscensionSubset(p.pouch || [], p.seq, p.mods || {}) ? 1 : 0;
  const bestOpp = opps.length ? Math.min(...opps.map(o => o.seq)) : 9;
  const avgHand = opps.length ? opps.reduce((a, o) => a + (o.hand?.length || 0), 0) / opps.length : 5;
  const avgPouch = opps.length ? opps.reduce((a, o) => a + (o.pouch?.length || 0), 0) / opps.length : 1;
  const majors = (p.hand || []).filter(c => c.type === 'major').length;
  const trumpR = state.trumpCard?.type === 'major' ? 0.75 : ((state.trumpCard?.rank || 5) / 14);
  return [
    (p.seq ?? 9) / 9,
    Math.min(1, (p.hand?.length || 0) / 10),
    (p.pouch?.length || 0) / 3,
    p.actingDone ? 1 : 0,
    Math.min(1, (p.abilityCastsThisSeq || p.ability_casts || 0) / 3),
    canAsc,
    Math.min(1, (state.deck?.length || 0) / 78),
    Math.min(1, (state.grave?.length || 0) / 78),
    trumpR,
    ((state.trickPlays?.[0]?.card?.rank) || 0) / 10,
    bestOpp / 9,
    Math.min(1, avgHand / 10),
    avgPouch / 3,
    Math.min(1, (state.round || 1) / 25),
    cap / 10,
    Math.min(1, majors / 3)
  ];
}

/**
 * Medium ~40: discrete board buckets (not raw card IDs).
 * Designed so memory hash ≈ same factors the net sees.
 */
export function extractMedium(state, seat, handLimitMode = '10-7') {
  const p = state?.players?.[seat];
  const v = new Array(40).fill(0);
  if (!p) return v;
  const opp = (state.players || []).find(o => o.id !== seat);
  const loc = buildCardLocations(state, seat);

  // 0-2 seq relative one-hot
  const rel = seqRelBucket(state, seat);
  if (rel === 'lead') v[0] = 1;
  else if (rel === 'same') v[1] = 1;
  else v[2] = 1;
  // 3-4 hand size
  v[(p.hand?.length || 0) >= 4 ? 4 : 3] = 1;
  // 5-6 pouch
  v[(p.pouch?.length || 0) > 0 ? 6 : 5] = 1;
  // 7-10 acting pair one-hot (self×opp)
  const ai = (p.actingDone ? 2 : 0) + (opp?.actingDone ? 1 : 0);
  v[7 + ai] = 1;
  // 11-16 phase (6)
  const pb = phaseBucket(state.phase);
  const phaseIdx = { pp: 0, pd: 1, pt: 2, pr: 3, pa: 4, pi: 5, px: 5 }[pb] ?? 2;
  v[11 + Math.min(5, phaseIdx)] = 1;
  // 17-19 round
  const rb = roundBucket(state.round);
  v[rb === 're' ? 17 : rb === 'rm' ? 18 : 19] = 1;
  // 20-25 trump type
  const tb = trumpTypeBucket(state);
  const tMap = { tS: 0, tW: 1, tP: 2, tC: 3, tmaj: 4, tnone: 5 };
  v[20 + (tMap[tb] ?? 5)] = 1;
  // 26-27 opp hand size bucket
  v[(opp?.hand?.length || 0) >= 4 ? 27 : 26] = 1;
  // 28-29 opp pouch
  v[(opp?.pouch?.length || 0) > 0 ? 29 : 28] = 1;
  // 30 can ascend
  v[30] = findValidAscensionSubset(p.pouch || [], p.seq, p.mods || {}) ? 1 : 0;
  // 31 has major in hand
  v[31] = (p.hand || []).some(c => c.type === 'major') ? 1 : 0;
  // 32 has face in hand
  v[32] = (p.hand || []).some(c => c.type === 'minor' && c.rank >= 11) ? 1 : 0;
  // 33 ability used
  v[33] = p.abilityUsed ? 1 : 0;
  // 34-36 zone occupancy summaries from 78-card map
  let selfH = 0, selfP = 0, graveN = 0, centerN = 0;
  for (let i = 0; i < 78; i++) {
    if (loc[i] === CARD_LOC.SELF_HAND) selfH++;
    else if (loc[i] === CARD_LOC.SELF_POUCH) selfP++;
    else if (loc[i] === CARD_LOC.GRAVE) graveN++;
    else if (loc[i] === CARD_LOC.CENTER) centerN++;
  }
  v[34] = Math.min(1, selfH / 10);
  v[35] = Math.min(1, selfP / 3);
  v[36] = graveN > 0 ? 1 : 0;
  v[37] = centerN > 0 ? 1 : 0;
  // 38-39 pathway coarse
  v[38] = (p.pathwayId ?? 0) / 21;
  v[39] = (opp?.pathwayId ?? 0) / 21;
  return v;
}

/**
 * Large ~100:
 *   [0..77]  = fogged location of each card id / 7  (78×8 discrete channels)
 *   [78..99] = meta buckets (seq, acting, phase, round, trump, …)
 */
export function extractLarge(state, seat, handLimitMode = '10-7') {
  const v = new Array(100).fill(0);
  const p = state?.players?.[seat];
  if (!p) return v;
  const opp = (state.players || []).find(o => o.id !== seat);
  const loc = buildCardLocations(state, seat);
  for (let i = 0; i < 78; i++) v[i] = (loc[i] || 0) / (CARD_LOC_N - 1);

  const rel = seqRelBucket(state, seat);
  v[78] = rel === 'lead' ? 1 : rel === 'same' ? 0.5 : 0;
  v[79] = (p.hand?.length || 0) >= 4 ? 1 : 0;
  v[80] = (p.pouch?.length || 0) > 0 ? 1 : 0;
  v[81] = p.actingDone ? 1 : 0;
  v[82] = opp?.actingDone ? 1 : 0;
  const pb = phaseBucket(state.phase);
  const phaseIdx = { pp: 0, pd: 1, pt: 2, pr: 3, pa: 4, pi: 5, px: 6 }[pb] ?? 2;
  v[83] = phaseIdx / 6;
  const rb = roundBucket(state.round);
  v[84] = rb === 're' ? 0 : rb === 'rm' ? 0.5 : 1;
  const tb = trumpTypeBucket(state);
  const tMap = { tS: 0, tW: 1, tP: 2, tC: 3, tmaj: 4, tnone: 5 };
  v[85] = (tMap[tb] ?? 5) / 5;
  v[86] = (opp?.hand?.length || 0) >= 4 ? 1 : 0;
  v[87] = (opp?.pouch?.length || 0) > 0 ? 1 : 0;
  v[88] = findValidAscensionSubset(p.pouch || [], p.seq, p.mods || {}) ? 1 : 0;
  v[89] = (p.hand || []).some(c => c.type === 'major') ? 1 : 0;
  v[90] = p.abilityUsed ? 1 : 0;
  v[91] = opp?.abilityUsed ? 1 : 0;
  v[92] = state.pendingInteraction ? 1 : 0;
  v[93] = (state.centerDraft?.length || 0) > 0 ? 1 : 0;
  v[94] = (state.grave?.length || 0) > 0 ? 1 : 0;
  v[95] = (p.pathwayId ?? 0) / 21;
  v[96] = (opp?.pathwayId ?? 0) / 21;
  v[97] = Math.min(1, (p.seq ?? 9) / 9);
  v[98] = Math.min(1, (opp?.seq ?? 9) / 9);
  v[99] = seat === 0 ? 1 : 0;
  return v;
}

export function extractObs(tier, state, seat, handLimitMode = '10-7') {
  if (tier === 'large') return extractLarge(state, seat, handLimitMode);
  if (tier === 'medium') return extractMedium(state, seat, handLimitMode);
  return extractSmall(state, seat, handLimitMode);
}

/**
 * Encode a candidate decision into an action feature vector (length = outSize).
 * context: { kind, card, targetRel, phase }
 */
export function encodeAction(tier, context = {}) {
  const dim = TIER_DIMS[tier]?.outSize || 8;
  const v = new Array(dim).fill(0);
  const kind = context.kind || 'play';
  const card = context.card;
  const phase = String(context.phase || 'trick').toLowerCase();

  if (tier === 'small') {
    // [major, minor, instant, trick, pouch, discard, ascend, gamble]
    if (card?.type === 'major') v[0] = 1;
    else if (card) v[1] = 1;
    if (kind === 'chaos' || kind === 'ability' || kind === 'instant') v[2] = 1;
    if (kind === 'play' || phase.includes('trick')) v[3] = 1;
    if (kind === 'tuck' || kind === 'pouch' || phase.includes('pouch')) v[4] = 1;
    if (kind === 'discard') v[5] = 1;
    if (kind === 'ascend') v[6] = 1;
    if (kind === 'gamble') v[7] = 1;
    return v;
  }

  if (tier === 'medium') {
    // 0-3 suit, 4 rank, 5 major, 6 face, 7-11 phase, 12-14 target, 15 ability, 16 chaos,
    // 17 tuck, 18 draft, 19 ascend/gamble
    if (card?.type === 'major') {
      v[5] = 1;
      v[4] = (card.majorId || 0) / 21;
    } else if (card) {
      const si = SUITS.indexOf(card.suit);
      if (si >= 0) v[si] = 1;
      v[4] = (card.rank || 0) / 14;
      if ((card.rank || 0) >= 11) v[6] = 1;
    }
    const ph = phaseOneHot(phase, 5);
    for (let i = 0; i < 5; i++) v[7 + i] = ph[i];
    const tr = context.targetRel;
    if (tr != null && tr >= 0) v[12 + Math.min(2, tr)] = 1;
    if (kind === 'ability') v[15] = 1;
    if (kind === 'chaos' || kind === 'instant') v[16] = 1;
    if (kind === 'tuck' || kind === 'pouch') v[17] = 1;
    if (kind === 'draft') v[18] = 1;
    if (kind === 'ascend' || kind === 'gamble') v[19] = 1;
    return v;
  }

  // large 40
  if (card?.type === 'major') {
    v[0] = 1;
    v[1] = (card.majorId || 0) / 21;
  } else if (card) {
    const si = SUITS.indexOf(card.suit);
    if (si >= 0) v[2 + si] = 1;
    v[6] = (card.rank || 0) / 14;
    if ((card.rank || 0) <= 10) v[7] = (card.rank || 0) / 10;
    if ((card.rank || 0) === 11) v[8] = 1;
    if ((card.rank || 0) === 12) v[9] = 1;
    if ((card.rank || 0) === 13) v[10] = 1;
    if ((card.rank || 0) === 14) v[11] = 1;
  }
  const ph = phaseOneHot(phase, 5);
  for (let i = 0; i < 5; i++) v[12 + i] = ph[i];
  const kinds = ['play', 'tuck', 'discard', 'draft', 'ability', 'chaos', 'ascend', 'gamble', 'pass', 'interrupt'];
  const ki = kinds.indexOf(kind);
  if (ki >= 0) v[17 + ki] = 1;
  const tr = context.targetRel;
  if (tr != null && tr >= 0) v[27 + Math.min(2, tr)] = 1;
  v[30] = context.threat || 0;
  v[31] = context.risk || 0;
  v[32] = context.ascendReady || 0;
  v[33] = context.canWinTrick || 0;
  v[34] = context.disrupt || 0;
  v[35] = context.keyCard || 0;
  v[36] = context.drawValue || 0;
  v[37] = context.defendValue || 0;
  v[38] = context.nextStep || 0;
  v[39] = context.tempo || 0;
  return v;
}

/**
 * Small memory buckets — exhaustible table (~2.6k theoretical).
 */
export function hashStateSmall(state, seat) {
  const p = state?.players?.[seat];
  if (!p) return 's:empty';
  const handBucket = (p.hand?.length || 0) >= 4 ? 'h4+' : 'h<4';
  const pouchBucket = (p.pouch?.length || 0) > 0 ? 'b1' : 'b0';
  const acting = p.actingDone ? 'ad1' : 'ad0';
  return `s|${phaseBucket(state.phase)}|${seqRelBucket(state, seat)}|${handBucket}|${trumpTypeBucket(state)}|${pouchBucket}|${acting}|${roundBucket(state.round)}`;
}

/**
 * Medium memory — discrete board only (no exact hand IDs).
 * phase×seqRel×hand×pouch×actingPair×trump×round×asc×maj×oppHand
 * ≈ 7×3×2×2×4×6×3×2×2×2 ≈ 48k theoretical (reachable much less).
 */
export function hashStateMedium(state, seat) {
  const p = state?.players?.[seat];
  if (!p) return 'm:empty';
  const opp = (state.players || []).find(o => o.id !== seat);
  return [
    'm',
    phaseBucket(state.phase),
    seqRelBucket(state, seat),
    (p.hand?.length || 0) >= 4 ? 'h4+' : 'h<4',
    (p.pouch?.length || 0) > 0 ? 'b1' : 'b0',
    actingPairBucket(state, seat),
    trumpTypeBucket(state),
    roundBucket(state.round),
    findValidAscensionSubset(p.pouch || [], p.seq, p.mods || {}) ? 'asc1' : 'asc0',
    (p.hand || []).some(c => c.type === 'major') ? 'maj1' : 'maj0',
    (opp?.hand?.length || 0) >= 4 ? 'oh4+' : 'oh<4',
    (opp?.pouch?.length || 0) > 0 ? 'ob1' : 'ob0'
  ].join('|');
}

/**
 * Large memory — same coarse meta as Medium + a few public-zone bits.
 * Does NOT key on full 78×8 (that would explode); the NN still sees 78 locations.
 * Extra: center empty/has, grave empty/has, ability used pair.
 * Theoretical still ~O(10^5), reachable far less.
 */
export function hashStateLarge(state, seat) {
  const p = state?.players?.[seat];
  if (!p) return 'L:empty';
  const base = hashStateMedium(state, seat).replace(/^m/, 'L');
  const abil = `${p.abilityUsed ? 1 : 0}${((state.players || []).find(o => o.id !== seat)?.abilityUsed) ? 1 : 0}`;
  const center = (state.centerDraft?.length || 0) > 0 ? 'c1' : 'c0';
  const grave = (state.grave?.length || 0) > 0 ? 'g1' : 'g0';
  const pending = state.pendingInteraction ? 'x1' : 'x0';
  return `${base}|u${abil}|${center}|${grave}|${pending}`;
}

/** Stable fogged state hash for memory keys. */
export function hashState(tier, state, seat) {
  if (tier === 'large') return hashStateLarge(state, seat);
  if (tier === 'medium') return hashStateMedium(state, seat);
  return hashStateSmall(state, seat);
}

export function actionKey(kind, card, targetId = null) {
  const cid = card ? cardUidId(card) : -1;
  return `${kind}:${cid}:t${targetId == null ? -1 : targetId}`;
}

/**
 * Coarse action id for state-memory (must match coarse state buckets).
 * Exact card UIDs do NOT work with lead/trail-style hashes — the same bucket
 * rarely holds the same physical card twice.
 */
export function memoryActionKey(kind, card, targetId = null, state = null) {
  const tgt = targetId == null || targetId < 0 ? 't0' : 't1';
  const k = kind || 'play';
  if (!card) return `${k}:${tgt}`;
  if (card.type === 'major') return `${k}:maj:${tgt}`;
  const suit = card.suit || 'x';
  const band =
    (card.rank || 0) <= 3 ? 'lo'
      : (card.rank || 0) <= 7 ? 'mid'
        : (card.rank || 0) <= 10 ? 'hi'
          : (card.rank || 0) === 11 ? 'P'
            : (card.rank || 0) === 12 ? 'N'
              : (card.rank || 0) === 13 ? 'Q'
                : 'K';
  let trump = '';
  if (state?.trumpCard) {
    if (state.trumpCard.type === 'major' && card.type === 'major') trump = ':tr';
    else if (getCardSuit(card) === getCardSuit(state.trumpCard)) trump = ':tr';
  }
  return `${k}:${suit}:${band}${trump}:${tgt}`;
}
