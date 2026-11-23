/**
 * Focused NN Medium training vs Heuristic Depth 6, target ≥80% win rate.
 * Usage: node scripts/train-medium-vs-d6.mjs [--cem 30] [--a2c 12000] [--eval 600]
 */
import fs from 'fs';
import { PATHWAYS } from '../src/data/constants.js';
import { CardIdNeuralNet } from '../src/ai/CardIdNeuralNet.js';
import { runHeadlessGame } from '../src/ai/headless.js';

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : def;
};

const CEM_GENS = getArg('--cem', 36);
const A2C_EPS = getArg('--a2c', 16000);
const EVAL_GAMES = getArg('--eval', 800);
const TARGET = 0.80;
const HAND = '10-7';
const MAX_ROUNDS = 75;
const DEPTH = 6;
const WEIGHTS_PATH = 'data/nn_medium_champion.json';
const LEGACY_PATH = 'data/nn_hard_champion.json';

fs.mkdirSync('data', { recursive: true });

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function evalVsDepth(nn, depth, count, seedOffset) {
  let wins = 0, draws = 0, losses = 0, winRounds = 0;
  for (let idx = 0; idx < count; idx++) {
    const pairIdx = Math.floor(idx / 2);
    const side = idx % 2;
    const p1 = (pairIdx * 7 + (seedOffset % 22)) % 22;
    const p2Raw = (pairIdx * 13 + 5 + (seedOffset % 19)) % 22;
    const p2 = p2Raw === p1 ? (p1 + 1) % 22 : p2Raw;
    const res = runHeadlessGame({
      playerCount: 2, handLimitMode: HAND,
      aiMode: side === 0 ? 'nn_vs_heuristic' : 'heuristic_vs_nn',
      heuristicDepth: depth, nn, training: false,
      fixedPathways: side === 0 ? [p1, p2] : [p2, p1],
      seed: seedOffset + pairIdx * 7919, maxRounds: MAX_ROUNDS
    });
    if (res.isDraw) draws++;
    else if (res.winnerBrain === 'nn') { wins++; winRounds += res.rounds; }
    else losses++;
  }
  return { wins, draws, losses, games: count, rate: wins / count, avgRds: wins ? +(winRounds / wins).toFixed(1) : null };
}

function mutateNet(baseNet, sigma) {
  const n = new CardIdNeuralNet(baseNet.serialize());
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;
  for (let i = 0; i < n.outSize; i++) {
    if (Math.random() < 0.65) n.b2[i] = Math.max(-4, Math.min(4, n.b2[i] + sigma * gauss()));
    for (let j = 0; j < n.hidSize; j++) {
      if (Math.random() < 0.22) n.w2[i][j] = Math.max(-2.5, Math.min(2.5, n.w2[i][j] + sigma * 0.22 * gauss()));
    }
  }
  for (let i = 0; i < n.hidSize; i++) {
    if (Math.random() < 0.3) n.b1[i] = Math.max(-3, Math.min(3, n.b1[i] + sigma * 0.55 * gauss()));
    for (let j = 0; j < n.inSize; j++) {
      if (Math.random() < 0.1) n.w1[i][j] = Math.max(-2, Math.min(2, n.w1[i][j] + sigma * 0.16 * gauss()));
    }
  }
  return n;
}

function save(nn, label) {
  const snap = nn.bestValSnapshot || nn.serialize();
  snap.kind = 'medium';
  snap.championWinRate = nn.championWinRate || snap.championWinRate || 0;
  snap.savedAt = new Date().toISOString();
  snap.note = label || '';
  fs.writeFileSync(WEIGHTS_PATH, JSON.stringify(snap));
  fs.writeFileSync(LEGACY_PATH, JSON.stringify(snap)); // keep legacy path in sync
  console.log(`Saved ${WEIGHTS_PATH} (${Math.round((snap.championWinRate || 0) * 100)}%) — ${label}`);
}

function loadNN() {
  const path = fs.existsSync(WEIGHTS_PATH) ? WEIGHTS_PATH : LEGACY_PATH;
  if (fs.existsSync(path)) {
    const snap = JSON.parse(fs.readFileSync(path, 'utf8'));
    console.log(`Loaded ${path} win%=${Math.round((snap.championWinRate || 0) * 100)} games=${snap.gamesTrained || 0}`);
    return new CardIdNeuralNet(snap);
  }
  console.log('Fresh Medium NN');
  return new CardIdNeuralNet();
}

let nn = loadNN();
let baseline = evalVsDepth(nn, DEPTH, 300, 424242);
nn.championWinRate = baseline.rate;
nn.bestValRate = baseline.rate;
nn.bestValSnapshot = nn.serialize();
nn.championSnapshot = nn.bestValSnapshot;
console.log(`Baseline vs d6 (300g): ${Math.round(baseline.rate * 100)}%`);

console.log(`\nCEM @ d6 · ${CEM_GENS} gens`);
for (let gen = 1; gen <= CEM_GENS; gen++) {
  const sigma = 0.48 * Math.pow(0.92, gen - 1);
  const genSeed = Math.floor(100000 + Math.random() * 8999999);
  const cands = [new CardIdNeuralNet(nn.championSnapshot || nn.serialize())];
  for (let k = 0; k < 8; k++) cands.push(mutateNet(nn, sigma));
  const scores = cands.map((c, idx) => ({ idx, rate: evalVsDepth(c, DEPTH, 180, genSeed + idx * 31).rate }));
  const base = scores[0].rate;
  const best = scores.slice(1).sort((a, b) => b.rate - a.rate)[0];
  let disp = Math.round(base * 100);
  let action = 'keep';
  if (best && best.rate > base + 0.008) {
    const cSeed = Math.floor(100000 + Math.random() * 8999999);
    const rC = evalVsDepth(cands[0], DEPTH, 280, cSeed);
    const rE = evalVsDepth(cands[best.idx], DEPTH, 280, cSeed);
    if (rE.rate > rC.rate + 0.005 && rE.rate >= (nn.bestValRate || 0) - 0.01) {
      nn.softUpdateFrom(cands[best.idx], 0.85);
      nn.updatesCount++;
      if (rE.rate > (nn.bestValRate || 0)) {
        nn.bestValRate = rE.rate;
        nn.championWinRate = rE.rate;
        nn.bestValSnapshot = nn.serialize();
        nn.bestValSnapshot.championWinRate = rE.rate;
        nn.championSnapshot = nn.bestValSnapshot;
        action = 'saved';
        disp = Math.round(rE.rate * 100);
        save(nn, `CEM gen ${gen}`);
      } else {
        action = 'soft';
        disp = Math.round(rE.rate * 100);
      }
    } else disp = Math.round(rC.rate * 100);
  }
  nn.gamesTrained += 180 * cands.length;
  console.log(`  CEM gen ${gen}/${CEM_GENS}: ${disp}% (${action})`);
  if ((nn.championWinRate || 0) >= TARGET) break;
}

console.log(`\nA2C @ d6 · ${A2C_EPS} eps`);
let challenger = new CardIdNeuralNet(nn.championSnapshot || nn.serialize());
let refClone = new CardIdNeuralNet(nn.championSnapshot || nn.serialize());
let done = 0, inBatch = 0, sinceVal = 0;
while (done < A2C_EPS && (nn.championWinRate || 0) < TARGET) {
  const pairSeed = Math.floor(100000 + Math.random() * 8999999);
  const paths = shuffle(PATHWAYS.map(p => p.id)).slice(0, 2);
  for (let side = 0; side < 2 && done < A2C_EPS; side++) {
    const ordered = side === 0 ? paths : [paths[1], paths[0]];
    runHeadlessGame({
      playerCount: 2, handLimitMode: HAND,
      aiMode: side === 0 ? 'nn_vs_heuristic' : 'heuristic_vs_nn',
      heuristicDepth: DEPTH, nn: challenger, refNN: refClone,
      training: true, learnFromHeuristic: true,
      fixedPathways: ordered, seed: pairSeed, maxRounds: MAX_ROUNDS,
      initialDealerIdx: side
    });
    done++; inBatch++; nn.gamesTrained++;
  }
  if (inBatch >= 32) {
    inBatch = 0;
    nn.softUpdateFrom(challenger, 0.1);
    nn.updatesCount++;
    nn.championSnapshot = nn.serialize();
    refClone = new CardIdNeuralNet(nn.championSnapshot);
    challenger = new CardIdNeuralNet(nn.championSnapshot);
  }
  sinceVal++;
  if (sinceVal >= 500 || done >= A2C_EPS) {
    sinceVal = 0;
    const r = evalVsDepth(nn, DEPTH, 240, Math.floor(Math.random() * 1e7));
    const prev = nn.bestValRate || 0;
    let action = 'keep';
    if (r.rate > prev + 0.008 || prev === 0) {
      nn.bestValRate = r.rate;
      nn.championWinRate = r.rate;
      nn.bestValSnapshot = nn.serialize();
      nn.bestValSnapshot.championWinRate = r.rate;
      nn.championSnapshot = nn.bestValSnapshot;
      action = 'saved';
      save(nn, `A2C ${done}`);
    } else if (r.rate < prev - 0.1 && nn.bestValSnapshot) {
      nn.loadSnapshot(nn.bestValSnapshot);
      nn.championSnapshot = nn.bestValSnapshot;
      challenger = new CardIdNeuralNet(nn.championSnapshot);
      refClone = new CardIdNeuralNet(nn.championSnapshot);
      action = 'rollback';
    }
    console.log(`  A2C ${done}/${A2C_EPS}: ${Math.round(r.rate * 100)}% (${action}) best=${Math.round((nn.bestValRate || 0) * 100)}%`);
  }
}

const final = evalVsDepth(nn, DEPTH, EVAL_GAMES, Math.floor(Math.random() * 1e7));
console.log(`\nFINAL vs depth-6 (${EVAL_GAMES}g): ${Math.round(final.rate * 100)}% W / ${Math.round(final.draws / final.games * 100)}% D / ${Math.round(final.losses / final.games * 100)}% L`);
if (final.rate > (nn.bestValRate || 0)) {
  nn.bestValRate = final.rate;
  nn.championWinRate = final.rate;
  nn.bestValSnapshot = nn.serialize();
  nn.bestValSnapshot.championWinRate = final.rate;
  nn.championSnapshot = nn.bestValSnapshot;
  save(nn, `FINAL ${EVAL_GAMES}g (new best)`);
} else if (nn.bestValSnapshot) {
  // Keep best checkpoint; don't clobber with a weaker final eval
  nn.loadSnapshot(nn.bestValSnapshot);
  nn.championWinRate = nn.bestValRate || nn.championWinRate || final.rate;
  nn.championSnapshot = nn.bestValSnapshot;
  save(nn, `FINAL keep-best ${Math.round((nn.bestValRate || 0) * 100)}% (eval was ${Math.round(final.rate * 100)}%)`);
}
if ((nn.championWinRate || 0) >= TARGET) console.log('TARGET HIT: ≥80% vs D6');
else console.log(`Still below 80% (best ${Math.round((nn.bestValRate || nn.championWinRate || 0) * 100)}%). Plain CEM/A2C is plateauing — needs feature/architecture or self-play changes.`);
