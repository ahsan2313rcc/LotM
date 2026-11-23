import { ZONE, CARD_COUNT, cardUniqueId } from './zones.js';

/**
 * Seat-relative belief over 78 card locations.
 * Public moves (draft, trick, known steals) update known zones;
 * private opp cards stay UNKNOWN / OPP_* only when identity was seen.
 */
export function createBelief() {
  return {
    zones: new Int8Array(CARD_COUNT).fill(ZONE.DECK),
    peeked: new Int8Array(CARD_COUNT).fill(0)
  };
}

function setZone(belief, card, zone) {
  const id = typeof card === 'number' ? card : cardUniqueId(card);
  if (id < 0 || id >= CARD_COUNT) return;
  belief.zones[id] = zone;
  if (zone !== ZONE.DECK_PEEK) belief.peeked[id] = 0;
}

/** Rebuild belief for viewerSeat from true state + public knowledge rules. */
export function syncBeliefFromState(belief, state, viewerSeat) {
  const z = belief.zones;
  z.fill(ZONE.UNKNOWN);
  belief.peeked.fill(0);

  const markList = (arr, zone) => {
    for (const c of arr || []) setZone(belief, c, zone);
  };

  // Deck: all start unknown; we'll overwrite known locations
  // Actually UNKNOWN vs DECK: unseen = DECK pool for training signal
  for (let i = 0; i < CARD_COUNT; i++) z[i] = ZONE.DECK;

  for (const p of state.players || []) {
    const isSelf = p.id === viewerSeat;
    if (isSelf) {
      markList(p.hand, ZONE.SELF_HAND);
      markList(p.pouch, ZONE.SELF_POUCH);
    } else {
      // Fog: identities unknown unless already marked elsewhere this sync.
      // Counts-only — leave as DECK/UNKNOWN. Publicly known cards are set by
      // center/trick/grave/trump and by explicit knownHand/knownPouch maps.
      for (const c of p.knownHand || []) setZone(belief, c, ZONE.OPP_HAND);
      for (const c of p.knownPouch || []) setZone(belief, c, ZONE.OPP_POUCH);
    }
  }

  markList(state.centerDraft, ZONE.CENTER);
  if (state.trumpCard) setZone(belief, state.trumpCard, ZONE.TRUMP);
  for (const pl of state.trickPlays || []) {
    if (pl?.card) setZone(belief, pl.card, ZONE.TRICK);
  }
  // Grave: identities in grave are public in this game UI
  markList(state.grave, ZONE.GRAVE);

  // Own cards overwrite
  const me = state.players?.[viewerSeat];
  if (me) {
    markList(me.hand, ZONE.SELF_HAND);
    markList(me.pouch, ZONE.SELF_POUCH);
  }

  // Peek buffer
  for (const c of state.peekedDeck || []) {
    const id = cardUniqueId(c);
    if (id >= 0) {
      z[id] = ZONE.DECK_PEEK;
      belief.peeked[id] = 1;
    }
  }
  return belief;
}

/** After a public draft: everyone knows which card entered which seat's hand. */
export function beliefNoteDraft(belief, card, drafterId, viewerSeat) {
  const zone = drafterId === viewerSeat ? ZONE.SELF_HAND : ZONE.OPP_HAND;
  setZone(belief, card, zone);
}

export function beliefNoteTrickPlay(belief, card) {
  setZone(belief, card, ZONE.TRICK);
}

export function beliefNoteToGrave(belief, card) {
  setZone(belief, card, ZONE.GRAVE);
}

export function beliefHasOppInstantThreat(belief, { swords = false, wands = false, anyMajor = false } = {}) {
  // Known opp-hand cards that can interrupt
  for (let id = 0; id < CARD_COUNT; id++) {
    if (belief.zones[id] !== ZONE.OPP_HAND) continue;
    if (anyMajor && id >= 56) return true;
    // minors: suit*14 + (rank-1); Knight=12→idx 11, Queen=13→idx 12, within each suit
    if (id < 56) {
      const rank = (id % 14) + 1;
      const suit = Math.floor(id / 14); // 0 swords, 1 wands, 2 pent, 3 cups
      if (swords && suit === 0 && rank === 12) return true;
      if (wands && suit === 1 && rank === 13) return true;
    }
  }
  return false;
}
