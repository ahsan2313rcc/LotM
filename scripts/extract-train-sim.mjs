import fs from 'fs';

const appPath = 'src/App.jsx';
const lines = fs.readFileSync(appPath, 'utf8').split(/\r?\n/);

const findSection = (startPred, endPred) => {
  const start = lines.findIndex(startPred);
  if (start < 0) throw new Error('start not found');
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (endPred(lines[i], i, lines)) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('end not found after ' + start);
  return [start, end];
};

const [trainStart, trainEnd] = findSection(
  l => l.includes("if (screen === 'train') {"),
  (l, i, arr) => l === '  }' && (arr[i + 2]?.includes('AI EVALUATION SIMULATOR') || arr[i + 3]?.includes('AI EVALUATION SIMULATOR'))
);

let ti = lines.slice(trainStart + 1, trainEnd).join('\n');
ti = ti
  .replace(/^    const nn = getActiveNN\(\);\n    const valWinPct = Math\.round\(\(nn\.championWinRate \|\| 0\) \* 100\);\n    return \(\n/, '')
  .replace(/\n    \);\n?$/, '');
ti = ti.replace(/^    /gm, '');

const trainOut = `import { Shuffle, Zap, Play, X } from 'lucide-react';

export function TrainScreen({
  getActiveNN,
  loadWeightsInputRef,
  handleLoadWeights,
  handleSaveWeights,
  resetNNWeights,
  trainRunning,
  setScreen,
  game,
  nnDifficulty,
  setNnDifficulty,
  setTrainLog,
  trainMode,
  setTrainMode,
  trainDepth,
  setTrainDepth,
  trainAlpha,
  setTrainAlpha,
  trainBatchSize,
  setTrainBatchSize,
  trainLearnFromAi,
  setTrainLearnFromAi,
  valSeed,
  randomizeValSeed,
  runCemTraining,
  runTrainingBatch,
  stopTrainRef,
  nnBanner,
  setNnBanner,
  trainProgress,
  roundLimit,
  trainLog,
  handLimitMode
}) {
  const nn = getActiveNN();
  const valWinPct = Math.round((nn.championWinRate || 0) * 100);

  return (
${ti.split('\n').map(l => (l ? '    ' + l : l)).join('\n')}
  );
}
`;

fs.writeFileSync('src/components/TrainScreen.jsx', trainOut);
console.log('wrote TrainScreen', trainOut.split('\n').length);

const [simStart, simEnd] = findSection(
  l => l.includes("if (screen === 'sim') {"),
  (l, i, arr) => l === '  }' && (arr[i + 2]?.includes('RENDER: GAME OVER') || arr[i + 3]?.includes('RENDER: GAME OVER'))
);

let si = lines.slice(simStart + 1, simEnd).join('\n');
// Keep local const computations inside the component — strip only outer return wrap after locals
const returnIdx = si.indexOf('\n    return (\n');
if (returnIdx < 0) throw new Error('sim return not found');
const simLocals = si.slice(0, returnIdx).replace(/^    /gm, '');
let simJsx = si.slice(returnIdx + '\n    return (\n'.length).replace(/\n    \);\n?$/, '');
simJsx = simJsx.replace(/^    /gm, '');

const simOut = `import { Sparkles, Play, X, Shuffle, Trophy, RotateCcw } from 'lucide-react';
import { PATHWAYS, ROMAN, SUITS, SUIT_META } from '../data/constants.js';
import { SuitIcon } from './SuitIcon.jsx';

export function SimScreen(props) {
  const {
    getActiveNN,
    simSubTab,
    setSimSubTab,
    simStats,
    rrStats,
    selectedPathwayFilter,
    setSelectedPathwayFilter,
    makeEmptyPathwayStats,
    makeEmptyMatrix,
    setScreen,
    game,
    simRunning,
    rrRunning,
    simProgress,
    rrProgress,
    simPlayerCount,
    setSimPlayerCount,
    simSeatBrains,
    setSimSeatBrains,
    simP1Brain,
    setSimP1Brain,
    simP2Brain,
    setSimP2Brain,
    roundLimit,
    setRoundLimit,
    handLimitMode,
    setHandLimitMode,
    runSimBatch,
    runRoundRobin,
    resetSimStatsOnly,
    resetRrStats,
    stopSimRef,
    stopRrRef,
    nnDifficulty
  } = props;

${simLocals}

  return (
${simJsx.split('\n').map(l => (l ? '    ' + l : l)).join('\n')}
  );
}
`;

fs.writeFileSync('src/components/SimScreen.jsx', simOut);
console.log('wrote SimScreen', simOut.split('\n').length);

let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes("from './components/TrainScreen.jsx'")) {
  app = app.replace(
    "import { ReplayScreen } from './components/ReplayScreen.jsx';",
    `import { ReplayScreen } from './components/ReplayScreen.jsx';
import { TrainScreen } from './components/TrainScreen.jsx';
import { SimScreen } from './components/SimScreen.jsx';`
  );
}

app = app.replace(
  /\n  if \(screen === 'train'\) \{[\s\S]*?\n  \}\n\n  \/\/ =+\n  \/\/ 8D\. AI EVALUATION SIMULATOR/,
  `\n  if (screen === 'train') {
    return (
      <TrainScreen
        getActiveNN={getActiveNN}
        loadWeightsInputRef={loadWeightsInputRef}
        handleLoadWeights={handleLoadWeights}
        handleSaveWeights={handleSaveWeights}
        resetNNWeights={resetNNWeights}
        trainRunning={trainRunning}
        setScreen={setScreen}
        game={game}
        nnDifficulty={nnDifficulty}
        setNnDifficulty={setNnDifficulty}
        setTrainLog={setTrainLog}
        trainMode={trainMode}
        setTrainMode={setTrainMode}
        trainDepth={trainDepth}
        setTrainDepth={setTrainDepth}
        trainAlpha={trainAlpha}
        setTrainAlpha={setTrainAlpha}
        trainBatchSize={trainBatchSize}
        setTrainBatchSize={setTrainBatchSize}
        trainLearnFromAi={trainLearnFromAi}
        setTrainLearnFromAi={setTrainLearnFromAi}
        valSeed={valSeed}
        randomizeValSeed={randomizeValSeed}
        runCemTraining={runCemTraining}
        runTrainingBatch={runTrainingBatch}
        stopTrainRef={stopTrainRef}
        nnBanner={nnBanner}
        setNnBanner={setNnBanner}
        trainProgress={trainProgress}
        roundLimit={roundLimit}
        trainLog={trainLog}
        handLimitMode={handLimitMode}
      />
    );
  }

  // ============================================================================
  // 8D. AI EVALUATION SIMULATOR`
);

app = app.replace(
  /\n  if \(screen === 'sim'\) \{[\s\S]*?\n  \}\n\n  \/\/ =+\n  \/\/ 9\. RENDER: GAME OVER SCREEN/,
  `\n  if (screen === 'sim') {
    return (
      <SimScreen
        getActiveNN={getActiveNN}
        simSubTab={simSubTab}
        setSimSubTab={setSimSubTab}
        simStats={simStats}
        rrStats={rrStats}
        selectedPathwayFilter={selectedPathwayFilter}
        setSelectedPathwayFilter={setSelectedPathwayFilter}
        makeEmptyPathwayStats={makeEmptyPathwayStats}
        makeEmptyMatrix={makeEmptyMatrix}
        setScreen={setScreen}
        game={game}
        simRunning={simRunning}
        rrRunning={rrRunning}
        simProgress={simProgress}
        rrProgress={rrProgress}
        simPlayerCount={simPlayerCount}
        setSimPlayerCount={setSimPlayerCount}
        simSeatBrains={simSeatBrains}
        setSimSeatBrains={setSimSeatBrains}
        simP1Brain={simP1Brain}
        setSimP1Brain={setSimP1Brain}
        simP2Brain={simP2Brain}
        setSimP2Brain={setSimP2Brain}
        roundLimit={roundLimit}
        setRoundLimit={setRoundLimit}
        handLimitMode={handLimitMode}
        setHandLimitMode={setHandLimitMode}
        runSimBatch={runSimBatch}
        runRoundRobin={runRoundRobin}
        resetSimStatsOnly={resetSimStatsOnly}
        resetRrStats={resetRrStats}
        stopSimRef={stopSimRef}
        stopRrRef={stopRrRef}
        nnDifficulty={nnDifficulty}
      />
    );
  }

  // ============================================================================
  // 9. RENDER: GAME OVER SCREEN`
);

fs.writeFileSync(appPath, app);
console.log('patched App, lines', app.split(/\n/).length);
