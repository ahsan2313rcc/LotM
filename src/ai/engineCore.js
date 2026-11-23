/** Shared LoTM ability/chaos — source of truth for headless + Python bridge. */
import { PATHWAYS, getCardSuit } from '../data/constants.js';
import { shuffle, isNumberCard, isFaceCard } from '../utils/cards.js';

function pickDiscardCardIdx(hand, seq) {
  if (!hand || hand.length === 0) return -1;
  let worstIdx = 0, worstSc = 999;
  for (let i = 0; i < hand.length; i++) {
    const c = hand[i];
    let sc = c.type === 'major' ? 7 : (c.rank === 10 ? 22 : c.rank === 1 ? 20 : c.rank === seq ? 18 : (c.rank === 2 && seq >= 2) ? 15 : (c.rank === 12 || c.rank === 13) ? 10 : c.rank <= seq ? 6 : 2);
    if (sc < worstSc) { worstSc = sc; worstIdx = i; }
  }
  return worstIdx;
}

function discardSmart(player, grave, count = 1) {
  let dropped = 0;
  for (let i = 0; i < count && player.hand.length > 0; i++) {
    const idx = pickDiscardCardIdx(player.hand, player.seq);
    grave.unshift(player.hand.splice(idx, 1)[0]);
    dropped++;
  }
  return dropped;
}

/**
 * Full Major Arcana Chaos resolution (same table as live/headless trick path).
 * Mutates players/deck/grave/roundMods. Returns updated trumpCard.
 * @param {object} actor - seat who played the major (already removed from hand by caller)
 * @param {object} majorCard - the Major card
 * @param {object|null} target - optional targeted opponent
 * @param {object[]} players
 * @param {object[]} deck
 * @param {object[]} grave
 * @param {object|null} trumpCard
 * @param {object} roundMods
 * @param {(n:number)=>object[]} drawN
 * @param {Function} [rng]
 */
function applyHeadlessChaos(actor, majorCard, target, players, deck, grave, trumpCard, roundMods, drawN, rng = Math.random) {
  const cid = majorCard?.majorId ?? 0;
  const skipped = new Set(players.filter(o => o.skippedThisRound).map(o => o.id));
  const otherPs = players.filter(o => o.id !== actor.id && !skipped.has(o.id));

  if (actor.pathwayId === 2 && (actor.seq === 4 || actor.seq === 1)) actor.actingDone = true;
  if (actor.pathwayId === 12 && actor.seq === 1) actor.actingDone = true;

  if (cid === 0) {
    const m = actor.hand[0];
    if (m && trumpCard) {
      actor.hand = actor.hand.filter(c => c.uid !== m.uid);
      actor.hand.push(trumpCard);
      trumpCard = m;
      roundMods.trumpChanged = true;
    }
  } else if (cid === 1) {
    if (actor.pouch.length > 0 && target && target.pouch.length > 0 && !target.mods.pouchImmune) {
      const aC = actor.pouch.pop();
      actor.pouch.push(target.pouch.pop());
      target.pouch.push(aC);
    }
  } else if (cid === 2) {
    if (deck.length >= 2) {
      const top = deck.splice(0, Math.min(3, deck.length)).sort((a, b) => (b.rank || 10) - (a.rank || 10));
      deck.unshift(...top);
    }
  } else if (cid === 3) {
    if (target && !roundMods.globalImmunity) {
      let revealedPage = false;
      if (target.pouch.length > 0 && !target.mods.pouchImmune) {
        const i = Math.floor(rng() * target.pouch.length);
        if (target.pouch[i].rank === 11) {
          grave.unshift(target.pouch.splice(i, 1)[0]);
          revealedPage = true;
        }
      }
      if (!revealedPage && !target.mods.handImmune && target.hand.length > 0) discardSmart(target, grave, 1);
    }
  } else if (cid === 4) {
    roundMods.invertTrick = true;
  } else if (cid === 5) {
    const reqS = getCardSuit(trumpCard) || 'swords';
    for (const o of otherPs) {
      if (!o.mods.handImmune && !roundMods.globalImmunity && !o.hand.some(c => getCardSuit(c) === reqS) && o.hand.length > 0) {
        discardSmart(o, grave, 1);
      }
    }
  } else if (cid === 6) {
    if (actor.hand.length > 0 && target && target.hand.length > 0) {
      const tmp = actor.hand.pop();
      actor.hand.push(target.hand.pop());
      target.hand.push(tmp);
    }
  } else if (cid === 7) {
    roundMods.noTrumpChariot = true;
  } else if (cid === 8) {
    roundMods.globalImmunity = true;
  } else if (cid === 9) {
    if (grave.length > 0) actor.hand.push(grave.shift());
  } else if (cid === 10) {
    const passed = players.map(q => (q.hand.length > 0 ? q.hand.pop() : null));
    players.forEach((q, qi) => {
      const f = (qi - 1 + players.length) % players.length;
      if (passed[f]) q.hand.push(passed[f]);
      q.hand.push(...drawN(1));
    });
  } else if (cid === 11) {
    const srt = [...players].sort((a, b) => b.hand.length - a.hand.length);
    if (srt[0].id !== srt[srt.length - 1].id && srt[0].hand.length > 0) {
      srt[srt.length - 1].hand.push(srt[0].hand.pop());
    }
  } else if (cid === 12) {
    discardSmart(actor, grave, 2);
    const mp12 = actor.mods.maxPouch || 3;
    for (const c of drawN(2)) {
      if (actor.pouch.length < mp12) actor.pouch.push(c);
      else actor.hand.push(c);
    }
  } else if (cid === 13) {
    for (const q of players) {
      if (q.pouch.length > 0 && !q.mods.pouchImmune && !roundMods.globalImmunity) {
        grave.unshift(q.pouch.pop());
        q.pouchLostThisRound = true;
      }
    }
  } else if (cid === 14) {
    roundMods.cancelSuitActions = true;
  } else if (cid === 15) {
    for (const o of otherPs) {
      if (!roundMods.globalImmunity) {
        if (o.hand.length > 1 && !o.mods.handImmune) discardSmart(o, grave, 1);
        else if (o.pouch.length > 0 && !o.mods.pouchImmune) {
          grave.unshift(o.pouch.pop());
          o.pouchLostThisRound = true;
        }
      }
    }
  } else if (cid === 16) {
    const oldT = trumpCard;
    if (grave.length > 0) {
      trumpCard = grave.shift();
      if (oldT) grave.unshift(oldT);
    }
    roundMods.trumpChanged = true;
  } else if (cid === 17) {
    actor.hand.push(...drawN(1));
  } else if (cid === 18) {
    const pool = [];
    const cnts = players.map(q => {
      if (q.mods.pouchImmune) return 0;
      const n = q.pouch.length;
      pool.push(...q.pouch);
      q.pouch = [];
      return n;
    });
    const mix = shuffle(pool, rng);
    players.forEach((q, qi) => {
      if (cnts[qi] > 0) q.pouch = mix.splice(0, cnts[qi]);
    });
  } else if (cid === 19) {
    actor.hand.push(...drawN(1));
    if (actor.pouch.length < (actor.mods.maxPouch || 3) && actor.hand.length > 0) {
      actor.pouch.push(actor.hand.pop());
    }
  } else if (cid === 20) {
    for (const o of otherPs) {
      if (o.pouch.length > 0 && !o.mods.pouchImmune) o.hand.push(o.pouch.pop());
    }
  } else if (cid === 21) {
    actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 3;
  }

  const recCnt = actor.mods.skipRecycle ? 0 : cid;
  const rec = grave.splice(0, Math.min(recCnt, grave.length));
  for (const q of players) {
    if (q.pathwayId === 13 && q.seq === 6 && rec.length > 0) {
      q.hand.push(rec.shift());
      q.actingDone = true;
    }
  }
  deck.push(majorCard, ...rec);
  return trumpCard;
}

function applyHeadlessAbility(actor, players, target, deck, grave, trumpCardRef, roundMods, drawN, overrideTag = null, copyDepth = 0, rng = Math.random) {
  const seqObj = PATHWAYS[actor.pathwayId]?.seqs[actor.seq];
  if (!seqObj && !overrideTag) return;
  const tag = overrideTag || seqObj.tag;
  const others = players.filter(o => o.id !== actor.id && !o.skippedThisRound);
  const maxP = actor.mods.maxPouch || 3;

  const forceDiscard = (victim, count = 1, canQueenBlock = true) => {
    if (!victim || victim.mods.handImmune || roundMods.globalImmunity) return 0;
    if (canQueenBlock && !actor.mods.unblockable && !roundMods.spatialLock && !roundMods.apocalypse) {
      const qIdx = victim.hand.findIndex(c => c.rank === 13);
      if (qIdx !== -1) {
        grave.unshift(victim.hand.splice(qIdx, 1)[0]);
        victim.faceCounts.Q++;
        return 0;
      }
    }
    let dropped = 0;
    for (let i = 0; i < count; i++) {
      if (victim.mods.sunFloor && victim.hand.length <= 3) break;
      if (victim.hand.length === 0) { victim.skipNextTurn = true; break; }
      grave.unshift(victim.hand.pop());
      dropped++;
    }
    return dropped;
  };

  const destroyPouch = (victim, count = 1, ignoreTraps = false) => {
    if (!victim || victim.mods.pouchImmune || roundMods.globalImmunity) return 0;
    if (!ignoreTraps && !actor.mods.unblockable && !roundMods.spatialLock && !roundMods.apocalypse) {
      const kIdx = victim.hand.findIndex(c => c.rank === 12);
      if (kIdx !== -1) {
        grave.unshift(victim.hand.splice(kIdx, 1)[0]);
        victim.faceCounts.N++;
        if (victim.pathwayId === 8 && (victim.seq === 8 || victim.seq === 7)) victim.actingDone = true;
        return 0;
      }
    }
    let hits = 0;
    for (let i = 0; i < count && victim.pouch.length > 0; i++) {
      const idx = Math.floor(rng() * victim.pouch.length);
      const card = victim.pouch[idx];
      if (!ignoreTraps && victim.mods.dawnPaladin) {
        victim.actingDone = true;
        return 0;
      }
      if (!ignoreTraps && (card.rank === 11 || victim.mods.despairTraps)) {
        victim.pouch.splice(idx, 1);
        grave.unshift(card);
        victim.faceCounts.P++;
        if (actor.pouch.length > 0) victim.hand.push(actor.pouch.pop());
        else if (actor.hand.length > 0) victim.hand.push(actor.hand.pop());
        if ((victim.pathwayId === 3 || victim.pathwayId === 0) && victim.seq === 4) victim.actingDone = true;
        continue;
      }
      victim.pouch.splice(idx, 1);
      grave.unshift(card);
      hits++;
    }
    return hits;
  };

  switch (tag) {
    case 'peek_deck_2': {
      if (deck.length >= 2) {
        const t = deck.splice(0, 2).sort((a, b) => (b.rank || 10) - (a.rank || 10));
        deck.unshift(...t);
      }
      if (actor.pathwayId === 0 && actor.seq === 9) actor.actingDone = true;
      break;
    }
    case 'clown_shield': {
      // Optional Sword interrupt charge (Hand↔Bag), like Knight — not auto-immune
      actor.mods.clownFigurine = true;
      break;
    }
    case 'pouch_immune_draw': {
      actor.mods.pouchImmune = true;
      actor.hand.push(...drawN(1));
      break;
    }
    case 'illusion_boost': actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 3; actor.mods.countsAsTrump = true; break;
    case 'copy_ability': {
      if (target && actor.pathwayId === 6 && actor.seq === 5) target.abilityUsed = true;
      const oppTag = target ? PATHWAYS[target.pathwayId]?.seqs[target.seq]?.tag : null;
      if (oppTag && oppTag !== 'copy_ability' && copyDepth < 1) {
        applyHeadlessAbility(actor, players, target, deck, grave, trumpCardRef, roundMods, drawN, oppTag, copyDepth + 1, rng);
      } else {
        actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 1;
      }
      actor.actingDone = true;
      break;
    }
    case 'marionette': {
      if (target) { forceDiscard(target, 1); target.mods.trickPenalty = (target.mods.trickPenalty || 0) + 2; actor.actingDone = true; }
      break;
    }
    case 'grave_to_pouch_trap': {
      if (grave.length > 0 && actor.pouch.length < 4) { actor.pouch.push(grave.shift()); actor.mods.despairTraps = true; }
      break;
    }
    case 'scholar_proj': {
      const idx = grave.findIndex(c => c.type === 'minor');
      if (idx !== -1) actor.hand.push(grave.splice(idx, 1)[0]);
      actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 2;
      break;
    }
    case 'swap_trump_deck': {
      const d = drawN(1);
      if (d[0]) { if (trumpCardRef.card) deck.push(trumpCardRef.card); trumpCardRef.card = d[0]; }
      if (actor.pathwayId === 10 && actor.seq === 9) actor.actingDone = true;
      break;
    }
    case 'grafting': actor.hand.push(...drawN(2)); actor.mods.handImmune = true; actor.mods.pouchImmune = true; break;
    case 'swap_hand_trump': {
      const m = actor.hand.find(c => c.type === 'minor');
      if (m && trumpCardRef.card) {
        actor.hand = actor.hand.filter(c => c.uid !== m.uid);
        actor.hand.push(trumpCardRef.card);
        trumpCardRef.card = m;
        actor.actingDone = true;
      }
      break;
    }
    case 'cycle_2_1': {
      if (actor.hand.length > 0) grave.unshift(actor.hand.pop());
      actor.hand.push(...drawN(2));
      actor.actingDone = true;
      break;
    }
    case 'astrologer': actor.hand.push(...drawN(1)); actor.actingDone = true; break;
    case 'scribe_grave': {
      const topG = grave.find(c => c.type === 'minor');
      if (topG) {
        if (topG.suit === 'pentacles') actor.hand.push(...drawN(1));
        else if (topG.suit === 'cups' && grave.length > 0) actor.hand.push(grave.shift());
        else if (topG.suit === 'wands' && target) forceDiscard(target, 1);
        else if (topG.suit === 'swords' && target) destroyPouch(target, 1);
        actor.actingDone = true;
      } else actor.hand.push(...drawN(1));
      break;
    }
    case 'blink_immune': actor.mods.handImmune = true; actor.mods.pouchImmune = true; actor.hand.push(...drawN(1)); break;
    case 'swap_trump_grave': {
      const idx = grave.findIndex(c => c.type === 'minor');
      if (idx !== -1 && trumpCardRef.card) {
        const gC = grave.splice(idx, 1)[0];
        grave.unshift(trumpCardRef.card);
        trumpCardRef.card = gC;
      }
      break;
    }
    case 'grave_best_to_hand': {
      const minors = grave.filter(c => c.type === 'minor').sort((a, b) => b.rank - a.rank);
      if (minors[0]) { const i = grave.indexOf(minors[0]); grave.splice(i, 1); actor.hand.push(minors[0]); actor.actingDone = true; }
      break;
    }
    case 'spatial_lock': roundMods.spatialLock = true; if (actor.pathwayId === 20 && actor.seq === 5) actor.actingDone = true; break;
    case 'mystery_pryer_swap': {
      if (deck.length > 0 && grave.length > 0) {
        const topD = deck[0], botG = grave[grave.length - 1];
        const usefulG = botG.type === 'minor' && (botG.rank === 10 || botG.rank <= actor.seq);
        const usefulD = topD.type === 'minor' && (topD.rank === 10 || topD.rank <= actor.seq);
        if (usefulG && !usefulD) { deck[0] = botG; grave[grave.length - 1] = topD; }
      }
      actor.actingDone = true;
      break;
    }
    case 'grave_peek_take': {
      const idx = grave.slice(0, 3).findIndex(c => c.type === 'minor');
      if (idx !== -1) { actor.hand.push(grave.splice(idx, 1)[0]); actor.actingDone = true; }
      else actor.hand.push(...drawN(1));
      break;
    }
    case 'wand_cup_boost': actor.mods.wandCupBonus = 2; break;
    case 'warlock_cast': {
      if (actor.hand.length > 0) grave.unshift(actor.hand.pop());
      actor.hand.push(...drawN(1));
      if (target) destroyPouch(target, 1);
      actor.actingDone = true;
      break;
    }
    case 'scroll_charge': actor.hand.push(...drawN(1)); actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 1; actor.actingDone = true; break;
    case 'find_major': {
      const idx = deck.slice(0, 4).findIndex(c => c.type === 'major');
      if (idx !== -1) { actor.hand.push(deck.splice(idx, 1)[0]); actor.actingDone = true; }
      else actor.hand.push(...drawN(1));
      break;
    }
    case 'mystic_fairytale': actor.mods.skipRecycle = true; actor.hand.push(...drawN(1)); break;
    case 'clairvoyant': actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 2; break;
    case 'hand_swap_opp': {
      if (actor.hand.length > 0 && target && target.hand.length > 0) {
        const tmp = actor.hand.pop();
        actor.hand.push(target.hand.pop());
        target.hand.push(tmp);
        actor.actingDone = true;
      }
      break;
    }
    case 'grave_major_to_hand': {
      if (actor.hand.length > 0) grave.unshift(actor.hand.pop());
      const idx = grave.findIndex(c => c.type === 'major');
      if (idx !== -1) actor.hand.push(grave.splice(idx, 1)[0]);
      else actor.hand.push(...drawN(2));
      break;
    }
    case 'assassin_ambush': actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 2; actor.mods.assassinSwordDraw = true; break;
    case 'trick_plus_2': actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 2; break;
    case 'instigator_redirect': actor.mods.handImmune = true; break;
    case 'witch_burn': {
      if (target) {
        if (destroyPouch(target, 1) > 0) {
          actor.hand.push(...drawN(1));
          actor.actingDone = true;
        }
      }
      break;
    }
    case 'pleasure_gift': {
      if (target && target.hand.length > 0) {
        const giveIdx = pickDiscardCardIdx(target.hand, target.seq);
        actor.hand.push(target.hand.splice(giveIdx, 1)[0]);
        actor.actingDone = true;
      }
      break;
    }
    case 'plague_aoe': {
      let tot = 0;
      for (const o of others) if (o.hand.length >= 3) tot += forceDiscard(o, 1);
      if (tot > 0 && grave.length > 0) actor.hand.push(grave.shift());
      actor.actingDone = true;
      break;
    }
    case 'despair_traps': actor.mods.despairTraps = true; if (actor.pouch.length >= 2) actor.actingDone = true; break;
    case 'pouch_swap_grave': {
      if (actor.pouch.length > 0 && grave.length > 0) {
        const pc = actor.pouch.pop();
        actor.pouch.push(grave.shift());
        grave.unshift(pc);
        actor.actingDone = true;
      }
      break;
    }
    case 'catastrophe_aoe': {
      let v = 0;
      for (const o of others) { if (o.pouch.length > 0) { if (destroyPouch(o, 1) > 0) v++; } else if (forceDiscard(o, 2) > 0) v++; }
      if (v > 0) actor.actingDone = true;
      break;
    }
    case 'apocalypse_mode': roundMods.apocalypse = true; roundMods.spatialLock = true; break;
    case 'math_plus_minus_1': actor.mods.mathLeeway = Math.max(actor.mods.mathLeeway || 0, 1); actor.mods.lawyerKeepOne = true; break;
    case 'math_plus_minus_2': actor.mods.mathLeeway = Math.max(actor.mods.mathLeeway || 0, 2); actor.hand.push(...drawN(1)); actor.actingDone = true; break;
    case 'unblockable_next': actor.mods.unblockable = true; break;
    case 'bribe_opp': {
      if (actor.hand.length > 0 && target) {
        target.hand.push(actor.hand.pop());
        actor.mods.handImmune = true; actor.mods.pouchImmune = true;
        actor.hand.push(...drawN(2));
        actor.actingDone = true;
      }
      break;
    }
    case 'invert_trick': roundMods.invertTrick = true; actor.mods.baronPouch = true; break;
    case 'disorder_pass': {
      const passed = others.map(o => (o.hand.length > 0 ? o.hand.pop() : null));
      others.forEach((o, idx) => {
        const dest = players[(o.id + 1) % players.length];
        if (passed[idx] && dest) dest.hand.push(passed[idx]);
      });
      actor.actingDone = true;
      break;
    }
    case 'double_suit': actor.mods.doubleSuit = true; break;
    case 'weaken_opp': if (target) target.mods.trickPenalty = (target.mods.trickPenalty || 0) + 3; break;
    case 'draw_2': actor.hand.push(...drawN(2)); actor.actingDone = true; break;
    case 'abolish_trump': roundMods.abolishTrump = true; if (actor.pathwayId === 20) actor.hand.push(...drawN(1)); break;
    case 'trick_plus_1': actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 1; if (actor.pathwayId === 5 && actor.seq === 9) actor.mods.sailorLeadDraw = true; break;
    case 'fury_boost': discardSmart(actor, grave, 1); actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 3; actor.mods.folkWinDraw = true; break;
    case 'siren_song': {
      let hits = 0;
      for (const o of others) if (o.hand.length > actor.hand.length) hits += forceDiscard(o, 1);
      if (hits > 0) actor.actingDone = true;
      break;
    }
    case 'tsunami_aoe': {
      let hits = 0;
      for (const o of others) { if (destroyPouch(o, 1) > 0) { hits++; actor.hand.push(...drawN(1)); } }
      if (hits > 0) actor.actingDone = true;
      break;
    }
    case 'replace_trump_draw': {
      const d = drawN(1);
      if (d[0]) { if (trumpCardRef.card) grave.unshift(trumpCardRef.card); trumpCardRef.card = d[0]; }
      actor.hand.push(...drawN(1));
      actor.actingDone = true;
      break;
    }
    case 'thunderclap': for (const o of others) o.mods.nonTrumpPenalty = (o.mods.nonTrumpPenalty || 0) + 3; break;
    case 'wrath_sea': for (const o of others) forceDiscard(o, o.hand.length > 2 ? 2 : 1); break;
    case 'pouch_swap_deck': {
      if (actor.pouch.length > 0) {
        const d = drawN(1);
        if (d[0]) { deck.push(actor.pouch.pop()); actor.pouch.push(d[0]); actor.actingDone = true; }
      }
      break;
    }
    case 'steal_pouch_safe': {
      if (target && target.pouch.length > 0 && !target.mods.pouchImmune) {
        actor.hand.push(target.pouch.pop());
        actor.actingDone = true;
      }
      break;
    }
    case 'swap_best_hand': {
      if (target && target.hand.length > 0 && actor.hand.length > 0) {
        target.hand.sort((a, b) => (b.rank || 10) - (a.rank || 10));
        actor.hand.sort((a, b) => (a.rank || 1) - (b.rank || 1));
        const st = target.hand.shift(), gv = actor.hand.shift();
        actor.hand.push(st); target.hand.push(gv);
      }
      break;
    }
    case 'hijack_trump': {
      if (trumpCardRef.card && actor.hand.length > 0) {
        const dropIdx = pickDiscardCardIdx(actor.hand, actor.seq);
        const swapOut = actor.hand.splice(dropIdx, 1)[0];
        actor.hand.push(trumpCardRef.card);
        trumpCardRef.card = swapOut;
        actor.actingDone = true;
      }
      break;
    }
    case 'steal_time': if (target) {
      if (target.seq <= actor.seq || target.hand.length <= 2) { target.skipNextTurn = true; }
      else { forceDiscard(target, 1); }
      actor.actingDone = true;
    } break;
    case 'hunter_track': actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 1; break;
    case 'taunt_discard': if (target) forceDiscard(target, 1); actor.mods.handImmune = true; actor.actingDone = true; break;
    case 'pyro_aoe': {
      if (actor.hand.length > 0) grave.unshift(actor.hand.pop());
      let c = 0; for (const o of others.slice(0, 2)) if (forceDiscard(o, 1) > 0) c++;
      if (c > 0) actor.actingDone = true;
      break;
    }
    case 'conspirator_dual': if (others[0]) destroyPouch(others[0], 1); if (others[1]) forceDiscard(others[1], 1); actor.actingDone = true; break;
    case 'reaper_strike': if (target) { destroyPouch(target, 1); if (target.hand.length > 0) actor.hand.push(target.hand.pop()); actor.actingDone = true; } break;
    case 'face_can_win': actor.mods.faceCanWin = true; actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 2; break;
    case 'declare_war': roundMods.warDeclared = true; break;
    case 'weather_swords': roundMods.weatherSwords = true; actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 2; break;
    case 'conqueror_lock': roundMods.spatialLock = true; if (target) { target.abilityUsed = true; forceDiscard(target, 1); } break;
    case 'warrior_mastery': actor.mods.warriorTakeWinner = true; break;
    case 'dawn_paladin': actor.mods.dawnPaladin = true; actor.mods.pouchImmune = true; break;
    case 'counter_shield': actor.mods.handImmune = true; actor.mods.pouchImmune = true; actor.mods.counterPunch = true; break;
    case 'demon_hunter_strike': if (target && destroyPouch(target, 1, true) > 0) actor.actingDone = true; break;
    case 'grave_defense_pull': {
      const idx = grave.findIndex(c => c.rank === 12 || c.rank === 13);
      if (idx !== -1) { actor.hand.push(grave.splice(idx, 1)[0]); actor.actingDone = true; }
      else actor.hand.push(...drawN(2));
      break;
    }
    case 'glory_aura': for (const o of others) o.mods.trickPenalty = (o.mods.trickPenalty || 0) + 2; break;
    case 'hand_of_god': if (target) destroyPouch(target, 1, true); actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 2; break;
    case 'reader_scry': {
      if (deck.length > 1) {
        const top = deck[0];
        const useful = top.type === 'minor' && (top.rank === 10 || top.rank <= actor.seq);
        if (!useful) deck.push(deck.shift());
      }
      actor.actingDone = true;
      break;
    }
    case 'student_deduce': {
      const topCard = drawN(1)[0] || null;
      const oppIdx = (target && target.hand.length > 0) ? Math.floor(rng() * target.hand.length) : -1;
      const oppCard = oppIdx !== -1 ? target.hand.splice(oppIdx, 1)[0] : null;
      if (topCard && oppCard) {
        const val = (c) => c.type === 'major' ? 7 : (c.rank === 10 ? 22 : c.rank === actor.seq ? 20 : c.rank <= actor.seq ? 12 : c.rank);
        if (val(oppCard) >= val(topCard)) { actor.hand.push(oppCard); target.hand.push(topCard); }
        else { actor.hand.push(topCard); target.hand.push(oppCard); }
        actor.actingDone = true;
      } else if (topCard) { actor.hand.push(topCard); actor.actingDone = true; }
      else if (oppCard) { actor.hand.push(oppCard); actor.actingDone = true; }
      break;
    }
    case 'mysticism_cycle': {
      actor.hand.push(...drawN(2));
      if (actor.hand.length > 0) {
        const idx = pickDiscardCardIdx(actor.hand, actor.seq);
        deck.push(actor.hand.splice(idx, 1)[0]);
      }
      actor.actingDone = true;
      break;
    }
    case 'telepathist_reveal': {
      if (target && target.hand.length > 0) {
        const ts = getCardSuit(trumpCardRef.card);
        const pool = [...target.hand];
        let matches = 0;
        for (let k = 0; k < Math.min(2, pool.length); k++) {
          const rIdx = Math.floor(rng() * pool.length);
          const rev = pool.splice(rIdx, 1)[0];
          if (ts && getCardSuit(rev) === ts) matches++;
        }
        if (matches > 0) actor.hand.push(...drawN(matches));
        actor.actingDone = true;
      }
      break;
    }
    case 'draw_1_peek': {
      // Archaeologist: excavate bottom 3, keep best into Hand, rest stay on bottom
      const n = Math.min(3, deck.length);
      if (n > 0) {
        const bottom = deck.splice(deck.length - n, n);
        bottom.sort((a, b) => (b.rank || 10) - (a.rank || 10));
        actor.hand.push(bottom.shift());
        deck.push(...bottom);
      } else {
        actor.hand.push(...drawN(1));
      }
      actor.actingDone = true;
      break;
    }
    case 'deduce_reveal': actor.hand.push(...drawN(1)); actor.actingDone = true; break;
    case 'prophet_foresight': actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 2; break;
    case 'steal_trump_hand': {
      if (target && target.hand.length > 0) {
        const ts = getCardSuit(trumpCardRef.card);
        let idx = ts ? target.hand.findIndex(c => getCardSuit(c) === ts) : -1;
        const stoleTrump = idx !== -1;
        if (idx === -1) idx = 0;
        actor.hand.push(target.hand.splice(idx, 1)[0]);
        if (stoleTrump || actor.pathwayId !== 9) actor.actingDone = true;
      }
      break;
    }
    case 'author_coincidence': {
      actor.hand.push(...drawN(2));
      if (actor.pouch.length < maxP && actor.hand.length > 2) {
        const tIdx = actor.hand.findIndex(c => c.type === 'minor' && (c.rank === 10 || c.rank <= actor.seq));
        if (tIdx !== -1) actor.pouch.push(actor.hand.splice(tIdx, 1)[0]);
      }
      if (actor.hand.length >= 5 || actor.pouch.length >= 3) actor.actingDone = true;
      break;
    }
    case 'omniscient_eye': {
      actor.hand.push(...drawN(2));
      if (actor.pouch.length < maxP && actor.hand.length > 0) {
        const tIdx = actor.hand.findIndex(c => c.type === 'minor' && (c.rank === 10 || c.rank <= actor.seq));
        actor.pouch.push(actor.hand.splice(tIdx !== -1 ? tIdx : actor.hand.length - 1, 1)[0]);
        actor.mods.addedDeckToPouch = true;
      }
      break;
    }
    case 'robot_pair': {
      const counts = {};
      for (const c of actor.hand) if (c.rank) counts[c.rank] = (counts[c.rank] || 0) + 1;
      const hasPair = Object.values(counts).some(v => v >= 2);
      actor.hand.push(...drawN(hasPair ? 2 : 1));
      if (hasPair) actor.actingDone = true;
      break;
    }
    case 'lucky_two_suits': actor.mods.luckyTwoSuits = true; actor.hand.push(...drawN(1)); break;
    case 'calamity_jinx': if (target) { const d = drawN(1); if (d[0]) grave.unshift(d[0]); if (forceDiscard(target, 1) > 0) actor.actingDone = true; } break;
    case 'jackpot_boost': actor.mods.jackpotBoost = true; break;
    case 'jinx_cycle': if (target && target.hand.length > 0) { forceDiscard(target, 1); target.hand.push(...drawN(1)); actor.actingDone = true; } break;
    case 'soothsayer_flip': {
      const d = drawN(2);
      let kept = 0;
      for (const c of d) { if (c.rank && c.rank % 2 === 0) { actor.hand.push(c); kept++; } else grave.unshift(c); }
      if (kept === 0 && d[0] && grave.length > 0) actor.hand.push(grave.shift());
      actor.actingDone = true;
      break;
    }
    case 'reboot_trick': actor.hand.push(...drawN(2)); break;
    case 'spectator_draw': actor.hand.push(...drawN(1)); break;
    case 'frenzy_discard': if (target && forceDiscard(target, 1, false) > 0) actor.actingDone = true; break;
    case 'hypnotist_steal': {
      if (target && target.hand.length >= 5) actor.hand.push(target.hand.pop());
      else actor.hand.push(...drawN(1));
      actor.actingDone = true;
      break;
    }
    case 'pouch_swap_opp': {
      if (actor.pouch.length > 0 && target && target.pouch.length > 0 && !target.mods.pouchImmune) {
        const aC = actor.pouch.pop();
        actor.pouch.push(target.pouch.pop());
        target.pouch.push(aC);
        actor.actingDone = true;
      }
      break;
    }
    case 'manipulator_aoe': {
      const richest = [...others].sort((a, b) => b.hand.length - a.hand.length)[0];
      if (richest) forceDiscard(richest, 1);
      actor.actingDone = true;
      break;
    }
    case 'listener_grave': { const pulled = grave.length > 0 ? grave.shift() : null; if (actor.hand.length > 0) discardSmart(actor, grave, 1); if (pulled) { actor.hand.push(pulled); actor.actingDone = true; } break; }
    case 'shadow_sacrifice': actor.mods.handImmune = true; actor.mods.pouchImmune = true; break;
    case 'grave_to_pouch_sac': if (grave.length > 0) { if (actor.pouch.length < maxP) actor.pouch.push(grave.shift()); else actor.hand.push(grave.shift()); actor.actingDone = true; } break;
    case 'dark_sub_4': if (actor.hand.length >= 1) { discardSmart(actor, grave, 1); actor.mods.darkSubBonus = true; actor.actingDone = true; } break;
    case 'blood_ritual': {
      if (actor.hand.length > 0) grave.unshift(actor.hand.pop());
      let c = 0; for (const o of others) c += forceDiscard(o, 1);
      if (c > 0) actor.actingDone = true;
      break;
    }
    case 'degenerate_10': if (actor.pouch.length > 0) { grave.unshift(actor.pouch.pop()); actor.mods.degenerateTen = true; } break;
    case 'exhume_swap': if (actor.hand.length > 0 && grave.length > 0) { const h = actor.hand.pop(); actor.hand.push(grave.shift()); grave.unshift(h); actor.actingDone = true; } break;
    case 'grave_face_pull': {
      const idx = grave.findIndex(c => isFaceCard(c));
      if (idx !== -1) actor.hand.push(grave.splice(idx, 1)[0]);
      else if (grave.length > 0) actor.hand.push(grave.shift());
      else actor.hand.push(...drawN(1));
      actor.actingDone = true;
      break;
    }
    case 'soul_harvest': if (grave.length > 0) actor.hand.push(grave.shift()); if (grave.length >= 4) { actor.hand.push(...drawN(1)); actor.actingDone = true; } break;
    case 'grave_trump_pull': {
      const ts = getCardSuit(trumpCardRef.card);
      const idx = grave.findIndex(c => !ts || getCardSuit(c) === ts);
      if (idx !== -1) { actor.hand.push(grave.splice(idx, 1)[0]); actor.actingDone = true; }
      else actor.hand.push(...drawN(1));
      break;
    }
    case 'undying_revive': for (let i = 0; i < 2 && grave.length > 0; i++) actor.hand.push(grave.shift()); actor.actingDone = true; break;
    case 'ferryman_swap': {
      if (target && target.pouch.length > 0 && grave.length > 0 && !target.mods.pouchImmune) {
        const tc = target.pouch.pop(); target.pouch.push(grave.shift()); grave.unshift(tc); actor.actingDone = true;
      }
      break;
    }
    case 'pale_decree': actor.mods.trickBonus = (actor.mods.trickBonus || 0) + Math.min(3, Math.floor(grave.length / 3) + 1); break;
    case 'pale_emperor': {
      let added = 0;
      for (let i = 0; i < 2 && actor.pouch.length < maxP; i++) {
        const idx = grave.findIndex(c => isNumberCard(c));
        if (idx !== -1) { actor.pouch.push(grave.splice(idx, 1)[0]); added++; }
      }
      if (added > 0) actor.actingDone = true;
      break;
    }
    case 'prisoner_restraint': {
      if (actor.pouch.length > 0) { actor.hand.push(actor.pouch.pop()); actor.hand.push(...drawN(2)); }
      else { actor.hand.push(...drawN(1)); }
      break;
    }
    case 'werewolf_blood': actor.mods.trickBonus = (actor.mods.trickBonus || 0) + (actor.hand.length <= 4 ? 3 : 2); break;
    case 'wraith_possess': if (target) { target.mods.ascendLocked = true; forceDiscard(target, 1); actor.actingDone = true; } break;
    case 'puppet_curse': if (actor.hand.length > 0 && target) { grave.unshift(actor.hand.pop()); destroyPouch(target, 1); forceDiscard(target, 1); actor.actingDone = true; } break;
    case 'silence_opp': if (target) { target.abilityUsed = true; target.mods.silenced = true; actor.hand.push(...drawN(1)); } break;
    case 'ancient_bane': for (const o of others) if (o.hand.length >= 5) forceDiscard(o, 1); actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 2; break;
    case 'abomination_unchain': {
      actor.mods.maxPouch = 5;
      for (let i = 0; i < 2 && actor.hand.length > 0 && actor.pouch.length < 5; i++) actor.pouch.push(actor.hand.pop());
      if (actor.pouch.length >= 4) actor.actingDone = true;
      break;
    }
    case 'criminal_discard': {
      if (target && target.hand.length > 0) {
        target.hand.sort((a, b) => (b.rank || 0) - (a.rank || 0));
        grave.unshift(target.hand.shift());
        actor.actingDone = true;
      }
      break;
    }
    case 'serial_killer': if (target) { const h = destroyPouch(target, target.hand.length <= 4 ? 2 : 1); if (h > 0 || target.hand.length <= 4) actor.actingDone = true; } break;
    case 'devil_desire': if (target) { if (target.hand.length > 0) actor.hand.push(target.hand.pop()); else destroyPouch(target, 1); actor.actingDone = true; } break;
    case 'abyssal_filth': {
      let t = 0; for (const o of others) if (o.hand.length > 5) t += forceDiscard(o, o.hand.length - 5, false);
      if (t > 0) actor.actingDone = true;
      break;
    }
    case 'blatherer_2': if (target) { forceDiscard(target, 2); if (target.hand.length <= 2 || target.skipNextTurn) actor.actingDone = true; } break;
    case 'massacre_aoe': {
      if (actor.hand.length > 0) grave.unshift(actor.hand.pop());
      let h = 0; for (const o of others) if (o.hand.length <= 5) h += destroyPouch(o, 1);
      if (h > 0) actor.actingDone = true;
      break;
    }
    case 'filthy_monarch': {
      if (target) {
        forceDiscard(target, 2);
        if (target.hand.length <= 1 || target.skipNextTurn) {
          actor.hand.push(...drawN(2));
          if (actor.pouch.length < 3 && actor.hand.length > 0) actor.pouch.push(actor.hand.pop());
          actor.actingDone = true;
        }
      }
      break;
    }
    case 'savant_subtract': actor.mods.savantSubtract = true; if (actor.pouch.length >= 2) actor.actingDone = true; break;
    case 'appraiser_draw': { const hf = actor.hand.some(isFaceCard); actor.hand.push(...drawN(hf ? 2 : 1)); if (hf) actor.actingDone = true; break; }
    case 'artisan_artifact': actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 2; actor.hand.push(...drawN(1)); actor.actingDone = true; break;
    case 'astronomer_wild': actor.mods.astronomerWild = true; if (actor.hand.some(c => c.rank === 1 || c.rank === 10)) actor.actingDone = true; break;
    case 'transmute_trump': actor.mods.countsAsTrump = true; break;
    case 'hand_ascend': actor.mods.handAscend = true; break;
    case 'night_owl': actor.hand.push(...drawN(1)); actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 1; actor.actingDone = true; break;
    case 'eternal_night': for (const o of others) forceDiscard(o, 1); actor.mods.eternalNight = true; break;
    case 'swap_own_pouch': if (actor.pouch.length > 0 && actor.hand.length > 0) { const pc = actor.pouch.pop(); actor.pouch.push(actor.hand.pop()); actor.hand.push(pc); actor.actingDone = true; } break;
    case 'extra_pouch_add': if (actor.pouch.length < maxP && actor.hand.length > 0) { actor.pouch.push(actor.hand.pop()); actor.actingDone = true; } if (actor.pathwayId === 21) actor.hand.push(...drawN(1)); break;
    case 'cups_are_trump': actor.mods.cupsAreTrump = true; break;
    case 'life_giver': actor.hand.push(...drawN(actor.hand.length <= 3 ? 3 : 2)); break;
    case 'crimson_moon': if (target && target.pouch.length > 0 && !target.mods.pouchImmune) actor.hand.push(target.pouch.pop()); actor.hand.push(...drawN(1)); break;
    case 'bard_inspire': actor.hand.push(...drawN(1)); if (target) target.hand.push(...drawN(1)); actor.actingDone = true; break;
    case 'flash_light': { const d = drawN(1); actor.hand.push(...d); if (d[0] && (d[0].suit === 'cups' || d[0].suit === 'pentacles')) { actor.hand.push(...drawN(1)); actor.actingDone = true; } break; }
    case 'notary_pact': if (actor.hand.length > 0 && target && target.hand.length > 0) { const t = actor.hand.pop(); actor.hand.push(target.hand.pop()); target.hand.push(t); actor.hand.push(...drawN(1)); target.hand.push(...drawN(1)); actor.actingDone = true; } break;
    case 'sun_protect': actor.mods.sunFloor = true; actor.hand.push(...drawN(1)); break;
    case 'radiant_law': for (const pl of players) pl.hand.push(...drawN(1)); actor.actingDone = true; break;
    case 'sun_boost': actor.mods.sunBoost = 3; break;
    case 'white_angel': actor.hand.push(...drawN(2)); for (const o of others) o.mods = {}; break;
    case 'arbiter_auth': actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 1; actor.mods.arbiterTrumpDraw = true; break;
    case 'interrogator': if (target) { const ts = getCardSuit(trumpCardRef.card); forceDiscard(target, ts && target.hand.some(c => getCardSuit(c) === ts) ? 2 : 1); actor.actingDone = true; } break;
    case 'forbid_swords': roundMods.forbidSuit = 'swords'; roundMods.forbidOwner = actor.id; actor.actingDone = true; break;
    case 'balancer_equalize': for (const o of others) { const diff = Math.min(2, Math.max(0, o.hand.length - actor.hand.length)); if (diff > 0) forceDiscard(o, diff); } break;
    case 'supreme_verdict': roundMods.abolishTrump = true; actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 2; break;
    case 'doctor_heal': if (grave.length > 0) { actor.hand.push(grave.shift()); actor.actingDone = true; } actor.mods.handImmune = true; break;
    case 'harvest_draw': actor.hand.push(...drawN(actor.pouch.length >= 3 ? 2 : 1)); if (actor.pouch.length >= 3) actor.actingDone = true; break;
    case 'grave_to_pouch_free': { const idx = grave.findIndex(c => c.type === 'minor'); if (idx !== -1 && actor.pouch.length < maxP) { actor.pouch.push(grave.splice(idx, 1)[0]); actor.actingDone = true; } break; }
    case 'world_tree': actor.mods.pouchImmune = true; actor.mods.mathLeeway = 2; break;
    default: actor.hand.push(...drawN(1)); break;
  }
}


export { pickDiscardCardIdx, discardSmart, applyHeadlessChaos, applyHeadlessAbility };
