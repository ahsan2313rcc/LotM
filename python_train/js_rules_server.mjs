/**
 * JSON-line worker: runs live JS ability/chaos so Python stays in sync with headless.
 * Protocol (stdin/stdout, one JSON object per line):
 *   {"op":"ping"} -> {"ok":true}
 *   {"op":"chaos", "state":{...}, "actorId":0, "majorUid":..., "targetId":null|n}
 *   {"op":"ability","state":{...}, "actorId":0, "tag":"...", "targetId":null|n, "copyDepth":0}
 * state cards use: {uid,type,suit,rank,majorId}
 */
import { createInterface } from 'readline';
import { applyHeadlessChaos, applyHeadlessAbility } from '../src/ai/engineCore.js';

function revive(state) {
  // Ensure arrays exist
  state.players = state.players || [];
  state.deck = state.deck || [];
  state.grave = state.grave || [];
  state.roundMods = state.roundMods || {};
  for (const p of state.players) {
    p.hand = p.hand || [];
    p.pouch = p.pouch || [];
    p.mods = p.mods || {};
    p.faceCounts = p.faceCounts || { K: 0, Q: 0, N: 0, P: 0 };
    if (p.skippedThisRound == null) p.skippedThisRound = false;
    if (p.actingDone == null) p.actingDone = false;
    if (p.abilityUsed == null) p.abilityUsed = false;
    if (p.skipNextTurn == null) p.skipNextTurn = false;
  }
  return state;
}

function drawNFactory(state) {
  return (n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      if (!state.deck.length && state.grave.length) {
        state.deck = state.grave.splice(0).sort(() => Math.random() - 0.5);
      }
      if (state.deck.length) out.push(state.deck.shift());
    }
    return out;
  };
}

function findCard(zone, uid) {
  return zone.find(c => c.uid === uid) || null;
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: 'bad_json' }) + '\n');
    return;
  }
  try {
    if (req.op === 'ping') {
      process.stdout.write(JSON.stringify({ ok: true }) + '\n');
      return;
    }
    const state = revive(req.state);
    const actor = state.players.find(p => p.id === req.actorId);
    if (!actor) throw new Error('actor_missing');
    const target = req.targetId == null ? null : state.players.find(p => p.id === req.targetId);
    const drawN = drawNFactory(state);

    if (req.op === 'chaos') {
      const major = findCard(actor.hand, req.majorUid) || req.majorCard;
      if (!major) throw new Error('major_missing');
      // JS chaos expects major already removed from hand in some paths; headless removes before call.
      actor.hand = actor.hand.filter(c => c.uid !== major.uid);
      const trumpRef = { card: state.trumpCard || null };
      // applyHeadlessChaos returns new trump
      const newTrump = applyHeadlessChaos(
        actor, major, target, state.players, state.deck, state.grave,
        trumpRef.card, state.roundMods, drawN, Math.random
      );
      state.trumpCard = newTrump;
      process.stdout.write(JSON.stringify({ ok: true, state }) + '\n');
      return;
    }

    if (req.op === 'ability') {
      const trumpRef = { card: state.trumpCard || null };
      applyHeadlessAbility(
        actor, state.players, target, state.deck, state.grave, trumpRef,
        state.roundMods, drawN, req.tag || null, req.copyDepth || 0
      );
      state.trumpCard = trumpRef.card;
      process.stdout.write(JSON.stringify({ ok: true, state }) + '\n');
      return;
    }

    process.stdout.write(JSON.stringify({ ok: false, error: 'unknown_op' }) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }) + '\n');
  }
});
