import { getCardSuit } from '../data/constants.js';
import { isNumberCard } from './cards.js';

function checkAscensionMath(cards, targetSeq, mods = {}) {
  if (!cards || cards.length === 0) return { valid: false, sum: 0 };
  const nums = [];
  let wildAces = 0;
  for (const c of cards) {
    if (c.type !== 'minor') return { valid: false, sum: 0 };
    if (c.rank === 10 || (c.rank === 1 && mods.astronomerWild)) {
      wildAces++; // 10 acts as a Wildcard (any numeric value 1..9) in Pouch Ascension!
    } else if (c.rank >= 1 && c.rank <= 9) {
      nums.push(c.rank);
    } else {
      return { valid: false, sum: 0 };
    }
  }

  if (mods.darkSubBonus && cards.length >= 1) return { valid: true, reason: 'Dark Substitution Wildcard' };
  const bonus = 0;
  const leeway = mods.mathLeeway || 0;
  const allowSub = !!mods.savantSubtract;

  // Standard sum
  const baseSum = nums.reduce((a, b) => a + b, 0) + bonus;
  const minVal = baseSum + wildAces * 1 - leeway;
  const maxVal = baseSum + wildAces * 9 + leeway;
  if (targetSeq >= minVal && targetSeq <= maxVal) {
    return { valid: true, sum: baseSum };
  }

  // Savant subtraction check (for 2 or 3 cards)
  if (allowSub && nums.length >= 2) {
    const sorted = [...nums].sort((a, b) => b - a);
    const diff = sorted[0] - sorted.slice(1).reduce((a, b) => a + b, 0);
    if (Math.abs(diff - targetSeq) <= leeway) {
      return { valid: true, sum: diff };
    }
  }
  return { valid: false, sum: baseSum };
}

// Find any valid subset of pouch cards for AI ascension
function findValidAscensionSubset(cards, targetSeq, mods = {}) {
  const n = cards.length;
  for (let mask = 1; mask < (1 << n); mask++) {
    const sub = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) sub.push(cards[i]);
    }
    if (checkAscensionMath(sub, targetSeq, mods).valid) return sub;
  }
  return null;
}

// Evaluate who wins the trick given played entries: [{ playerId, card, effValue, effSuit, isTenOverride, isAce, faceCanWin }]
function evaluateTrickWinner(plays, trumpCard, roundMods) {
  if (!plays || plays.length === 0) return null;
  const leadPlay = plays[0];
  const leadSuit = leadPlay.effSuit;

  // Determine effective Trump Suit (Major Arcana can be Trump Suit too; 10s override unless abolished or Chariot active)
  let trumpSuit = trumpCard ? (trumpCard.type === 'major' ? 'major' : trumpCard.suit) : null;
  let tenOverrideSuit = null;
  if (!roundMods.abolishTrump && !roundMods.noTrumpChariot && !roundMods.spatialLock) {
    for (const p of plays) {
      if (p.card.rank === 10 || p.isTenOverride) {
        tenOverrideSuit = p.effSuit;
      }
    }
  }
  if (tenOverrideSuit) trumpSuit = tenOverrideSuit;
  if (roundMods.weatherSwords) trumpSuit = 'swords';
  if (roundMods.abolishTrump || roundMods.noTrumpChariot) trumpSuit = null;

  // All cards (including K, Q, N, P with effValue 0) are eligible: Face Cards win if sole Trump or Leading Suit with no Trump/numbered Lead!
  const eligible = plays;

  const scorePlay = (p) => {
    const isTrump = trumpSuit && (p.effSuit === trumpSuit || p.countsAsTrump);
    const isLead = p.effSuit === leadSuit;
    const tier = isTrump ? 2 : (isLead ? 1 : 0);

    // Effective numeric rank (Face Cards K>Q>N>P score 0.14>0.13>0.12>0.11 when !faceCanWin so any 1..10 beats them, while K>Q>N>P breaks Face-only ties!)
    let val = (p.card.type === 'minor' && p.card.rank >= 11 && p.card.rank <= 14 && !p.faceCanWin)
      ? (p.card.rank / 100)
      : p.effValue;
    // Ace beats 10 of same suit!
    if (p.card.rank === 1) {
      const hasTenSameSuit = eligible.some(o => (o.card.rank === 10 || o.isTenOverride) && o.effSuit === p.effSuit);
      if (hasTenSameSuit) val = 12; // Beats 10 and Iron-Blooded Knight 11!
    }
    if (roundMods.invertTrick && tier > 0) {
      if (p.card.type === 'major') val = 21 - val; // Lower Major Arcana wins!
      else if (p.card.rank >= 1 && p.card.rank <= 9) val = 11 - val; // Lower wins!
    }
    return { tier, val, tieBreak: p.winsTies ? 1 : 0 };
  };

  let best = eligible[0];
  let bestScore = scorePlay(best);
  for (let i = 1; i < eligible.length; i++) {
    const cur = eligible[i];
    const sc = scorePlay(cur);
    if (
      sc.tier > bestScore.tier ||
      (sc.tier === bestScore.tier && sc.val > bestScore.val) ||
      (sc.tier === bestScore.tier && sc.val === bestScore.val && sc.tieBreak > bestScore.tieBreak)
    ) {
      best = cur;
      bestScore = sc;
    }
  }
  return best;
}


// ============================================================================
// 3B. HAND LIMIT, RECAST COST & SELF-LEARNING NEURAL NETWORK (RL) ENGINE
// ============================================================================
function getHandLimit(seq, mode = '10-7') {
  if (mode === '7-5') {
    if (seq >= 7) return 7;
    if (seq >= 4) return 6;
    return 5;
  }
  // Default '10-7': 9-8 -> 10, 7-6 -> 9, 5-4 -> 8, 3-1 -> 7
  if (seq >= 8) return 10;
  if (seq >= 6) return 9;
  if (seq >= 4) return 8;
  return 7;
}

export {
  checkAscensionMath,
  findValidAscensionSubset,
  evaluateTrickWinner,
  getHandLimit
};
