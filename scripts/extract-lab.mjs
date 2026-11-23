import fs from 'fs';

const appPath = 'src/App.jsx';
const lines = fs.readFileSync(appPath, 'utf8').split(/\r?\n/);

const start = lines.findIndex(l => l.includes("if (screen === 'lab' && labState)"));
let end = -1;
for (let i = start + 1; i < lines.length; i++) {
  if (lines[i] === '  }' && (lines[i + 2]?.includes('NN TRAINING') || lines[i + 3]?.includes('NN TRAINING'))) {
    end = i;
    break;
  }
}
if (start < 0 || end < 0) throw new Error('lab bounds ' + start + ' ' + end);

let body = lines.slice(start + 1, end).join('\n');
body = body.replace(/^  /gm, '');

const propsList = [
  'labState', 'setLabState',
  'labPathwayId', 'setLabPathwayId',
  'labSeq', 'setLabSeq',
  'labChaosId', 'setLabChaosId',
  'labAudit', 'setLabAudit',
  'labAuditTab', 'setLabAuditTab',
  'labAuditSearch', 'setLabAuditSearch',
  'setScreen', 'setShowCodex', 'setCodexTab', 'setCodexPathwayId',
  'buildLabSandbox',
  'executeSequenceAbility',
  'resolveChaosEvent',
  'beginRoundDraw',
  'startDraftPhase',
  'startTrickPhase',
  'advanceToNextRound',
  'playTrickCard',
  'addLog',
  'applyInstantFaceSuitAction',
  'performAscension'
];

const labOut = `import {
  Zap, ChevronLeft, ChevronRight, X, BookOpen, Shuffle, Eye, Crown, Skull, Layers, RotateCcw, Play
} from 'lucide-react';
import { PATHWAYS, ROMAN, TARGETED_ABILITY_TAGS, SUITS, SUIT_META } from '../data/constants.js';
import { buildMajorCard, cardCode, cardShortName, isNumberCard, isFaceCard } from '../utils/cards.js';
import { instantCastCode, pCode } from '../utils/netlist.js';
import { findValidAscensionSubset, checkAscensionMath, getHandLimit } from '../utils/rules.js';
import { SuitIcon } from './SuitIcon.jsx';
import { TarotCard } from './TarotCard.jsx';

export function LabScreen({
  ${propsList.join(',\n  ')}
}) {
${body.split('\n').map(l => (l ? '  ' + l : l)).join('\n')}
}
`;

fs.writeFileSync('src/components/LabScreen.jsx', labOut);
console.log('wrote LabScreen', labOut.split('\n').length);

let app = fs.readFileSync(appPath, 'utf8');
if (!app.includes("from './components/LabScreen.jsx'")) {
  app = app.replace(
    "import { SimScreen } from './components/SimScreen.jsx';",
    `import { SimScreen } from './components/SimScreen.jsx';
import { LabScreen } from './components/LabScreen.jsx';`
  );
}

const propJsx = propsList.map(p => `        ${p}={${p}}`).join('\n');

app = app.replace(
  /\n  if \(screen === 'lab' && labState\) \{[\s\S]*?\n  \}\n\n  \/\/ =+\n  \/\/ 8C\. NN TRAINING STUDIO/,
  `\n  if (screen === 'lab' && labState) {
    return (
      <LabScreen
${propJsx}
      />
    );
  }

  // ============================================================================
  // 8C. NN TRAINING STUDIO`
);

fs.writeFileSync(appPath, app);
console.log('patched App, lines', app.split(/\n/).length);
