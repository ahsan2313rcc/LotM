/**
 * Train Hard NN vs depth-6 heuristic, evaluate to >75%, then 22×22 round-robin.
 * Usage: node scripts/train-eval-rr.mjs [--cem 40] [--a2c 20000] [--eval 1000] [--rr-seeds 2] [--skip-train]
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
const hasFlag = (name) => args.includes(name);

const CEM_GENS = getArg('--cem', 40);
const A2C_EPS = getArg('--a2c', 20000);
const EVAL_GAMES = getArg('--eval', 1000);
const RR_SEEDS = getArg('--rr-seeds', 2);
const SKIP_TRAIN = hasFlag('--skip-train');
const TARGET = 0.80;
const HAND = '10-7';
const MAX_ROUNDS = 75;
const WEIGHTS_PATH = 'data/nn_medium_champion.json';
const RR_PATH = 'data/rr_pathway_matrix.json';
const REPORT_PATH = 'data/balance_report.json';

fs.mkdirSync('data', { recursive: true });

const shuffle = (arr, rng = Math.random) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function loadOrFresh() {
  if (fs.existsSync(WEIGHTS_PATH)) {
    try {
      const snap = JSON.parse(fs.readFileSync(WEIGHTS_PATH, 'utf8'));
      console.log(`Loaded weights from ${WEIGHTS_PATH} (gamesTrained=${snap.gamesTrained || 0}, win%=${Math.round((snap.championWinRate || 0) * 100)})`);
      return new CardIdNeuralNet(snap);
    } catch (_) {}
  }
  console.log('Starting from fresh Medium NN priors');
  return new CardIdNeuralNet();
}

function saveNN(nn, rate = null) {
  const snap = nn.bestValSnapshot || nn.serialize();
  if (rate != null) snap.championWinRate = rate;
  snap.savedAt = new Date().toISOString();
  fs.writeFileSync(WEIGHTS_PATH, JSON.stringify(snap));
  nn.bestValSnapshot = snap;
  nn.championSnapshot = snap;
  nn.championWinRate = snap.championWinRate || 0;
  nn.bestValRate = snap.championWinRate || 0;
}

/** Paired-seed validation vs depth-6 (same protocol as App runValSliceAsync). */
function evalVsDepth6(nn, count, seedOffset) {
  let wins = 0, draws = 0, losses = 0, seq0 = 0, winRounds = 0;
  for (let idx = 0; idx < count; idx++) {
    const pairIdx = Math.floor(idx / 2);
    const side = idx % 2;
    const p1 = (pairIdx * 7 + (seedOffset % 22)) % 22;
    const p2Raw = (pairIdx * 13 + 5 + (seedOffset % 19)) % 22;
    const p2 = p2Raw === p1 ? (p1 + 1) % 22 : p2Raw;
    const res = runHeadlessGame({
      playerCount: 2,
      handLimitMode: HAND,
      aiMode: side === 0 ? 'nn_vs_heuristic' : 'heuristic_vs_nn',
      heuristicDepth: 6,
      nn,
      training: false,
      fixedPathways: side === 0 ? [p1, p2] : [p2, p1],
      seed: seedOffset + pairIdx * 7919,
      maxRounds: MAX_ROUNDS
    });
    if (res.isDraw) draws++;
    else if (res.winnerBrain === 'nn') { wins++; winRounds += res.rounds; }
    else losses++;
    if (res.wonBySeq0) seq0++;
  }
  const games = Math.max(1, count);
  return {
    games, wins, draws, losses, seq0, winRounds,
    rate: wins / games,
    avgRds: wins > 0 ? +(winRounds / wins).toFixed(1) : null
  };
}

function mutateNet(baseNet, sigma) {
  const n = new CardIdNeuralNet(baseNet.serialize());
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;
  for (let i = 29; i < 50; i++) {
    if (Math.random() < 0.45) n.b2[i] = Math.max(-4, Math.min(4, n.b2[i] + sigma * gauss()));
    if (Math.random() < 0.25) {
      for (let j = 0; j < n.hidSize; j++) {
        if (Math.random() < 0.2) n.w2[i][j] = Math.max(-2, Math.min(2, n.w2[i][j] + (sigma * 0.15) * gauss()));
      }
    }
  }
  return n;
}

function runCem(champNN, numGens) {
  console.log(`\n=== CEM Training: ${numGens} gens vs depth-6 ===`);
  if (champNN.bestValSnapshot) {
    champNN.loadSnapshot(champNN.bestValSnapshot);
    champNN.championSnapshot = champNN.bestValSnapshot;
  }
  let promotions = 0;
  for (let gen = 1; gen <= numGens; gen++) {
    const t0 = Date.now();
    const sigma = 0.32 * Math.pow(0.92, gen - 1);
    const genSeed = Math.floor(100000 + Math.random() * 8999999);
    const cands = [new CardIdNeuralNet(champNN.championSnapshot || champNN.serialize())];
    for (let k = 0; k < 4; k++) cands.push(mutateNet(champNN, sigma));
    const scores = cands.map((c, idx) => {
      const r = evalVsDepth6(c, 200, genSeed + idx * 17);
      champNN.gamesTrained += r.games;
      return { idx, rate: r.rate, r };
    });
    const baseRate = scores[0].rate;
    const bestChall = scores.slice(1).sort((a, b) => b.rate - a.rate)[0];
    let dispRate = Math.round(baseRate * 100);
    let action = 'keep';
    if (bestChall && bestChall.rate > baseRate + 0.015) {
      const cSeed = Math.floor(100000 + Math.random() * 8999999);
      const rC = evalVsDepth6(cands[0], 300, cSeed);
      const rE = evalVsDepth6(cands[bestChall.idx], 300, cSeed);
      champNN.gamesTrained += rC.games + rE.games;
      const champR = rC.wins / rC.games;
      const eliteR = rE.wins / rE.games;
      if (eliteR > champR) {
        champNN.softUpdateFrom(cands[bestChall.idx], 0.75);
        champNN.updatesCount++;
        champNN.bestValRate = Math.max(champNN.bestValRate || 0, eliteR);
        champNN.championWinRate = eliteR;
        champNN.bestValSnapshot = champNN.serialize();
        champNN.bestValSnapshot.championWinRate = eliteR;
        champNN.championSnapshot = champNN.bestValSnapshot;
        saveNN(champNN, eliteR);
        promotions++;
        action = 'saved';
        dispRate = Math.round(eliteR * 100);
      } else {
        dispRate = Math.round(champR * 100);
      }
    }
    console.log(`  Gen ${gen}/${numGens}: ${dispRate}% (${action}) · σ=${sigma.toFixed(3)} · ${Date.now() - t0}ms · prom=${promotions}`);
    if ((champNN.championWinRate || 0) >= TARGET) {
      console.log(`  Target ${TARGET * 100}% reached during CEM.`);
      break;
    }
  }
  return promotions;
}

function runA2C(champNN, totalEpisodes) {
  console.log(`\n=== A2C Training: ${totalEpisodes} episodes vs depth-6 ===`);
  const batchN = 20;
  const trainAlpha = 0.06;
  const trainDepth = 6;
  let challenger = new CardIdNeuralNet(champNN.championSnapshot || champNN.serialize());
  let refClone = new CardIdNeuralNet(champNN.championSnapshot || champNN.serialize());
  let done = 0;
  let inBatch = 0;
  let sinceVal = 0;
  let promotions = 0;

  while (done < totalEpisodes) {
    const pairSeed = Math.floor(100000 + Math.random() * 8999999);
    const pairPaths = shuffle(PATHWAYS.map(p => p.id)).slice(0, 2);
    for (let side = 0; side < 2 && done < totalEpisodes; side++) {
      const ordered = side === 0 ? pairPaths : [pairPaths[1], pairPaths[0]];
      runHeadlessGame({
        playerCount: 2,
        handLimitMode: HAND,
        aiMode: 'nn_vs_heuristic',
        heuristicDepth: trainDepth,
        nn: challenger,
        refNN: refClone,
        training: true,
        learnFromHeuristic: true,
        fixedPathways: ordered,
        seed: pairSeed,
        maxRounds: MAX_ROUNDS,
        initialDealerIdx: side % 2
      });
      // Also train when NN is seat 1 (heuristic_vs_nn) so both seats contribute
      runHeadlessGame({
        playerCount: 2,
        handLimitMode: HAND,
        aiMode: 'heuristic_vs_nn',
        heuristicDepth: trainDepth,
        nn: challenger,
        refNN: refClone,
        training: true,
        learnFromHeuristic: true,
        fixedPathways: ordered,
        seed: pairSeed + 1,
        maxRounds: MAX_ROUNDS,
        initialDealerIdx: side % 2
      });
      done += 2;
      inBatch += 2;
      champNN.gamesTrained += 2;
    }
    if (inBatch >= batchN || done >= totalEpisodes) {
      inBatch = 0;
      champNN.softUpdateFrom(challenger, trainAlpha);
      champNN.updatesCount++;
      champNN.championSnapshot = champNN.serialize();
      refClone = new CardIdNeuralNet(champNN.championSnapshot);
      challenger = new CardIdNeuralNet(champNN.championSnapshot);
    }
    sinceVal += 2;
    if (sinceVal >= 500 || done >= totalEpisodes) {
      sinceVal = 0;
      const seed = Math.floor(100000 + Math.random() * 8999999);
      const r = evalVsDepth6(champNN, 200, seed);
      const prev = champNN.bestValRate || 0;
      let action = 'keep';
      if (r.rate > prev + 0.015 || prev === 0) {
        champNN.bestValRate = r.rate;
        champNN.championWinRate = r.rate;
        champNN.bestValSnapshot = champNN.serialize();
        champNN.bestValSnapshot.championWinRate = r.rate;
        champNN.championSnapshot = champNN.bestValSnapshot;
        saveNN(champNN, r.rate);
        promotions++;
        action = 'saved';
      } else if (r.rate < prev - 0.10 && champNN.bestValSnapshot) {
        champNN.loadSnapshot(champNN.bestValSnapshot);
        champNN.championSnapshot = champNN.bestValSnapshot;
        challenger = new CardIdNeuralNet(champNN.championSnapshot);
        refClone = new CardIdNeuralNet(champNN.championSnapshot);
        action = 'rollback';
      }
      console.log(`  A2C ${done}/${totalEpisodes}: val ${Math.round(r.rate * 100)}% (${action}) · prom=${promotions}`);
      if ((champNN.championWinRate || 0) >= TARGET) {
        console.log(`  Target ${TARGET * 100}% reached during A2C.`);
        break;
      }
    }
  }
  return promotions;
}

function runRoundRobin(brainMode, seedsN, nn = null) {
  console.log(`\n=== Round Robin 22×22 · ${seedsN} seed(s) · brains=${brainMode} ===`);
  const matrix = Array.from({ length: 22 }, () => Array.from({ length: 22 }, () => ({ w: 0, g: 0 })));
  const pathwayStats = Object.fromEntries(PATHWAYS.map(p => [p.id, {
    id: p.id, arcana: p.arcana, lotm: p.lotm,
    games: 0, wins: 0, losses: 0, draws: 0, seq0Wins: 0, seqSum: 0
  }]));

  const parseBrain = (val) => {
    if (val === 'nn_medium') return { type: 'nn_medium', depth: 6 };
    const d = Number(String(val).split('_')[1]) || 6;
    return { type: 'heuristic', depth: d };
  };
  const p1Cfg = parseBrain(brainMode === 'nn' ? 'nn_medium' : 'heuristic_6');
  const p2Cfg = parseBrain(brainMode === 'nn' ? 'nn_medium' : 'heuristic_6');

  const schedule = [];
  for (let sIdx = 0; sIdx < seedsN; sIdx++) {
    const seedVal = Math.floor(Math.random() * 2147483647);
    for (let i = 0; i < 22; i++) {
      for (let j = i; j < 22; j++) {
        schedule.push({ p1: i, p2: j, seed: seedVal });
        schedule.push({ p1: j, p2: i, seed: seedVal });
      }
    }
  }

  const t0 = Date.now();
  let done = 0;
  for (const match of schedule) {
    const res = runHeadlessGame({
      playerCount: 2,
      handLimitMode: HAND,
      p1Config: p1Cfg,
      p2Config: p2Cfg,
      nnHard: nn,
      training: false,
      fixedPathways: [match.p1, match.p2],
      seed: match.seed,
      maxRounds: MAX_ROUNDS
    });
    done++;
    const p1Id = res.finalSeqs[0]?.pathwayId;
    const p2Id = res.finalSeqs[1]?.pathwayId;
    if (p1Id != null && p2Id != null) {
      matrix[p1Id][p2Id].g++;
      if (res.winnerId === 0) matrix[p1Id][p2Id].w++;
      if (p1Id !== p2Id) {
        matrix[p2Id][p1Id].g++;
        if (res.winnerId === 1) matrix[p2Id][p1Id].w++;
      }
    }
    for (const fs of res.finalSeqs) {
      const ps = pathwayStats[fs.pathwayId];
      ps.games++;
      ps.seqSum += fs.seq;
      if (res.isDraw) ps.draws++;
      else if (fs.id === res.winnerId) {
        ps.wins++;
        if (res.wonBySeq0) ps.seq0Wins++;
      } else ps.losses++;
    }
    if (done % 200 === 0) process.stdout.write(`  RR ${done}/${schedule.length}\r`);
  }
  console.log(`  RR done ${done} games in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const ranked = Object.values(pathwayStats).map(ps => ({
    ...ps,
    winRate: ps.games ? ps.wins / ps.games : 0,
    avgSeq: ps.games ? +(ps.seqSum / ps.games).toFixed(2) : 9
  })).sort((a, b) => b.winRate - a.winRate);

  return { matrix, pathwayStats: ranked, games: done, brainMode, seeds: seedsN };
}

function analyzeBalance(ranked) {
  const over = ranked.filter(p => p.winRate > 0.60);
  const under = ranked.filter(p => p.winRate < 0.40);
  const nominal = ranked.filter(p => p.winRate >= 0.40 && p.winRate <= 0.60);

  const suggestions = [];

  const flavorHints = {
    0: { name: 'Fool/Seer', buff: 'Keep divination/copy identity; if weak, give Seer +1 free peek without spending ability slot once/round, or let Seq9 reorder top 3 instead of 2.', nerf: 'If OP, make Faceless copy cost a Hand discard, or limit Marionette penalty to −1 instead of −2.' },
    1: { name: 'Magician/Apprentice', buff: 'If weak, let Astrologer also draw when keeping top card; or Traveler blink grants +1 draw always.', nerf: 'If OP, make Door Opening (swap trump) once per round only, or require discarding a non-key card when cycling.' },
    2: { name: 'High Priestess', buff: 'Strengthen peek/reorder payoff: after Priestess chaos reorder, draw 1 if top is Minor matching Trump.', nerf: 'Limit divine reorder to top 2 (not 3), or forbid using ability on the same turn as Chaos Event.' },
    3: { name: 'Empress', buff: 'If weak, Page-trap pathways should start with slightly safer pouch math (wild 10 counts ±1).', nerf: 'Empress Chaos: require revealing Page to avoid discard only if Pouch non-empty; empty Pouch always discards (already similar)—reduce trap steal to random Hand only.' },
    4: { name: 'Emperor', buff: 'If weak, inversion should also grant +1 trick bonus to Emperor seat that round.', nerf: 'If OP, inversion lasts only until next trick card is played (not whole trick), or exclude Aces from inversion.' },
    5: { name: 'Hierophant', buff: 'If weak, lacking-trump discard becomes optional Queen-blockable for fairness but Hierophant draws 1 when it triggers.', nerf: 'Only force discard if opponent has ≥2 Hand cards; or only active opponents who did not play Trump this round.' },
    6: { name: 'Lovers', buff: 'If weak, swapped card may be chosen (not random) from opponent Hand when Digested.', nerf: 'If OP, swap only equal-or-lower rank cards, or once per round max.' },
    7: { name: 'Chariot', buff: 'If weak, no-trump lock also grants Chariot +1 trick value that trick.', nerf: 'If OP, no-trump lock only applies when Chariot leads, not when they respond.' },
    8: { name: 'Strength', buff: 'If weak, global immunity also lets Strength tuck 1 extra Pouch that round.', nerf: 'If OP, immunity blocks Swords/Wands but not King raids; or lasts until Strength plays a trick card.' },
    9: { name: 'Hermit', buff: 'If weak, Hermit Chaos takes top Grave without spending the Major from Hand (still recycles).', nerf: 'If OP, retrieved Grave card goes to Pouch face-down (not Hand), delaying tempo.' },
    10: { name: 'Wheel', buff: 'If weak, Wheel actor keeps their passed card OR draws 2 instead of 1.', nerf: 'If OP, actor also discards 1 after the rotate, or draws are face-up (telegraphed).' },
    11: { name: 'Justice', buff: 'If weak, Justice may choose which card the rich give (not random pop).', nerf: 'If OP, only triggers when hand-size gap ≥2; or given card must be lowest rank.' },
    12: { name: 'Hanged Man', buff: 'If weak, sacrifice 1 (not 2) to tuck Deck tops into Pouch.', nerf: 'If OP, tucked cards must be Minors only; Majors drawn go to Hand instead.' },
    13: { name: 'Death', buff: 'If weak, Death Chaos also lets Death seat draw 1 after mass pouch hit.', nerf: 'If OP, only hits pouches with ≥2 cards, or immune players still lose 0 but Death pays 1 Hand.' },
    14: { name: 'Temperance', buff: 'If weak, silencing suits also grants Temperance +1 trick that round.', nerf: 'If OP, cancel Suit Actions only for opponents (Temperance still gets theirs), or only Swords/Wands.' },
    15: { name: 'Devil', buff: 'If weak, Devil may choose Hand vs Pouch sacrifice per opponent.', nerf: 'If OP, only affects opponents with Hand > Devil Hand size; Queen always blocks for free.' },
    16: { name: 'Tower', buff: 'If weak, new Trump from Grave may be chosen among top 3 Grave.', nerf: 'If OP, old Trump is banished (removed from game) instead of going to Grave—harsher but rarer payoff; or Tower cannot be played before Draft ends.' },
    17: { name: 'Star', buff: 'If weak, always draw 2 when revealing an opponent Pouch.', nerf: 'If OP, reveal only 1 random Pouch card (not all), or draw only if Digested.' },
    18: { name: 'Moon', buff: 'If weak, Moon seat may keep their own Pouch intact while scrambling others.', nerf: 'If OP, scramble only 1 card per seat (not full pouches), preserving less chaos.' },
    19: { name: 'Sun', buff: 'If weak, Sun also sets sunFloor (cannot be discarded below 3) for the round.', nerf: 'If OP, tuck is optional/forced only if Digested; or no draw, only tuck.' },
    20: { name: 'Judgement', buff: 'If weak, returned Pouch cards go to Judgement Hand instead of owner Hand.', nerf: 'If OP, only returns Page/face cards, or once per match.' },
    21: { name: 'World', buff: 'If weak, +3 lasts two tricks or also grants +1 draw.', nerf: 'If OP, +3 becomes +2, or only applies when World leads.' }
  };

  for (const p of over) {
    const h = flavorHints[p.id] || { nerf: 'Tone down once-per-turn free value; keep unique verb.' };
    suggestions.push({
      id: p.id,
      arcana: p.arcana,
      lotm: p.lotm,
      winRate: +(p.winRate * 100).toFixed(1),
      band: 'overpowered',
      suggestion: h.nerf
    });
  }
  for (const p of under) {
    const h = flavorHints[p.id] || { buff: 'Add a small Digested-only bonus that reinforces the pathway verb.' };
    suggestions.push({
      id: p.id,
      arcana: p.arcana,
      lotm: p.lotm,
      winRate: +(p.winRate * 100).toFixed(1),
      band: 'underpowered',
      suggestion: h.buff
    });
  }

  return { over, under, nominal, suggestions };
}

// -------------------- main --------------------
const nn = loadOrFresh();

if (!SKIP_TRAIN) {
  runCem(nn, CEM_GENS);
  if ((nn.championWinRate || 0) < TARGET) runA2C(nn, A2C_EPS);
}

const finalSeed = Math.floor(100000 + Math.random() * 8999999);
console.log(`\n=== Final paired eval (${EVAL_GAMES}g) vs depth-6 ===`);
const finalEval = evalVsDepth6(nn, EVAL_GAMES, finalSeed);
console.log(`Result: ${Math.round(finalEval.rate * 100)}% W / ${Math.round(finalEval.draws / finalEval.games * 100)}% D / ${Math.round(finalEval.losses / finalEval.games * 100)}% L · avg win rounds ${finalEval.avgRds}`);
nn.championWinRate = finalEval.rate;
nn.bestValRate = Math.max(nn.bestValRate || 0, finalEval.rate);
saveNN(nn, finalEval.rate);

const nnReady = finalEval.rate >= TARGET;
if (!nnReady) {
  console.log(`\nNN at ${Math.round(finalEval.rate * 100)}% (<${TARGET * 100}%). Running RR with heuristic depth-6 mirror for clean arcana balance signal.`);
}

const rr = runRoundRobin(nnReady ? 'nn' : 'heuristic', RR_SEEDS, nn);
fs.writeFileSync(RR_PATH, JSON.stringify(rr, null, 2));

const analysis = analyzeBalance(rr.pathwayStats);
const report = {
  nnEval: {
    winRate: finalEval.rate,
    winPct: Math.round(finalEval.rate * 100),
    games: finalEval.games,
    draws: finalEval.draws,
    losses: finalEval.losses,
    avgWinRounds: finalEval.avgRds,
    targetMet: nnReady
  },
  rr: {
    brainMode: rr.brainMode,
    seeds: rr.seeds,
    games: rr.games,
    ranked: rr.pathwayStats.map(p => ({
      id: p.id, arcana: p.arcana, lotm: p.lotm,
      winPct: +(p.winRate * 100).toFixed(1),
      wins: p.wins, losses: p.losses, draws: p.draws,
      avgSeq: p.avgSeq, seq0Wins: p.seq0Wins
    }))
  },
  bands: {
    overpowered: analysis.over.map(p => `${p.arcana} (${+(p.winRate * 100).toFixed(1)}%)`),
    underpowered: analysis.under.map(p => `${p.arcana} (${+(p.winRate * 100).toFixed(1)}%)`),
    nominalCount: analysis.nominal.length
  },
  suggestions: analysis.suggestions
};
fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

console.log('\n=== Pathway Win Rates ===');
for (const p of rr.pathwayStats) {
  const pct = (p.winRate * 100).toFixed(1).padStart(5);
  const tag = p.winRate > 0.60 ? 'OP ' : p.winRate < 0.40 ? 'UP ' : 'OK ';
  console.log(`${tag} ${String(p.id).padStart(2)}. ${p.arcana.padEnd(16)} ${pct}%  (${p.wins}-${p.losses}-${p.draws}) avgSeq=${p.avgSeq}`);
}
console.log(`\nWrote ${WEIGHTS_PATH}, ${RR_PATH}, ${REPORT_PATH}`);
console.log(nnReady ? 'NN met 75% target.' : `NN did not meet 75% (final ${Math.round(finalEval.rate * 100)}%). Balance RR used depth-6 mirror.`);
