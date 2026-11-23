import fs from 'fs';
import path from 'path';

const lines = fs.readFileSync('src/App.jsx', 'utf8').split(/\r?\n/);
const slice = (a, b) => lines.slice(a - 1, b).join('\n');
const ensure = (p) => fs.mkdirSync(path.dirname(p), { recursive: true });
const write = (p, content) => {
  ensure(p);
  fs.writeFileSync(p, content.replace(/\n+$/, '') + '\n');
  console.log('wrote', p, '(' + content.split('\n').length + ' lines)');
};

// 1) Audio
write(
  'src/audio/sfx.js',
  `${slice(12, 64)}\n\nexport { SoundEngine, sfx };\n`
);

// 2) Constants (SUITS .. PATHWAYS)
write(
  'src/data/constants.js',
  `${slice(69, 451)}\n\nexport {\n  SUITS,\n  SUIT_META,\n  getCardSuit,\n  RANK_LABELS,\n  ROMAN,\n  TARGETED_ABILITY_TAGS,\n  PATHWAYS\n};\n`
);

// 3) Card helpers
write(
  'src/utils/cards.js',
  `import { PATHWAYS, ROMAN, SUITS, RANK_LABELS, SUIT_META } from '../data/constants.js';\n\n${slice(456, 518)}\n\n${slice(1103, 1115)}\n\nexport {\n  mulberry32,\n  shuffle,\n  buildMinorDeck,\n  buildMajorCard,\n  cardCode,\n  suitCode,\n  cardShortName,\n  isNumberCard,\n  isFaceCard\n};\n`
);

// 4) Netlist helpers (pCode .. SAMPLE)
write(
  'src/utils/netlist.js',
  `import { PATHWAYS } from '../data/constants.js';\nimport { cardCode, cardShortName } from './cards.js';\n\n${slice(520, 1101)}\n\nexport {\n  pCode,\n  pzCode,\n  instantCastCode,\n  abilityCastCode,\n  digestionCode,\n  boardState,\n  mergeActionCode,\n  fogPrivateOps,\n  fogNetlistAction,\n  fogNetlistText,\n  formatSpentPouchCodes,\n  parseCardCode,\n  splitTopLevelActions,\n  parseNetlistToFrames,\n  SAMPLE_REPLAY_NETLIST\n};\n`
);

// 5) Rules helpers
write(
  'src/utils/rules.js',
  `import { getCardSuit } from '../data/constants.js';\nimport { isNumberCard } from './cards.js';\n\n${slice(1118, 1246)}\n\nexport {\n  checkAscensionMath,\n  findValidAscensionSubset,\n  evaluateTrickWinner,\n  getHandLimit\n};\n`
);

// 6) Features
write(
  'src/ai/features.js',
  `import { SUITS, getCardSuit, PATHWAYS } from '../data/constants.js';\nimport { getHandLimit } from '../utils/rules.js';\nimport { isFaceCard } from '../utils/cards.js';\n\n${slice(1420, 1569)}\n\nexport {\n  extractBoardFeatures,\n  getCardUniqueId,\n  NN_HIGH_VAL_ABILITY_TAGS,\n  extractCardIdFeatures\n};\n`
);

// 7) Easy NN
write(
  'src/ai/LotmNeuralNet.js',
  `import { extractBoardFeatures } from './features.js';\n\n${slice(1251, 1418)}\n\nexport { LotmNeuralNet };\n`
);

// 8) Hard NN
write(
  'src/ai/CardIdNeuralNet.js',
  `import { extractCardIdFeatures } from './features.js';\n\n${slice(1571, 1916)}\n\nexport { CardIdNeuralNet };\n`
);

// 9) Headless AI engine
write(
  'src/ai/headless.js',
  `import { PATHWAYS, SUITS, getCardSuit, TARGETED_ABILITY_TAGS } from '../data/constants.js';\nimport { shuffle, mulberry32, buildMinorDeck, buildMajorCard, cardCode, cardShortName, isNumberCard, isFaceCard } from '../utils/cards.js';\nimport { checkAscensionMath, findValidAscensionSubset, evaluateTrickWinner, getHandLimit } from '../utils/rules.js';\nimport { LotmNeuralNet } from './LotmNeuralNet.js';\nimport { CardIdNeuralNet } from './CardIdNeuralNet.js';\nimport { extractBoardFeatures, extractCardIdFeatures, getCardUniqueId, NN_HIGH_VAL_ABILITY_TAGS } from './features.js';\n\n${slice(1918, 3493)}\n\nexport {\n  pickDiscardCardIdx,\n  discardSmart,\n  applyHeadlessAbility,\n  runHeadlessGame\n};\n`
);

// 10) UI components
write(
  'src/components/SuitIcon.jsx',
  `import { Swords, Flame, Coins, Wine, Sparkles } from 'lucide-react';\n\nexport function SuitIcon({ suit, className = 'w-4 h-4' }) {\n${slice(3499, 3504)}\n}\n`
);

write(
  'src/components/TarotCard.jsx',
  `import { Sparkles } from 'lucide-react';\nimport { SUIT_META } from '../data/constants.js';\nimport { SuitIcon } from './SuitIcon.jsx';\n\nexport function TarotCard({ card, onClick, selected, disabled, small, faceDown, badge, highlight }) {\n${slice(3507, 3619)}\n}\n`
);

// 11) New App.jsx = imports + App body
const appBody = slice(3625, lines.length);
const appHeader = `import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Sparkles, Shield, Swords, Flame, Coins, Wine, Eye, Skull, Crown,
  BookOpen, Volume2, VolumeX, RotateCcw, Layers, Zap, CheckCircle2,
  AlertTriangle, ChevronRight, X, Lock, Trophy, Users, Play, ScrollText,
  HelpCircle, Shuffle, Check, History, Pause, SkipBack, SkipForward, ChevronLeft, Trash2
} from 'lucide-react';

import { sfx } from './audio/sfx.js';
import {
  SUITS, SUIT_META, getCardSuit, RANK_LABELS, ROMAN, TARGETED_ABILITY_TAGS, PATHWAYS
} from './data/constants.js';
import {
  mulberry32, shuffle, buildMinorDeck, buildMajorCard, cardCode, suitCode,
  cardShortName, isNumberCard, isFaceCard
} from './utils/cards.js';
import {
  pCode, pzCode, instantCastCode, abilityCastCode, digestionCode, boardState,
  mergeActionCode, fogPrivateOps, fogNetlistAction, fogNetlistText,
  formatSpentPouchCodes, parseCardCode, splitTopLevelActions, parseNetlistToFrames,
  SAMPLE_REPLAY_NETLIST
} from './utils/netlist.js';
import {
  checkAscensionMath, findValidAscensionSubset, evaluateTrickWinner, getHandLimit
} from './utils/rules.js';
import { LotmNeuralNet } from './ai/LotmNeuralNet.js';
import { CardIdNeuralNet } from './ai/CardIdNeuralNet.js';
import {
  extractBoardFeatures, extractCardIdFeatures, getCardUniqueId, NN_HIGH_VAL_ABILITY_TAGS
} from './ai/features.js';
import {
  pickDiscardCardIdx, discardSmart, applyHeadlessAbility, runHeadlessGame
} from './ai/headless.js';
import { SuitIcon } from './components/SuitIcon.jsx';
import { TarotCard } from './components/TarotCard.jsx';

`;

write('src/App.jsx', appHeader + '\n' + appBody + '\n');
console.log('Done. App.jsx now', fs.readFileSync('src/App.jsx', 'utf8').split(/\n/).length, 'lines');
