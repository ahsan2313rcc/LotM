import { PATHWAYS } from '../src/data/constants.js';
import { parseNetlistToFrames, SAMPLE_REPLAY_NETLIST, parseCardCode } from '../src/utils/netlist.js';
import { runHeadlessGame, applyHeadlessAbility } from '../src/ai/headless.js';
import { cardCode } from '../src/utils/cards.js';

let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
  } else {
    console.log('OK:', msg);
  }
};

// 1) All pathway tags have cases in headless (smoke: call every tag once)
const tags = new Set();
for (const p of PATHWAYS) for (const sq of [9, 8, 7, 6, 5, 4, 3, 2, 1]) tags.add(p.seqs[sq].tag);

const mkPlayer = (id, pathwayId, seq) => ({
  id, name: `P${id}`, pathwayId, seq, isHuman: false,
  hand: [], pouch: [], mods: {}, faceCounts: { K: 0, Q: 0, N: 0, P: 0 },
  skippedThisRound: false, actingDone: false, abilityUsed: false
});

for (const tag of tags) {
  try {
    const actor = mkPlayer(0, 0, 9);
    const target = mkPlayer(1, 1, 9);
    actor.hand = [parseCardCode('S7'), parseCardCode('W5'), parseCardCode('C3')].filter(Boolean);
    actor.pouch = [parseCardCode('P2')].filter(Boolean);
    target.hand = [parseCardCode('S4'), parseCardCode('W9')].filter(Boolean);
    target.pouch = [parseCardCode('C8')].filter(Boolean);
    const deck = ['S6', 'W8', 'P9', 'C2', 'S3', 'W4', 'P5', 'C6'].map(parseCardCode).filter(Boolean);
    const grave = [parseCardCode('S2'), parseCardCode('X3')].filter(Boolean);
    const trump = { card: parseCardCode('C5') };
    const roundMods = {};
    const drawN = (n) => {
      const out = [];
      for (let i = 0; i < n && deck.length; i++) out.push(deck.shift());
      return out;
    };
    applyHeadlessAbility(actor, [actor, target], target, deck, grave, trump, roundMods, drawN, tag, 0);
  } catch (e) {
    ok(false, `tag ${tag} threw: ${e.message}`);
  }
}
ok(failed === 0, `all ${tags.size} tags executable in headless`);

// 2) Sample netlist parses and applies deck reorder + digestion + ascend
const frames = parseNetlistToFrames(SAMPLE_REPLAY_NETLIST);
ok(frames.length >= 20, `sample netlist produced ${frames.length} frames`);
const peekFrame = frames.find(f => f.token.includes('z0q9') && f.token.includes('k^{'));
ok(!!peekFrame, 'found seer ability frame with k^{...}');
if (peekFrame) {
  ok((peekFrame.state.deckTop || []).length === 2, `deckTop reconstructed (${(peekFrame.state.deckTop || []).map(c => cardCode(c)).join(',')})`);
}
const dig = frames.find(f => /q9\$/.test(f.token) || f.desc?.includes('digested Sequence 9'));
ok(!!dig, 'digestion frame present');
const asc = frames.find(f => f.token.startsWith('#1: @q8'));
ok(!!asc && asc.state.players[0].seq === 8, 'ascension to seq 8 reconstructed for seat 1');

// 3) Round-trip effect strings that used to be opaque
const effectNetlist = `G= #1: z0, #2: z1;
R1=
#1: +/S7,
#2: +/C3
D1= W9, P7, S3
#1: D+W9,
#2: D+P7
T1= S3
![#1: X1 (#1/P(S7)↔#2/P(C3), g^>k_{X1})],
#2: z1q9 (k^{S6,S10>S10,S6}),
#1: S5 (#2: -/C3),
T1& #1: ?0 (+S3)
A1=
#1: @q8 (-/C3, +C2),
A1&`;
const fx = parseNetlistToFrames(effectNetlist);
const swapF = fx.find(f => f.token.includes('/P('));
ok(!!swapF, 'pouch-swap effect frame exists');
if (swapF) {
  const p1 = swapF.state.players[0];
  const p2 = swapF.state.players[1];
  ok(p1.pouch.some(c => cardCode(c) === 'C3'), 'seat1 received C3 in pouch after swap');
  ok(p2.pouch.some(c => cardCode(c) === 'S7'), 'seat2 received S7 in pouch after swap');
}
const reorderF = fx.find(f => f.token.includes('k^{'));
ok(!!reorderF && (reorderF.state.deckTop || []).map(c => cardCode(c)).join(',') === 'S10,S6', 'deck reorder applied to deckTop');

// 4) Headless short game completes without throw
try {
  const res = runHeadlessGame({
    playerCount: 2,
    handLimitMode: '10-7',
    seatConfigs: [
      { type: 'heuristic', depth: 1 },
      { type: 'heuristic', depth: 1 }
    ],
    training: false,
    maxRounds: 8,
    seed: 42
  });
  ok(res && (res.rounds > 0 || res.isDraw || res.winnerId != null), `headless game finished rounds=${res.rounds} winner=${res.winnerId}`);
} catch (e) {
  ok(false, `headless game threw: ${e.message}`);
}

if (failed > 0) {
  console.error(`\n${failed} checks failed`);
  process.exit(1);
}
console.log('\nAll verification checks passed.');
