import fs from 'fs';

const appPath = 'src/App.jsx';
const lines = fs.readFileSync(appPath, 'utf8').split(/\r?\n/);

const start = lines.findIndex(l => l.includes('// 10. RENDER: ACTIVE GAME TABLE'));
// Find the actual `if (!game || !human) return null;` then the main return
const ifIdx = lines.findIndex((l, i) => i >= start && l.includes("if (!game || !human) return null;"));
if (ifIdx < 0) throw new Error('playing start not found');

// Find end of App: last `}` of export default function — file ends with `}` then maybe blank
let end = lines.length - 1;
while (end > 0 && lines[end].trim() === '') end--;
// end should be closing of App function
if (lines[end].trim() !== '}') throw new Error('unexpected file end: ' + lines[end]);

// Body is from ifIdx+1 to end-1 (exclusive of App's closing brace)
const bodyLines = lines.slice(ifIdx + 1, end);
let body = bodyLines.join('\n');
// Dedent 2 spaces
body = body.replace(/^  /gm, '');

// Collect likely props: we'll pass a wide bag from App
const props = [
  'game', 'setGame', 'human', 'humanPathway', 'opponents',
  'sfxOn', 'setSfxOn', 'setScreen', 'setShowCodex', 'setCodexTab', 'setCodexPathwayId',
  'showAscendModal', 'setShowAscendModal', 'ascendSelectedUids', 'setAscendSelectedUids',
  'interruptSecLeft', 'aiBrainMode',
  'confirmAscension', 'openReplayWithNetlist', 'exportLogsToNetlist', 'saveGameToHistory',
  'playTrickCard', 'resolveChaosEvent', 'executeSequenceAbility', 'performAscension',
  'addLog', 'applyInstantFaceSuitAction', 'markActed', 'beginRoundDraw', 'startDraftPhase',
  'startTrickPhase', 'advanceToNextRound', 'resolveTrickReward', 'handleHumanDraftPick',
  'handleHumanTrickPlay', 'handleInstantMajor', 'handleAbilityClick', 'handleInterruptChoice',
  'handleDiscardChoice', 'handlePouchTuck', 'handlePouchDiscard', 'handlePassPouchPhase',
  'canFollowSuit', 'findValidAscensionSubset', 'renderRulebookModal'
];

const playingOut = `import {
  Sparkles, Shield, Swords, Flame, Coins, Wine, Eye, Skull, Crown,
  BookOpen, Volume2, VolumeX, RotateCcw, Layers, Zap, CheckCircle2,
  AlertTriangle, ChevronRight, X, Lock, Trophy, Users, Play, ScrollText,
  HelpCircle, Shuffle, Check, History, Pause, SkipBack, SkipForward, ChevronLeft, Trash2
} from 'lucide-react';
import { PATHWAYS, SUITS, SUIT_META, ROMAN, TARGETED_ABILITY_TAGS, getCardSuit, RANK_LABELS } from '../data/constants.js';
import { cardCode, cardShortName, isNumberCard, isFaceCard, buildMajorCard } from '../utils/cards.js';
import { instantCastCode, abilityCastCode, pCode, fogNetlistAction, fogNetlistText } from '../utils/netlist.js';
import { checkAscensionMath, getHandLimit, evaluateTrickWinner } from '../utils/rules.js';
import { SuitIcon } from './SuitIcon.jsx';
import { TarotCard } from './TarotCard.jsx';

export function PlayingScreen(props) {
  const {
    ${props.join(',\n    ')}
  } = props;

${body.split('\n').map(l => (l ? '  ' + l : l)).join('\n')}
}
`;

fs.writeFileSync('src/components/PlayingScreen.jsx', playingOut);
console.log('wrote PlayingScreen', playingOut.split('\n').length);

// Don't auto-patch App yet — first inspect missing handlers; write a stub patch helper
fs.writeFileSync('scripts/_playing-props.json', JSON.stringify(props, null, 2));
console.log('props listed; App not patched yet — run patch after fixing PlayingScreen');
