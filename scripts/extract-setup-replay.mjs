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

const [setupStart, setupEnd] = findSection(
  l => l.includes("if (screen === 'setup') {"),
  (l, i, arr) => l === '  }' && (arr[i + 2]?.includes('PAST GAME HISTORY') || arr[i + 3]?.includes('PAST GAME HISTORY'))
);

let si = lines.slice(setupStart + 1, setupEnd).join('\n');
si = si
  .replace(/^    const displayedPathways[\s\S]*?return \(\n/, '')
  .replace(/\n    \);\n?$/, '');
si = si.replace(/^    /gm, '');

si = si
  .replace(/setPlayerCount/g, 'onPlayerCount')
  .replace(/setPickAnyMode\(!pickAnyMode\)/g, 'onTogglePickAny()')
  .replace(/setRoundLimit/g, 'onRoundLimit')
  .replace(/setHandLimitMode/g, 'onHandLimitMode')
  .replace(/setAiBrainMode/g, 'onAiBrainMode')
  .replace(/\bopenAbilityLab\b/g, 'onOpenLab')
  .replace(/setScreen\('replay'\)/g, 'onOpenReplay()')
  .replace(/setScreen\('train'\)/g, 'onOpenTrain()')
  .replace(/setScreen\('sim'\)/g, 'onOpenSim()')
  .replace(/setShowCodex\(true\)/g, 'onOpenCodex()')
  .replace(/\brollDraftOptions\b/g, 'onRerollDraft')
  .replace(/setInspectPathwayId\(p\.id\)/g, 'onInspectPathway(p.id)')
  .replace(/setInspectPathwayId\(null\)/g, 'onCloseInspect()')
  .replace(/\bstartGame\(/g, 'onStartGame(')
  .replace(/gameHistory\.length/g, 'gameHistoryLength')
  .replace(/\{renderRulebookModal\(\)\}/g, `{<RulebookModal
          open={showCodex}
          tab={codexTab}
          search={codexSearch}
          pathwayId={codexPathwayId}
          onClose={onCloseCodex}
          onTabChange={onCodexTab}
          onSearchChange={onCodexSearch}
          onPathwayChange={onCodexPathway}
        />}`)
  .replace(
    /onCloseInspect\(\);\s*setLabPathwayId\(ip\.id\);\s*setLabSeq\(9\);\s*setLabState\(buildLabSandbox\(ip\.id, 9\)\);\s*setScreen\('lab'\);/g,
    'onCloseInspect();\n                      onOpenLabForPathway(ip.id);'
  )
  .replace(/onCloseInspect\(\); onStartGame/g, 'onCloseInspect(); onStartGame');

const setupOut = `import {
  Sparkles, Users, BookOpen, Zap, History, Shuffle, Eye, ChevronRight, X
} from 'lucide-react';
import { PATHWAYS, ROMAN, TARGETED_ABILITY_TAGS } from '../data/constants.js';
import { RulebookModal } from './RulebookModal.jsx';

export function SetupScreen({
  pickAnyMode,
  draftOptions,
  playerCount,
  roundLimit,
  handLimitMode,
  aiBrainMode,
  gameHistoryLength,
  inspectPathwayId,
  showCodex,
  codexTab,
  codexSearch,
  codexPathwayId,
  onPlayerCount,
  onTogglePickAny,
  onRoundLimit,
  onHandLimitMode,
  onAiBrainMode,
  onOpenLab,
  onOpenReplay,
  onOpenTrain,
  onOpenSim,
  onOpenCodex,
  onCloseCodex,
  onCodexTab,
  onCodexSearch,
  onCodexPathway,
  onRerollDraft,
  onInspectPathway,
  onCloseInspect,
  onStartGame,
  onOpenLabForPathway
}) {
  const displayedPathways = pickAnyMode ? PATHWAYS : draftOptions.map(id => PATHWAYS[id]);

  return (
${si.split('\n').map(l => (l ? '    ' + l : l)).join('\n')}
  );
}
`;

fs.writeFileSync('src/components/SetupScreen.jsx', setupOut);
console.log('wrote SetupScreen', setupOut.split('\n').length);

const [replayStart, replayEnd] = findSection(
  l => l.includes("if (screen === 'replay') {"),
  (l, i, arr) => l === '  }' && (arr[i + 2]?.includes('PLAYABLE BOARD DEMO LAB') || arr[i + 3]?.includes('PLAYABLE BOARD DEMO LAB'))
);

let ri = lines.slice(replayStart + 1, replayEnd).join('\n');
ri = ri
  .replace(/^    const curFrame[\s\S]*?return \(\n/, '')
  .replace(/\n    \);\n?$/, '');
ri = ri.replace(/^    /gm, '');

// Discover identifiers used that may need imports — keep App setters as props with same names
const replayOut = `import {
  History, ChevronLeft, Trash2, Play, Pause, SkipBack, SkipForward, ScrollText, X
} from 'lucide-react';
import { PATHWAYS, ROMAN, SUITS, SUIT_META } from '../data/constants.js';
import { TarotCard } from './TarotCard.jsx';
import { SuitIcon } from './SuitIcon.jsx';
import { fogNetlistText, SAMPLE_REPLAY_NETLIST } from '../utils/netlist.js';

export function ReplayScreen({
  replayFrames,
  replayStep,
  gameHistory,
  selectedHistoryIdx,
  replayNetlistText,
  replayPlaying,
  setScreen,
  setSelectedHistoryIdx,
  setReplayNetlistText,
  setReplayFrames,
  setReplayStep,
  setReplayPlaying,
  loadHistoryEntry,
  parseAndLoadNetlist,
  deleteHistoryEntry,
  clearGameHistory
}) {
  const curFrame = replayFrames[replayStep] || replayFrames[0] || null;
  const rState = curFrame?.state || null;

  return (
${ri.split('\n').map(l => (l ? '    ' + l : l)).join('\n')}
  );
}
`;

fs.writeFileSync('src/components/ReplayScreen.jsx', replayOut);
console.log('wrote ReplayScreen', replayOut.split('\n').length);

let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes("from './components/SetupScreen.jsx'")) {
  app = app.replace(
    "import { GameOverScreen } from './components/GameOverScreen.jsx';",
    `import { GameOverScreen } from './components/GameOverScreen.jsx';
import { SetupScreen } from './components/SetupScreen.jsx';
import { ReplayScreen } from './components/ReplayScreen.jsx';`
  );
}

app = app.replace(
  /\n  if \(screen === 'setup'\) \{[\s\S]*?\n  \}\n\n  \/\/ =+\n  \/\/ 8A2\. RENDER: PAST GAME HISTORY/,
  `\n  if (screen === 'setup') {
    return (
      <SetupScreen
        pickAnyMode={pickAnyMode}
        draftOptions={draftOptions}
        playerCount={playerCount}
        roundLimit={roundLimit}
        handLimitMode={handLimitMode}
        aiBrainMode={aiBrainMode}
        gameHistoryLength={gameHistory.length}
        inspectPathwayId={inspectPathwayId}
        showCodex={showCodex}
        codexTab={codexTab}
        codexSearch={codexSearch}
        codexPathwayId={codexPathwayId}
        onPlayerCount={setPlayerCount}
        onTogglePickAny={() => setPickAnyMode(!pickAnyMode)}
        onRoundLimit={setRoundLimit}
        onHandLimitMode={setHandLimitMode}
        onAiBrainMode={setAiBrainMode}
        onOpenLab={openAbilityLab}
        onOpenReplay={() => setScreen('replay')}
        onOpenTrain={() => setScreen('train')}
        onOpenSim={() => setScreen('sim')}
        onOpenCodex={() => setShowCodex(true)}
        onCloseCodex={() => setShowCodex(false)}
        onCodexTab={setCodexTab}
        onCodexSearch={setCodexSearch}
        onCodexPathway={setCodexPathwayId}
        onRerollDraft={rollDraftOptions}
        onInspectPathway={setInspectPathwayId}
        onCloseInspect={() => setInspectPathwayId(null)}
        onStartGame={startGame}
        onOpenLabForPathway={(id) => {
          setLabPathwayId(id);
          setLabSeq(9);
          setLabState(buildLabSandbox(id, 9));
          setScreen('lab');
        }}
      />
    );
  }

  // ============================================================================
  // 8A2. RENDER: PAST GAME HISTORY`
);

app = app.replace(
  /\n  if \(screen === 'replay'\) \{[\s\S]*?\n  \}\n\n  \/\/ =+\n  \/\/ 8B\. RENDER: PLAYABLE BOARD DEMO LAB/,
  `\n  if (screen === 'replay') {
    return (
      <ReplayScreen
        replayFrames={replayFrames}
        replayStep={replayStep}
        gameHistory={gameHistory}
        selectedHistoryIdx={selectedHistoryIdx}
        replayNetlistText={replayNetlistText}
        replayPlaying={replayPlaying}
        setScreen={setScreen}
        setSelectedHistoryIdx={setSelectedHistoryIdx}
        setReplayNetlistText={setReplayNetlistText}
        setReplayFrames={setReplayFrames}
        setReplayStep={setReplayStep}
        setReplayPlaying={setReplayPlaying}
        loadHistoryEntry={loadHistoryEntry}
        parseAndLoadNetlist={parseAndLoadNetlist}
        deleteHistoryEntry={deleteHistoryEntry}
        clearGameHistory={clearGameHistory}
      />
    );
  }

  // ============================================================================
  // 8B. RENDER: PLAYABLE BOARD DEMO LAB`
);

fs.writeFileSync(appPath, app);
console.log('patched App, lines', app.split(/\n/).length);
