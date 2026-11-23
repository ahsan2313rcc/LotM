/**
 * Curriculum: train Hard NN vs rising heuristic depth, then final eval vs depth-6.
 * node scripts/curriculum-train.mjs
 */
import fs from 'fs';
import { PATHWAYS } from '../src/data/constants.js';
import { CardIdNeuralNet } from '../src/ai/CardIdNeuralNet.js';
import { runHeadlessGame } from '../src/ai/headless.js';

const WEIGHTS_PATH = 'data/nn_medium_champion.json';
const HAND = '10-7';
const MAX_ROUNDS = 75;

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
  // Mutate policy heads + more of the network than stock CEM
  for (let i = 0; i < n.outSize; i++) {
    if (Math.random() < 0.55) n.b2[i] = Math.max(-4, Math.min(4, n.b2[i] + sigma * gauss()));
    for (let j = 0; j < n.hidSize; j++) {
      if (Math.random() < 0.18) n.w2[i][j] = Math.max(-2.5, Math.min(2.5, n.w2[i][j] + sigma * 0.2 * gauss()));
    }
  }
  for (let i = 0; i < n.hidSize; i++) {
    if (Math.random() < 0.25) n.b1[i] = Math.max(-3, Math.min(3, n.b1[i] + sigma * 0.5 * gauss()));
    for (let j = 0; j < n.inSize; j++) {
      if (Math.random() < 0.08) n.w1[i][j] = Math.max(-2, Math.min(2, n.w1[i][j] + sigma * 0.15 * gauss()));
    }
  }
  return n;
}

function cemAtDepth(champNN, depth, gens) {
  console.log(`\nCEM @ depth ${depth} · ${gens} gens`);
  let promotions = 0;
  for (let gen = 1; gen <= gens; gen++) {
    const sigma = 0.40 * Math.pow(0.90, gen - 1);
    const genSeed = Math.floor(100000 + Math.random() * 8999999);
    const cands = [new CardIdNeuralNet(champNN.championSnapshot || champNN.serialize())];
    for (let k = 0; k < 6; k++) cands.push(mutateNet(champNN, sigma));
    const scores = cands.map((c, idx) => ({ idx, rate: evalVsDepth(c, depth, 160, genSeed + idx * 31).rate }));
    const base = scores[0].rate;
    const best = scores.slice(1).sort((a, b) => b.rate - a.rate)[0];
    let disp = Math.round(base * 100);
    let action = 'keep';
    if (best && best.rate > base + 0.01) {
      const cSeed = Math.floor(100000 + Math.random() * 8999999);
      const rC = evalVsDepth(cands[0], depth, 240, cSeed);
      const rE = evalVsDepth(cands[best.idx], depth, 240, cSeed);
      if (rE.rate > rC.rate) {
        champNN.softUpdateFrom(cands[best.idx], 0.8);
        champNN.updatesCount++;
        champNN.bestValRate = Math.max(champNN.bestValRate || 0, rE.rate);
        champNN.championWinRate = rE.rate;
        champNN.bestValSnapshot = champNN.serialize();
        champNN.bestValSnapshot.championWinRate = rE.rate;
        champNN.championSnapshot = champNN.bestValSnapshot;
        promotions++;
        action = 'saved';
        disp = Math.round(rE.rate * 100);
      } else disp = Math.round(rC.rate * 100);
    }
    champNN.gamesTrained += 160 * cands.length;
    console.log(`  d${depth} gen ${gen}/${gens}: ${disp}% (${action})`);
  }
  return promotions;
}

function a2cAtDepth(champNN, depth, episodes) {
  console.log(`\nA2C @ depth ${depth} · ${episodes} eps`);
  let challenger = new CardIdNeuralNet(champNN.championSnapshot || champNN.serialize());
  let refClone = new CardIdNeuralNet(champNN.championSnapshot || champNN.serialize());
  let done = 0, inBatch = 0, sinceVal = 0, promotions = 0;
  while (done < episodes) {
    const pairSeed = Math.floor(100000 + Math.random() * 8999999);
    const paths = shuffle(PATHWAYS.map(p => p.id)).slice(0, 2);
    for (let side = 0; side < 2 && done < episodes; side++) {
      const ordered = side === 0 ? paths : [paths[1], paths[0]];
      runHeadlessGame({
        playerCount: 2, handLimitMode: HAND,
        aiMode: side === 0 ? 'nn_vs_heuristic' : 'heuristic_vs_nn',
        heuristicDepth: depth, nn: challenger, refNN: refClone,
        training: true, learnFromHeuristic: true,
        fixedPathways: ordered, seed: pairSeed, maxRounds: MAX_ROUNDS,
        initialDealerIdx: side
      });
      done++; inBatch++; champNN.gamesTrained++;
    }
    if (inBatch >= 24) {
      inBatch = 0;
      champNN.softUpdateFrom(challenger, 0.08);
      champNN.updatesCount++;
      champNN.championSnapshot = champNN.serialize();
      refClone = new CardIdNeuralNet(champNN.championSnapshot);
      challenger = new CardIdNeuralNet(champNN.championSnapshot);
    }
    sinceVal++;
    if (sinceVal >= 400 || done >= episodes) {
      sinceVal = 0;
      const r = evalVsDepth(champNN, depth, 200, Math.floor(Math.random() * 1e7));
      const prev = champNN.bestValRate || 0;
      let action = 'keep';
      if (r.rate > prev + 0.01 || prev === 0) {
        champNN.bestValRate = r.rate;
        champNN.championWinRate = r.rate;
        champNN.bestValSnapshot = champNN.serialize();
        champNN.bestValSnapshot.championWinRate = r.rate;
        champNN.championSnapshot = champNN.bestValSnapshot;
        promotions++;
        action = 'saved';
      } else if (r.rate < prev - 0.12 && champNN.bestValSnapshot) {
        champNN.loadSnapshot(champNN.bestValSnapshot);
        champNN.championSnapshot = champNN.bestValSnapshot;
        challenger = new CardIdNeuralNet(champNN.championSnapshot);
        refClone = new CardIdNeuralNet(champNN.championSnapshot);
        action = 'rollback';
      }
      console.log(`  d${depth} A2C ${done}/${episodes}: ${Math.round(r.rate * 100)}% (${action})`);
    }
  }
  return promotions;
}

let nn = fs.existsSync(WEIGHTS_PATH)
  ? new CardIdNeuralNet(JSON.parse(fs.readFileSync(WEIGHTS_PATH, 'utf8')))
  : new CardIdNeuralNet();
console.log('Start win% vs d6:', Math.round((nn.championWinRate || 0) * 100));

const stages = [
  { depth: 2, cem: 8, a2c: 4000 },
  { depth: 3, cem: 8, a2c: 4000 },
  { depth: 4, cem: 10, a2c: 6000 },
  { depth: 5, cem: 10, a2c: 6000 },
  { depth: 6, cem: 15, a2c: 10000 }
];

for (const st of stages) {
  nn.bestValRate = 0; // allow fresh promotions at each depth tier
  cemAtDepth(nn, st.depth, st.cem);
  a2cAtDepth(nn, st.depth, st.a2c);
  const snap = nn.bestValSnapshot || nn.serialize();
  snap.championWinRate = nn.championWinRate || 0;
  snap.savedAt = new Date().toISOString();
  fs.writeFileSync(WEIGHTS_PATH, JSON.stringify(snap));
  const vs6 = evalVsDepth(nn, 6, 400, Math.floor(Math.random() * 1e7));
  console.log(`>> After depth-${st.depth} curriculum: vs d6 = ${Math.round(vs6.rate * 100)}%`);
  if (vs6.rate >= 0.80) {
    console.log('HIT 80% target!');
    nn.championWinRate = vs6.rate;
    nn.bestValSnapshot = nn.serialize();
    nn.bestValSnapshot.championWinRate = vs6.rate;
    fs.writeFileSync(WEIGHTS_PATH, JSON.stringify(nn.bestValSnapshot));
    break;
  }
}

const final = evalVsDepth(nn, 6, 1000, Math.floor(Math.random() * 1e7));
console.log(`\nFINAL vs depth-6 (1000g): ${Math.round(final.rate * 100)}% W / ${Math.round(final.draws / final.games * 100)}% D / ${Math.round(final.losses / final.games * 100)}% L`);
nn.championWinRate = final.rate;
nn.bestValSnapshot = nn.serialize();
nn.bestValSnapshot.championWinRate = final.rate;
fs.writeFileSync(WEIGHTS_PATH, JSON.stringify(nn.bestValSnapshot));
console.log('Saved', WEIGHTS_PATH);
