import { PATHWAYS, ROMAN, SUITS, RANK_LABELS, SUIT_META } from '../data/constants.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildMinorDeck() {
  const cards = [];
  let uid = 100;
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 14; rank++) {
      cards.push({
        uid: `m_${uid++}`,
        type: 'minor',
        suit,
        rank,
        label: RANK_LABELS[rank]
      });
    }
  }
  return cards;
}

function buildMajorCard(pathwayId) {
  const p = PATHWAYS[pathwayId];
  return {
    uid: `M_${pathwayId}`,
    type: 'major',
    majorId: pathwayId,
    roman: ROMAN[pathwayId],
    name: p.arcana,
    lotm: p.lotm,
    chaosDesc: p.chaosDesc
  };
}

// Chess-style Shorthand Netlist Code: P1 (Ace Pentacles), CK (King Cups), S3 (3 Swords), WQ (Queen Wands), X0 (The Fool)
function cardCode(c) {
  if (!c) return '—';
  if (c.type === 'major') return `X${c.majorId}`;
  const sMap = { swords: 'S', wands: 'W', pentacles: 'P', cups: 'C' };
  const rMap = { 1: '1', 10: '10', 11: 'P', 12: 'N', 13: 'Q', 14: 'K' };
  const sc = sMap[c.suit] || '?';
  const rc = rMap[c.rank] || String(c.rank || '?');
  return `${sc}${rc}`;
}

function suitCode(suit) {
  return { swords: 'S', wands: 'W', pentacles: 'P', cups: 'C' }[suit] || '?';
}

function cardShortName(c) {
  if (!c) return 'None';
  if (c.type === 'major') return `${c.roman}. ${c.name}`;
  return `${c.label} of ${SUIT_META[c.suit]?.name || c.suit}`;
}

function isNumberCard(c) {
  return c && c.type === 'minor' && c.rank >= 1 && c.rank <= 10;
}

function isFaceCard(c) {
  return c && c.type === 'minor' && c.rank >= 11 && c.rank <= 14;
}

export {
  mulberry32,
  shuffle,
  buildMinorDeck,
  buildMajorCard,
  cardCode,
  suitCode,
  cardShortName,
  isNumberCard,
  isFaceCard
};
