import { MODE, cardUniqueId, seqAbilitySlot } from './zones.js';
import { findValidAscensionSubset } from '../../utils/rules.js';

/**
 * Enumerate legal actions for seat under current phase / pending.
 * Chaos/Ability offered whenever seat can act and preconditions hold (instant-capable phases).
 */
export function getLegalActions(state, seat) {
  const p = state.players?.[seat];
  if (!p) return [];
  const actions = [];
  const phase = String(state.phase || '').toUpperCase();
  const pi = state.pendingInteraction;
  const opps = (state.players || []).filter(o => o.id !== seat && !o.skippedThisRound);
  const addTargeted = (base) => {
    if (!opps.length) {
      actions.push({ ...base, targetIdx: -1, targetId: null });
      return;
    }
    opps.forEach((o, i) => actions.push({ ...base, targetIdx: i, targetId: o.id }));
  };

  // Interrupt response
  if (pi?.type === 'INTERRUPT' && (pi.targetId === seat || pi.defenderId === seat || state.interruptSeat === seat)) {
    actions.push({ mode: MODE.INTERRUPT_PASS });
    const hasKnight = (p.hand || []).some(c => c.type === 'minor' && c.rank === 12 && c.suit === 'swords');
    const hasQueen = (p.hand || []).some(c => c.type === 'minor' && c.rank === 13 && c.suit === 'wands');
    if ((pi.attackType === 'sword' && hasKnight) || (pi.attackType === 'wand' && hasQueen)) {
      const block = (p.hand || []).find(c =>
        pi.attackType === 'sword' ? (c.rank === 12 && c.suit === 'swords') : (c.rank === 13 && c.suit === 'wands')
      );
      actions.push({ mode: MODE.INTERRUPT_BLOCK, cardId: cardUniqueId(block), cardUid: block?.uid });
    }
    // Instants on interrupt
    pushChaosAndAbility(actions, p, opps, addTargeted, true);
    return actions;
  }

  if (pi?.type === 'CHOOSE_DISCARD' && (pi.playerId === seat || state.toMove === seat)) {
    for (const c of p.hand || []) {
      actions.push({ mode: MODE.CHOOSE_DISCARD, cardId: cardUniqueId(c), cardUid: c.uid });
    }
    if (!actions.length) actions.push({ mode: MODE.PASS });
    return actions;
  }

  if (pi?.type === 'GAMBLE_SUIT' || (phase.includes('REWARD') && state.trickWinnerId === seat)) {
    actions.push({ mode: MODE.TAKE_TRUMP });
    ['swords', 'wands', 'pentacles', 'cups'].forEach((suit, i) => {
      actions.push({ mode: MODE.GAMBLE, targetIdx: i, suit });
    });
    pushChaosAndAbility(actions, p, opps, addTargeted, false);
    return actions;
  }

  // Mental break: no voluntary actions
  if (p.skipNextTurn || p.skippedThisRound) {
    return [{ mode: MODE.PASS }];
  }

  if (phase.includes('POUCH')) {
    const maxP = p.mods?.maxPouch || 3;
    if ((p.pouch?.length || 0) < maxP) {
      for (const c of p.hand || []) {
        if (c.type === 'minor') {
          actions.push({ mode: MODE.TUCK, cardId: cardUniqueId(c), cardUid: c.uid });
        }
      }
    }
    for (const c of p.pouch || []) {
      actions.push({ mode: MODE.POUCH_DISCARD, cardId: cardUniqueId(c), cardUid: c.uid });
    }
    actions.push({ mode: MODE.DONE_POUCH });
    pushChaosAndAbility(actions, p, opps, addTargeted, false);
    return dedupe(actions);
  }

  if (phase.includes('DRAFT') && state.toMove === seat) {
    for (const c of state.centerDraft || []) {
      actions.push({ mode: MODE.DRAFT, cardId: cardUniqueId(c), cardUid: c.uid });
    }
    pushChaosAndAbility(actions, p, opps, addTargeted, false);
    return dedupe(actions);
  }

  if (phase === 'TRICK' && state.toMove === seat) {
    for (const c of p.hand || []) {
      const needsT = c.type === 'minor' && (c.suit === 'swords' || c.suit === 'wands' || c.rank === 14);
      if (needsT && opps.length) addTargeted({ mode: MODE.PLAY_TRICK, cardId: cardUniqueId(c), cardUid: c.uid });
      else actions.push({ mode: MODE.PLAY_TRICK, cardId: cardUniqueId(c), cardUid: c.uid, targetIdx: -1, targetId: null });
    }
    pushChaosAndAbility(actions, p, opps, addTargeted, false);
    return dedupe(actions);
  }

  if (phase.includes('ASCEND')) {
    if (!p.ascendedThisRound && findValidAscensionSubset(p.pouch || [], p.seq, p.mods || {})) {
      actions.push({ mode: MODE.ASCEND });
    }
    actions.push({ mode: MODE.SKIP_ASCEND });
    pushChaosAndAbility(actions, p, opps, addTargeted, false);
    return dedupe(actions);
  }

  pushChaosAndAbility(actions, p, opps, addTargeted, false);
  if (!actions.length) actions.push({ mode: MODE.PASS });
  return dedupe(actions);
}

function pushChaosAndAbility(actions, p, opps, addTargeted, asInterrupt) {
  if (!p.abilityUsed) {
    const slot = seqAbilitySlot(p.seq);
    if (slot >= 0) {
      const base = { mode: MODE.CAST_ABILITY, abilitySlot: slot, asInterrupt: !!asInterrupt };
      if (opps.length) addTargeted(base);
      else actions.push({ ...base, targetIdx: -1, targetId: null });
    }
  }
  const majors = (p.hand || []).filter(c => c.type === 'major');
  for (const m of majors) {
    // Fool(0)/Tower(16) need trump — caller state may not have it; still list and let engine reject
    const base = { mode: MODE.CHAOS_MAJOR, cardId: cardUniqueId(m), cardUid: m.uid, majorId: m.majorId };
    const targeted = [1, 3, 6, 17].includes(m.majorId);
    if (targeted && opps.length) addTargeted(base);
    else actions.push({ ...base, targetIdx: -1, targetId: null });
  }
}

function dedupe(actions) {
  const seen = new Set();
  const out = [];
  for (const a of actions) {
    const k = `${a.mode}|${a.cardId}|${a.targetId}|${a.abilitySlot}|${a.suit}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}
