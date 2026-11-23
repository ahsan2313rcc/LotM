import fs from 'fs';

// Rewrite PlayingScreen header with correct props + imports
const playingPath = 'src/components/PlayingScreen.jsx';
let playing = fs.readFileSync(playingPath, 'utf8');

// Replace import + props block through `} = props;`
const headerEnd = playing.indexOf('} = props;');
if (headerEnd < 0) throw new Error('props end not found');
const afterProps = playing.slice(headerEnd + '} = props;'.length);

const newHeader = `import {
  Sparkles, BookOpen, Volume2, VolumeX, Zap, X, History, ScrollText, Crown, Layers, CheckCircle2, AlertTriangle
} from 'lucide-react';
import { PATHWAYS, SUITS, SUIT_META, ROMAN, TARGETED_ABILITY_TAGS, getCardSuit } from '../data/constants.js';
import { cardCode, cardShortName } from '../utils/cards.js';
import { instantCastCode, abilityCastCode, pCode, fogNetlistAction, boardState } from '../utils/netlist.js';
import { checkAscensionMath, findValidAscensionSubset, getHandLimit } from '../utils/rules.js';
import { sfx } from '../audio/sfx.js';
import { SuitIcon } from './SuitIcon.jsx';
import { TarotCard } from './TarotCard.jsx';

export function PlayingScreen({
  game,
  setGame,
  human,
  humanPathway,
  humanSeqData,
  muted,
  toggleMute,
  setScreen,
  setShowCodex,
  setCodexTab,
  setCodexPathwayId,
  showAscendModal,
  setShowAscendModal,
  ascendSelectedUids,
  setAscendSelectedUids,
  selectedHandUid,
  setSelectedHandUid,
  boardInspect,
  setBoardInspect,
  interruptSecLeft,
  isHumanDraftTurn,
  isHumanTrickTurn,
  isHumanRewardTurn,
  openAbilityLab,
  confirmHumanAscension,
  executeHumanCardAction,
  drawCardsFromDeck,
  resolveTrickReward,
  playTrickCard,
  resolveChaosEvent,
  executeSequenceAbility,
  addLog,
  applyInstantFaceSuitAction,
  markActed,
  exportLogsToNetlist,
  openReplayWithNetlist,
  saveGameToHistory,
  getCardDescription,
  renderRulebookModal,
  // draft / pouch / ability helpers used by table
  onDraftCard,
  onPouchDiscard,
  onAdvanceFromPouch,
  onAbilityActivate,
  onSkipAbilityTarget,
  onConfirmAscendSelection
}) {
`;

fs.writeFileSync(playingPath, newHeader + afterProps);
console.log('rewrote PlayingScreen header');

// Patch App.jsx to use PlayingScreen
const appPath = 'src/App.jsx';
let app = fs.readFileSync(appPath, 'utf8');

if (!app.includes("from './components/PlayingScreen.jsx'")) {
  app = app.replace(
    "import { LabScreen } from './components/LabScreen.jsx';",
    `import { LabScreen } from './components/LabScreen.jsx';
import { PlayingScreen } from './components/PlayingScreen.jsx';`
  );
}

// Replace from ACTIVE GAME TABLE through end of App (before final closing brace)
const marker = `  // ============================================================================
  // 10. RENDER: ACTIVE GAME TABLE
  // ============================================================================
  if (!game || !human) return null;
`;

const markerIdx = app.indexOf(marker);
if (markerIdx < 0) throw new Error('active game marker missing');

const appEnd = app.lastIndexOf('\n}');
if (appEnd < markerIdx) throw new Error('app end not found');

const replacement = `  // ============================================================================
  // 10. RENDER: ACTIVE GAME TABLE
  // ============================================================================
  if (!game || !human) return null;

  return (
    <PlayingScreen
      game={game}
      setGame={setGame}
      human={human}
      humanPathway={humanPathway}
      humanSeqData={humanSeqData}
      muted={muted}
      toggleMute={toggleMute}
      setScreen={setScreen}
      setShowCodex={setShowCodex}
      setCodexTab={setCodexTab}
      setCodexPathwayId={setCodexPathwayId}
      showAscendModal={showAscendModal}
      setShowAscendModal={setShowAscendModal}
      ascendSelectedUids={ascendSelectedUids}
      setAscendSelectedUids={setAscendSelectedUids}
      selectedHandUid={selectedHandUid}
      setSelectedHandUid={setSelectedHandUid}
      boardInspect={boardInspect}
      setBoardInspect={setBoardInspect}
      interruptSecLeft={interruptSecLeft}
      isHumanDraftTurn={isHumanDraftTurn}
      isHumanTrickTurn={isHumanTrickTurn}
      isHumanRewardTurn={isHumanRewardTurn}
      openAbilityLab={openAbilityLab}
      confirmHumanAscension={confirmHumanAscension}
      executeHumanCardAction={executeHumanCardAction}
      drawCardsFromDeck={drawCardsFromDeck}
      resolveTrickReward={resolveTrickReward}
      playTrickCard={playTrickCard}
      resolveChaosEvent={resolveChaosEvent}
      executeSequenceAbility={executeSequenceAbility}
      addLog={addLog}
      applyInstantFaceSuitAction={applyInstantFaceSuitAction}
      markActed={markActed}
      exportLogsToNetlist={exportLogsToNetlist}
      openReplayWithNetlist={openReplayWithNetlist}
      saveGameToHistory={saveGameToHistory}
      getCardDescription={getCardDescription}
      renderRulebookModal={renderRulebookModal}
    />
  );
`;

app = app.slice(0, markerIdx) + replacement + '\n';
fs.writeFileSync(appPath, app);
console.log('patched App, lines', app.split(/\n/).length);
