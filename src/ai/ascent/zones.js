/** Card location codes for seat-relative belief (2P-first; opp0 = first other seat). */
export const ZONE = {
  UNKNOWN: 0,
  SELF_HAND: 1,
  SELF_POUCH: 2,
  OPP_HAND: 3,
  OPP_POUCH: 4,
  CENTER: 5,
  TRUMP: 6,
  TRICK: 7,
  GRAVE: 8,
  DECK: 9,
  DECK_PEEK: 10
};

export const ZONE_COUNT = 11;
export const CARD_COUNT = 78;

export const MODE = {
  PASS: 0,
  TUCK: 1,
  POUCH_DISCARD: 2,
  DONE_POUCH: 3,
  DRAFT: 4,
  PLAY_TRICK: 5,
  CAST_ABILITY: 6,
  CHAOS_MAJOR: 7,
  TAKE_TRUMP: 8,
  GAMBLE: 9,
  ASCEND: 10,
  SKIP_ASCEND: 11,
  INTERRUPT_PASS: 12,
  INTERRUPT_BLOCK: 13,
  INTERRUPT_FIGURINE: 14,
  CHOOSE_DISCARD: 15,
  PICK_TARGET: 16
};

export const MODE_COUNT = 17;
export const ABILITY_SLOTS = 9; // seq 9..1
export const MAJOR_SLOT = 1;
export const SEAT_ABILITY_HEADS = ABILITY_SLOTS + MAJOR_SLOT; // 10

export function cardUniqueId(c) {
  if (!c) return -1;
  if (c.type === 'major') return 56 + Math.max(0, Math.min(21, c.majorId || 0));
  const suits = ['swords', 'wands', 'pentacles', 'cups'];
  const sIdx = suits.indexOf(c.suit);
  if (sIdx < 0) return -1;
  return sIdx * 14 + Math.max(0, Math.min(13, (c.rank || 1) - 1));
}

export function seqAbilitySlot(seq) {
  // seq 9 → slot 0, seq 1 → slot 8
  if (seq < 1 || seq > 9) return -1;
  return 9 - seq;
}
