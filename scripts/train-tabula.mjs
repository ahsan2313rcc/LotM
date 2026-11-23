/**
 * Online tabula-rasa learner vs heuristic depth (updates every game).
 * node scripts/train-tabula.mjs [--games 2000] [--depth 6]
 */
import fs from 'fs';
import { TabulaNet } from '../src/ai/TabulaNet.js';
import { runHeadlessGame } from '../src/ai/headless.js';

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : def;
};

const GAMES = getArg('--games', 500);
const DEPTH = getArg('--depth', 6);
const PATH = 'data/nn_tabula_champion.json';

fs.mkdirSync('data', { recursive: true });
let nn = fs.existsSync(PATH)
  ? new TabulaNet(JSON.parse(fs.readFileSync(PATH, 'utf8')))
  : new TabulaNet();

console.log(`TabulaNet start games=${nn.gamesTrained} rolling=${Math.round((nn.championWinRate || 0) * 100)}% vs d${DEPTH}`);

let wins = 0, losses = 0, draws = 0;
for (let i = 0; i < GAMES; i++) {
  const res = runHeadlessGame({
    playerCount: 2,
    handLimitMode: '10-7',
    aiMode: 'nn_vs_heuristic',
    heuristicDepth: DEPTH,
    nn,
    training: true,
    learnFromHeuristic: false,
    maxRounds: 75,
    seed: Math.floor(Math.random() * 1e9)
  });
  if (res.isDraw) draws++;
  else if (res.winnerBrain === 'nn') wins++;
  else losses++;
  if ((i + 1) % 50 === 0 || i + 1 === GAMES) {
    console.log(`  ${i + 1}/${GAMES}: rolling ${Math.round((nn.championWinRate || 0) * 100)}%  (batch W${wins}/L${losses}/D${draws})`);
    fs.writeFileSync(PATH, JSON.stringify(nn.serialize()));
    wins = losses = draws = 0;
  }
}
fs.writeFileSync(PATH, JSON.stringify(nn.serialize()));
console.log(`Done. Saved ${PATH} games=${nn.gamesTrained} rolling=${Math.round((nn.championWinRate || 0) * 100)}%`);
