/**
 * Ascent training uses the SAME headless engine as all other NN tiers.
 * lookaheadDepth 1 = policy only (fastest); 2–5 = beam look-ahead.
 */
import { runHeadlessGame } from '../headless.js';

function summarize(res, net) {
  const seqs = (res.finalSeqs || []).map(f => (typeof f === 'object' ? f.seq : f));
  const ascendedSteps = seqs.reduce((a, s) => a + Math.max(0, 9 - (s ?? 9)), 0);
  return {
    winnerId: res.winnerId,
    rounds: res.rounds,
    finalSeqs: seqs,
    ascendedSteps,
    ascentScore: net.ascentScore || 0,
    isDraw: !!res.isDraw,
    nnWon: !res.isDraw && res.winnerId === 0
  };
}

/**
 * One 2P self-play game on the headless engine.
 * Both seats share the same AscentNet (nn + ref_nn).
 */
export function runAscentSelfPlayGame(net, {
  seed = null,
  maxRounds = 50,
  handLimitMode = '10-7',
  lookaheadDepth = 1
} = {}) {
  // Frozen copy as opponent — live net only trains seat 0 (stops +/− war on same weights)
  const frozen = new (net.constructor)(net.serialize());
  const res = runHeadlessGame({
    playerCount: 2,
    handLimitMode,
    aiMode: 'nn_selfplay',
    lookaheadDepth: Math.max(1, Math.min(5, Number(lookaheadDepth) || 1)),
    nn: net,
    refNN: frozen,
    training: true,
    learnFromHeuristic: false,
    maxRounds: Math.max(15, Math.min(75, maxRounds || 50)),
    seed: seed != null ? seed : Math.floor(Math.random() * 1e9)
  });
  return summarize(res, net);
}

/**
 * One 2P curriculum game: AscentNet (seat 0) vs heuristic depth (seat 1).
 */
export function runAscentVsHeuristicGame(net, {
  heuristicDepth = 2,
  seed = null,
  maxRounds = 50,
  handLimitMode = '10-7',
  lookaheadDepth = 1
} = {}) {
  const depth = Math.max(1, Math.min(6, Number(heuristicDepth) || 2));
  const res = runHeadlessGame({
    playerCount: 2,
    handLimitMode,
    seatConfigs: [
      { type: 'nn_ascent', depth: 5 },
      { type: 'heuristic', depth }
    ],
    nnAscent: net,
    nn: net,
    lookaheadDepth: Math.max(1, Math.min(5, Number(lookaheadDepth) || 1)),
    training: true,
    learnFromHeuristic: false,
    maxRounds: Math.max(15, Math.min(75, maxRounds || 50)),
    seed: seed != null ? seed : Math.floor(Math.random() * 1e9)
  });
  return { ...summarize(res, net), sparDepth: depth };
}

// Re-export for any tooling that still imports apply from here
export { applyHeadlessChaos, applyHeadlessAbility } from '../headless.js';
