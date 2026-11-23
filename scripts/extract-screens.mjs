import fs from 'fs';

const lines = fs.readFileSync('src/App.jsx', 'utf8').split(/\r?\n/);
const slice = (a, b) => lines.slice(a - 1, b).join('\n');

// Find GLOSSARY_TERMS block
const glossStart = lines.findIndex(l => l.includes('const GLOSSARY_TERMS = ['));
const glossEnd = lines.findIndex((l, i) => i > glossStart && l.trim() === '];');
if (glossStart < 0 || glossEnd < 0) throw new Error('GLOSSARY_TERMS not found');

const glossaryBody = lines.slice(glossStart, glossEnd + 1).join('\n').replace(/^  /, '').replace(/\n  /g, '\n');
fs.writeFileSync(
  'src/data/glossary.js',
  `${glossaryBody}\n\nexport { GLOSSARY_TERMS };\n`
);
console.log('wrote glossary', glossEnd - glossStart + 1);

// Find rulebook modal function
const rbStart = lines.findIndex(l => l.includes('const renderRulebookModal = () => {'));
const rbEnd = lines.findIndex((l, i) => i > rbStart && l.trim() === '};' && lines[i + 1]?.includes('// =====') || (i > rbStart && l === '  };' && lines[i+2]?.includes('RENDER: SETUP')));
// More reliable: find next section marker after rbStart
let rbClose = -1;
for (let i = rbStart + 1; i < lines.length; i++) {
  if (lines[i] === '  };' && (lines[i + 2]?.includes('RENDER: SETUP') || lines[i + 3]?.includes('RENDER: SETUP'))) {
    rbClose = i;
    break;
  }
}
if (rbStart < 0 || rbClose < 0) throw new Error('rulebook bounds fail ' + rbStart + ' ' + rbClose);

// Convert renderRulebookModal body into a component
let rbInner = lines.slice(rbStart + 1, rbClose).join('\n');
// Dedent 2 spaces
rbInner = rbInner.replace(/^  /gm, '');
// Replace early return null and state setters to props
rbInner = rbInner
  .replace(/^if \(!showCodex\) return null;\n/, '')
  .replace(/setCodexTab/g, 'onTabChange')
  .replace(/setShowCodex\(false\)/g, 'onClose()')
  .replace(/setCodexSearch/g, 'onSearchChange')
  .replace(/setCodexPathwayId/g, 'onPathwayChange')
  .replace(/codexTab/g, 'tab')
  .replace(/codexSearch/g, 'search')
  .replace(/codexPathwayId/g, 'pathwayId')
  .replace(/humanPathway/g, 'humanPathway')
  .replace(/\bhuman\?/g, 'human?')
  .replace(/GLOSSARY_TERMS/g, 'GLOSSARY_TERMS');

const rulebookFile = `import { X } from 'lucide-react';
import { PATHWAYS, SUITS, SUIT_META, ROMAN, TARGETED_ABILITY_TAGS } from '../data/constants.js';
import { GLOSSARY_TERMS } from '../data/glossary.js';
import { SuitIcon } from './SuitIcon.jsx';

export function RulebookModal({
  open,
  tab,
  search,
  pathwayId,
  humanPathway = null,
  human = null,
  onClose,
  onTabChange,
  onSearchChange,
  onPathwayChange
}) {
  if (!open) return null;
${rbInner.split('\n').map(l => (l ? '  ' + l : l)).join('\n')}
}
`;
fs.writeFileSync('src/components/RulebookModal.jsx', rulebookFile);
console.log('wrote RulebookModal');

// GameOver screen
const goStart = lines.findIndex(l => l.includes("if (screen === 'gameover' && game)"));
let goEnd = -1;
for (let i = goStart + 1; i < lines.length; i++) {
  if (lines[i] === '  }' && (lines[i + 2]?.includes('RENDER: ACTIVE GAME') || lines[i + 3]?.includes('RENDER: ACTIVE GAME'))) {
    goEnd = i;
    break;
  }
}
if (goStart < 0 || goEnd < 0) throw new Error('gameover bounds ' + goStart + ' ' + goEnd);

let goBody = lines.slice(goStart + 1, goEnd).join('\n').replace(/^  /gm, '');
goBody = goBody.replace(/rollDraftOptions\(\); setScreen\('setup'\);/, 'onPlayAgain();');

const goFile = `import { Trophy, RotateCcw } from 'lucide-react';
import { PATHWAYS } from '../data/constants.js';

export function GameOverScreen({ game, onPlayAgain }) {
  const victor = game.players[game.winnerId];
  const vp = PATHWAYS[victor.pathwayId];
  return (
${goBody.split('\n').slice(3).map(l => '  ' + l).join('\n')}
  );
}
`;
// Simpler rewrite for GameOver
fs.writeFileSync('src/components/GameOverScreen.jsx', `import { Trophy, RotateCcw } from 'lucide-react';
import { PATHWAYS } from '../data/constants.js';

export function GameOverScreen({ game, onPlayAgain }) {
  const victor = game.players[game.winnerId];
  const vp = PATHWAYS[victor.pathwayId];
  return (
    <div className="min-h-screen bg-[#09080f] text-slate-100 flex items-center justify-center p-6">
      <div className="max-w-lg w-full rounded-2xl border-2 border-amber-400/70 bg-gradient-to-b from-[#1e1828] to-[#0f0d17] p-8 text-center shadow-2xl space-y-5">
        <Trophy className="w-16 h-16 text-amber-400 mx-auto" />
        <div className="text-xs uppercase tracking-widest text-amber-300 font-bold">Sequence 0 Apotheosis</div>
        <h1 className="text-3xl font-serif font-bold text-amber-100">
          {victor.isHuman ? 'You Ascended to True Godhood!' : \`\${victor.name} Ascended to Sequence 0!\`}
        </h1>
        <p className="text-sm text-slate-300">
          <span className="text-amber-300 font-semibold">{victor.name}</span> completed the <span className="text-amber-200">{vp.arcana} ({vp.lotm})</span> Pathway in <span className="font-bold">{game.round} rounds</span>.
        </p>

        <div className="bg-slate-950/60 rounded-xl p-3 border border-white/10 text-left space-y-1.5">
          <div className="text-xs font-semibold text-slate-400 uppercase mb-1">Final Standings</div>
          {[...game.players].sort((a, b) => a.seq - b.seq).map(p => (
            <div key={p.id} className="flex items-center justify-between text-xs py-1 border-b border-white/5 last:border-0">
              <span className="font-semibold text-slate-200">{p.name} — {PATHWAYS[p.pathwayId].arcana}</span>
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold">Seq {p.seq}</span>
            </div>
          ))}
        </div>

        <button
          onClick={onPlayAgain}
          className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm transition flex items-center justify-center gap-2"
        >
          <RotateCcw className="w-4 h-4" /> Play Another Ritual
        </button>
      </div>
    </div>
  );
}
`);
console.log('wrote GameOverScreen');

// Patch App.jsx: add imports, replace glossary/rulebook/gameover usage
let app = fs.readFileSync('src/App.jsx', 'utf8');

if (!app.includes("from './components/RulebookModal.jsx'")) {
  app = app.replace(
    "import { TarotCard } from './components/TarotCard.jsx';",
    `import { TarotCard } from './components/TarotCard.jsx';
import { RulebookModal } from './components/RulebookModal.jsx';
import { GameOverScreen } from './components/GameOverScreen.jsx';
import { GLOSSARY_TERMS } from './data/glossary.js';`
  );
}

// Remove GLOSSARY_TERMS definition (keep a marker comment)
app = app.replace(
  /\n  const GLOSSARY_TERMS = \[[\s\S]*?\n  \];\n/,
  '\n  // GLOSSARY_TERMS imported from ./data/glossary.js\n'
);

// Replace renderRulebookModal function with thin wrapper OR replace calls
app = app.replace(
  /\n  const renderRulebookModal = \(\) => \{[\s\S]*?\n  \};\n\n  \/\/ =+\n  \/\/ 8\. RENDER: SETUP SCREEN/,
  `\n  const renderRulebookModal = () => (
    <RulebookModal
      open={showCodex}
      tab={codexTab}
      search={codexSearch}
      pathwayId={codexPathwayId}
      humanPathway={humanPathway}
      human={human}
      onClose={() => setShowCodex(false)}
      onTabChange={setCodexTab}
      onSearchChange={setCodexSearch}
      onPathwayChange={setCodexPathwayId}
    />
  );

  // ============================================================================
  // 8. RENDER: SETUP SCREEN`
);

// Replace gameover block
app = app.replace(
  /\n  if \(screen === 'gameover' && game\) \{[\s\S]*?\n  \}\n\n  \/\/ =+\n  \/\/ 10\. RENDER: ACTIVE GAME TABLE/,
  `\n  if (screen === 'gameover' && game) {
    return (
      <GameOverScreen
        game={game}
        onPlayAgain={() => { rollDraftOptions(); setScreen('setup'); }}
      />
    );
  }

  // ============================================================================
  // 10. RENDER: ACTIVE GAME TABLE`
);

fs.writeFileSync('src/App.jsx', app);
console.log('patched App.jsx, lines now', app.split(/\n/).length);
