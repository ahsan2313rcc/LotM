/**
 * Depth-6 style heuristic scorers (shared with headless).
 * Used as the strong greedy prior so Medium/Large play near D6 before/while memory fills.
 */
import { getCardSuit } from '../../data/constants.js';
import { findValidAscensionSubset, evaluateTrickWinner } from '../../utils/rules.js';

export function scoreDraftCard(c, p, state, depth = 6) {
  if (!c) return -999;
  let sc = c.type === 'major' ? 9 : (c.rank <= 10 ? c.rank : 6);
  const pouch = p.pouch || [];
  const hand = p.hand || [];
  const grave = state.grave || [];
  const players = state.players || [];
  if (c.type === 'minor' && (c.rank <= p.seq || c.rank === 10)) {
    if (depth >= 2 && findValidAscensionSubset([...pouch, c], p.seq, p.mods || {})) sc += 30;
    if (depth >= 3 && (c.rank === p.seq || c.rank === 10)) sc += 24;
    if (depth >= 4 && pouch.some(pc => pc.rank && pc.rank + c.rank === p.seq)) sc += 22;
    if (depth >= 5 && p.seq > 1 && c.rank <= p.seq - 1) sc += 8;
  }
  if (depth >= 3 && (c.suit === 'pentacles' || c.suit === 'cups') && hand.length <= 3) sc += 10;
  if (depth >= 5 && c.suit === 'swords' && players.some(o => o.id !== p.id && o.seq <= p.seq && (o.pouch?.length || 0) >= 2)) sc += 7;
  if (depth >= 6 && c.type === 'minor') {
    if (c.rank === 10) sc += 32;
    else if (c.rank === 1 && !hand.some(h => h.rank === 1)) sc += 26;
    else if (c.rank === 2 && p.seq >= 2 && !hand.some(h => h.rank === 2)) sc += 18;
    else if (c.rank === 3 && p.seq >= 3 && !hand.some(h => h.rank === 3)) sc += 12;
    if (c.suit === 'cups' && grave[0]?.type === 'minor' && grave[0].rank <= 3) sc += 22;
  }
  return sc;
}

export function scoreTrickCard(c, p, state, depth = 6) {
  if (!c) return -999;
  const roundMods = state.roundMods || {};
  const trumpCard = state.trumpCard;
  const trickPlays = state.trickPlays || [];
  const grave = state.grave || [];
  const tSuit = (!roundMods.abolishTrump && !roundMods.noTrumpChariot && trumpCard) ? getCardSuit(trumpCard) : null;
  const curWinPlay = trickPlays.length > 0 ? evaluateTrickWinner(trickPlays, trumpCard, roundMods) : null;

  if (c.type === 'major') return (tSuit === 'major' ? 14 : 4) + (c.majorId || 0) * 0.1;
  let sc = c.rank <= 10 ? c.rank : (c.rank === 14 ? 8 : 5);
  if (roundMods.invertTrick && c.rank <= 9) sc = 11 - sc;
  if (depth >= 3 && tSuit && getCardSuit(c) === tSuit && c.rank <= 10) sc += 6;
  if (depth >= 4 && curWinPlay) {
    const simPlay = {
      playerId: p.id,
      card: c,
      effValue: c.rank <= 10 ? c.rank : 0,
      effSuit: c.suit,
      isTenOverride: c.rank === 10,
      countsAsTrump: !!p.mods?.countsAsTrump || (!!p.mods?.cupsAreTrump && c.suit === 'cups'),
      faceCanWin: !!p.mods?.faceCanWin,
      winsTies: !!p.mods?.winsTies
    };
    const wouldWin = evaluateTrickWinner([...trickPlays, simPlay], trumpCard, roundMods)?.playerId === p.id;
    if (wouldWin) sc += 9;
    else if (c.rank <= 9) sc -= c.rank * 0.7;
  }
  if (depth >= 3 && c.suit === 'pentacles' && (p.hand?.length || 0) <= 3) sc += 9;
  if (depth >= 3 && c.suit === 'cups' && grave.length > 0 && (p.hand?.length || 0) <= 3) sc += 8;
  if (depth >= 4 && (c.rank <= p.seq || c.rank === 10) && findValidAscensionSubset([...(p.pouch || []), c], p.seq, p.mods || {})) sc -= 25;
  if (depth >= 5 && (c.rank === p.seq || c.rank === 10)) sc -= 18;
  if (depth >= 5 && (c.rank === 12 || c.rank === 13) && (p.hand?.length || 0) >= 3) sc -= 6;
  if (depth >= 6) {
    if (c.rank === 10 && p.seq <= 4) sc -= 34;
    else if (c.rank === 1 && p.seq >= 1) sc -= 38;
    else if (c.rank === 2 && p.seq >= 2) sc -= 24;
    else if (c.rank === 3 && p.seq >= 3) sc -= 14;
    if (c.suit === 'cups' && grave[0]?.type === 'minor' && grave[0].rank <= Math.min(3, p.seq)) sc += 32;
    if (c.suit === 'pentacles' && p.seq <= 3 && !(p.hand || []).some(h => h.rank <= p.seq)) sc += 16;
  }
  return sc;
}

export function scoreTuckCard(c, p, depth = 6) {
  if (!c || c.type === 'major') return -50;
  let sc = 0;
  if (c.rank === 10 || c.rank === 1) sc += 40;
  if (c.rank === p.seq) sc += 35;
  if (c.rank <= p.seq) sc += 10 + (10 - c.rank);
  if (findValidAscensionSubset([...(p.pouch || []), c], p.seq, p.mods || {})) sc += 50;
  if (depth >= 6 && c.rank >= 11) sc -= 20;
  return sc;
}

export function pickBestByScore(candidates, scoreFn) {
  if (!candidates?.length) return null;
  let best = candidates[0];
  let bestSc = -1e9;
  for (const c of candidates) {
    const sc = scoreFn(c);
    if (sc > bestSc) { bestSc = sc; best = c; }
  }
  return best;
}
