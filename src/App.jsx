import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
import {
  extractBoardFeatures, extractCardIdFeatures, getCardUniqueId, buildCardKeySigns
} from './ai/features.js';
import {
  pickDiscardCardIdx, discardSmart, applyHeadlessAbility, applyHeadlessChaos, runHeadlessGame
} from './ai/headless.js';
import { makePolicyNet, isPolicyNet } from './ai/PolicyNet.js';
import { policyPick } from './ai/ppoBridge.js';
import { makeBrowserRLNet, isBrowserRLNet } from './ai/browserRL/BrowserRLNet.js';
import { TIER_DIMS } from './ai/browserRL/featuresRL.js';
import { SuitIcon } from './components/SuitIcon.jsx';
import { TarotCard } from './components/TarotCard.jsx';
import { RulebookModal } from './components/RulebookModal.jsx';
import { GameOverScreen } from './components/GameOverScreen.jsx';
import { SetupScreen } from './components/SetupScreen.jsx';
import { ReplayScreen } from './components/ReplayScreen.jsx';
import { TrainScreen } from './components/TrainScreen.jsx';
import { SimScreen } from './components/SimScreen.jsx';
import { LabScreen } from './components/LabScreen.jsx';
import { PlayingScreen } from './components/PlayingScreen.jsx';


export default function App() {
  // Screens: 'setup' | 'playing' | 'gameover'
  const [screen, setScreen] = useState('setup');
  const [playerCount, setPlayerCount] = useState(2);
  const [roundLimit, setRoundLimit] = useState(75);
  const [handLimitMode, setHandLimitMode] = useState('10-7');
  const [aiBrainMode, setAiBrainMode] = useState('heuristic_6');
  const [draftOptions, setDraftOptions] = useState([]);
  const [pickAnyMode, setPickAnyMode] = useState(false);

  // Browser RL tiers: small (16→8) | medium (40→20) | large (100→40)
  const [nnDifficulty, setNnDifficulty] = useState('small');
  const nnSmallRef = useRef(null);
  const nnMediumRef = useRef(null);
  const nnLargeRef = useRef(null);
  const loadSavedTier = (tier, storageKey) => {
    let saved = null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) saved = JSON.parse(raw);
    } catch (_) {}
    try {
      const memRaw = localStorage.getItem(`${storageKey}_mem`);
      if (memRaw && saved) saved.memoryExtra = JSON.parse(memRaw);
    } catch (_) {}
    return makeBrowserRLNet(tier, saved);
  };
  if (!nnSmallRef.current) nnSmallRef.current = loadSavedTier('small', 'lotm_nn_rl_small_v1');
  if (!nnMediumRef.current) nnMediumRef.current = loadSavedTier('medium', 'lotm_nn_rl_medium_v1');
  if (!nnLargeRef.current) nnLargeRef.current = loadSavedTier('large', 'lotm_nn_rl_large_v1');
  const nnEasyRef = nnSmallRef;
  const getActiveNN = () => {
    if (nnDifficulty === 'large') return nnLargeRef.current;
    if (nnDifficulty === 'medium') return nnMediumRef.current;
    return nnSmallRef.current;
  };
  const getActiveStorageKey = () => {
    if (nnDifficulty === 'large') return 'lotm_nn_rl_large_v1';
    if (nnDifficulty === 'medium') return 'lotm_nn_rl_medium_v1';
    return 'lotm_nn_rl_small_v1';
  };
  const brainForTier = (tier = nnDifficulty) => (
    tier === 'large' ? 'nn_large' : tier === 'medium' ? 'nn_medium' : 'nn_small'
  );
  const selectCardLivePolicy = (net, state, pId, candidates, phaseTag = 'trick') => {
    if (!net || !candidates?.length) return candidates?.[0] || null;
    if (isBrowserRLNet(net)) {
      return net.selectCard(state, pId, candidates, phaseTag, { training: false, exploreRate: 0 }) || candidates[0];
    }
    if (!isPolicyNet(net)) return candidates[0];
    const tier = net.tier === 'medium' ? 'medium' : 'small';
    const ctx = phaseTag === 'draft' ? 'draft' : phaseTag === 'pouch' ? 'pouch' : 'trick';
    const pick = policyPick(net, state, pId, ctx, { candidates }, tier);
    if (pick?.card) {
      const match = candidates.find(c => c === pick.card || c?.uid === pick.card?.uid);
      if (match) return match;
    }
    return candidates[0];
  };
  const queryPolicyYesNo = (net, state, pId, context = 'meta_yesno') => {
    if (!net) return false;
    if (isBrowserRLNet(net)) {
      const kind = context === 'ascend' ? 'ascend' : 'play';
      return net.decideYesNo(state, pId, kind, { training: false, exploreRate: 0 });
    }
    if (!isPolicyNet(net)) return false;
    const tier = net.tier === 'medium' ? 'medium' : 'small';
    const pick = policyPick(net, state, pId, context === 'ascend' ? 'ascend' : 'meta_yesno', {}, tier);
    return pick?.type === 'yes' || pick?.type === 'ascend';
  };
  const makeAscentNet = () => getActiveNN();
  const isAscentBrain = (brain) =>
    brain === 'nn_small' || brain === 'nn_medium' || brain === 'nn_large'
    || brain === 'nn_easy' || brain === 'nn_ascent' || brain === 'nn_hard';
  const selectCardLiveAscent = selectCardLivePolicy;
  const queryAscentYesNo = (net, state, pId) => queryPolicyYesNo(net, state, pId, 'meta_yesno');
  const makeCardNet = (brain) => {
    if (brain === 'nn_large' || brain === 'nn_hard' || brain === 'nn_ascent') {
      return makeBrowserRLNet('large', nnLargeRef.current?.serialize?.());
    }
    if (brain === 'nn_medium' || brain === 'nn_tabula') {
      return makeBrowserRLNet('medium', nnMediumRef.current?.serialize?.());
    }
    if (brain === 'nn_small' || brain === 'nn_easy' || brain === 'nn') {
      return makeBrowserRLNet('small', nnSmallRef.current?.serialize?.());
    }
    return null;
  };
  const snapCardNet = (ref) => ref?.current?.serialize?.();


  // Training Studio State (15% Exploration + RL Gradient Descent)
  const [trainMode, setTrainMode] = useState('nn_vs_heuristic'); // 'nn_vs_heuristic' | 'nn_selfplay'
  const [trainDepth, setTrainDepth] = useState(6);
  const [valOpponentDepth, setValOpponentDepth] = useState(6);
  const [valEveryN, setValEveryN] = useState(100); // fixed-interval greedy val; 0 = train-only
  const [valGamesN, setValGamesN] = useState(40);
  const [ascentLookaheadDepth, setAscentLookaheadDepth] = useState(1);
  const [ascentTrainBlock, setAscentTrainBlock] = useState(50);
  const [ascentValGames, setAscentValGames] = useState(100);
  const [ascentValOpponent, setAscentValOpponent] = useState('heuristic_6');
  const [ascentCurriculumTarget, setAscentCurriculumTarget] = useState(6);
  const [ascentSelfPlayMix, setAscentSelfPlayMix] = useState(0); // default: pure curriculum vs heuristic
  const [trainAlpha, setTrainAlpha] = useState(0.06);
  const [trainBatchSize, setTrainBatchSize] = useState(20);
  const [valSeed, setValSeed] = useState(133742);
  const [nnBanner, setNnBanner] = useState(null);
  const loadWeightsInputRef = useRef(null);
  const [trainLearnFromAi, setTrainLearnFromAi] = useState(true);
  const [trainRunning, setTrainRunning] = useState(false);
  const [trainLog, setTrainLog] = useState([]); // [{ ep, valWinRate, promotions }]
  const [trainProgress, setTrainProgress] = useState({ done: 0, total: 0, promotions: 0, lastValRate: null });
  const stopTrainRef = useRef(false);

  // Pure Evaluation Simulator State (0% Exploration, Frozen Champion NNs, Any-vs-Any Pairing!)
  const [simAiMode, setSimAiMode] = useState('nn_vs_heuristic');
  const [simPlayerCount, setSimPlayerCount] = useState(2); // Default 2P in AI Simulator!
  const [simSeatBrains, setSimSeatBrains] = useState(['nn_small', 'heuristic_6', 'heuristic_6', 'heuristic_6']);
  const simP1Brain = simSeatBrains[0];
  const simP2Brain = simSeatBrains[1];
  const setSimP1Brain = (val) => setSimSeatBrains(prev => [val, prev[1], prev[2], prev[3]]);
  const setSimP2Brain = (val) => setSimSeatBrains(prev => [prev[0], val, prev[2], prev[3]]);
  const [simDepth, setSimDepth] = useState(6);
  const [simBatchSize, setSimBatchSize] = useState(1000);
  const [simRunning, setSimRunning] = useState(false);
  const [simProgress, setSimProgress] = useState({ done: 0, total: 0 });
  const stopSimRef = useRef(false);
  const makeEmptyMatrix = () => Array.from({ length: 22 }, () => Array.from({ length: 22 }, () => ({ w: 0, g: 0 })));
  const makeEmptyPathwayStats = () => Object.fromEntries(PATHWAYS.map(p => [p.id, {
    games: 0, wins: 0, draws: 0, losses: 0, seq0Wins: 0, comebacks: 0, lostTurns: 0, tricksWon: 0,
    abilitiesUsed: 0, chaosUsed: 0, seqSum: 0, handSum: 0,
    K: 0, Q: 0, N: 0, P: 0, swords: 0, pentacles: 0, cups: 0, wands: 0
  }]));

  // Sorting & Pathway Filtering (shared by AI Simulator & 22x22 Round Robin)
  const [tableSortKey, setTableSortKey] = useState('wr');
  const [tableSortDir, setTableSortDir] = useState('desc');
  const [selectedPathwayFilter, setSelectedPathwayFilter] = useState(() => new Set(PATHWAYS.map(p => p.id)));
  const [showPathwayFilter, setShowPathwayFilter] = useState(false);

  // 22x22 Round Robin State (506 games/seed, same seed deck twice alternating P1/P2!)
  const [simSubTab, setSimSubTab] = useState('sim'); // 'sim' | 'rr'
  const [rrSeedsCount, setRrSeedsCount] = useState(10);
  const [rrRunning, setRrRunning] = useState(false);
  const [rrProgress, setRrProgress] = useState({ done: 0, total: 0 });
  const stopRrRef = useRef(false);
  const [rrStats, setRrStats] = useState(() => ({
    seedsDone: 0, games: 0, p1Wins: 0, p2Wins: 0, draws: 0, seq0Wins: 0, totalRounds: 0, comebacks: 0, records: [],
    matrix: makeEmptyMatrix(),
    pathwayStats: Object.fromEntries(PATHWAYS.map(p => [p.id, {
      games: 0, wins: 0, draws: 0, losses: 0, seq0Wins: 0, comebacks: 0, lostTurns: 0, tricksWon: 0,
      abilitiesUsed: 0, chaosUsed: 0, seqSum: 0, handSum: 0,
      K: 0, Q: 0, N: 0, P: 0, swords: 0, pentacles: 0, cups: 0, wands: 0
    }]))
  }));

  const [simStats, setSimStats] = useState(() => ({
    games: 0,
    nnWins: 0,
    draws: 0,
    records: [],
    seq0Wins: 0,
    comebacks: 0,
    totalRounds: 0,
    digested: 0,
    undigested: 0,
    mentalBreaks: 0,
    handSum: 0,
    pouchSum: 0,
    graveSum: 0,
    deckSum: 0,
    suitCounts: { swords: 0, wands: 0, pentacles: 0, cups: 0 },
    chaosCounts: {},
    pathwayStats: makeEmptyPathwayStats(),
    history: [] // [{ game, nnWinRate, avgRounds }]
  }));
  const [muted, setMuted] = useState(false);

  // Modals
  const [showCodex, setShowCodex] = useState(false);
  const [codexTab, setCodexTab] = useState('rules');
  const [codexPathwayId, setCodexPathwayId] = useState(0);
  const [codexSearch, setCodexSearch] = useState('');
  const [inspectPathwayId, setInspectPathwayId] = useState(null);
  const [showGrave, setShowGrave] = useState(false);
  const [showAscendModal, setShowAscendModal] = useState(false);
  const [ascendSelectedUids, setAscendSelectedUids] = useState([]);
  const [selectedHandUid, setSelectedHandUid] = useState(null);
  const [interruptSecLeft, setInterruptSecLeft] = useState(5);
  const [boardInspect, setBoardInspect] = useState(null); // { type: 'opp', oppId } | { type: 'card', card, label }
  const [logViewMode, setLogViewMode] = useState('both'); // 'both' | 'netlist' | 'detailed'
  const [netlistCopied, setNetlistCopied] = useState(false);
  const [gameHistory, setGameHistory] = useState(() => {
    try {
      const raw = localStorage.getItem('lotm_game_history_v1');
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  });
  const [replayInput, setReplayInput] = useState(SAMPLE_REPLAY_NETLIST);
  const [replayFrames, setReplayFrames] = useState(() => parseNetlistToFrames(SAMPLE_REPLAY_NETLIST));
  const [replayStep, setReplayStep] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeedMs, setReplaySpeedMs] = useState(950);
  const [replayTitle, setReplayTitle] = useState('Sample Verified Match (Fool vs Magician vs Empress)');
  const [historySavedToast, setHistorySavedToast] = useState(false);
  const lastSavedGameRef = useRef(null);

  // Setup netlist page: G= pathways, then separate opening-hand draws (#1: +…, #2: +…)
  const buildGameInitLogs = (players, detailText, startId = 1) => {
    const gLine = `G= ${players.map(pl => `${pCode(pl.id)}: z${pl.pathwayId}`).join(', ')};`;
    const dealLines = players.map(pl =>
      `${pCode(pl.id)}: ${pl.hand.map(c => '+' + cardCode(c)).join(',')}`
    );
    const dealDetails = players.map(pl => ({
      text: `${pl.name} opening hand (${pl.hand.length}): ${pl.hand.map(cardShortName).join(', ')}`,
      tone: 'info'
    }));
    const gEntry = {
      id: startId,
      headerCode: gLine,
      actions: [],
      details: [{ text: detailText, tone: 'gold' }],
      text: detailText,
      tone: 'gold',
      code: gLine
    };
    // Newest-first log stack: deal entry above G= so chronological export is G= then draws
    const dealEntry = {
      id: startId + 1,
      headerCode: dealLines.join('\n'),
      actions: [],
      details: dealDetails,
      text: `Initial draw — ${players.length} opening hands dealt.`,
      tone: 'info',
      code: dealLines.join('\n')
    };
    return [dealEntry, gEntry];
  };

  const exportLogsToNetlist = useCallback((logs, { fog = false, viewerSeat = 1 } = {}) => {
    // Chronological blocks; blank line after G= / before each Round (R{n}=)
    const blocks = [...(logs || [])].reverse().map(e => {
      if (e.headerCode !== undefined) {
        const actLine = (e.actions && e.actions.length > 0)
          ? `\n${e.actions.join(',\n')}`
          : '';
        return `${e.headerCode}${actLine}`;
      }
      return e.code || '';
    }).filter(Boolean);
    const paged = [];
    for (const block of blocks) {
      const firstLine = String(block).split(/\r?\n/)[0].trim();
      const prev = paged.length ? String(paged[paged.length - 1]).split(/\r?\n/)[0].trim() : '';
      if (/^R\d+=/.test(firstLine) && paged.length > 0) paged.push('');
      else if (paged.length > 0 && /^G=/.test(prev)) paged.push(''); // separate init draws from G=
      paged.push(block);
    }
    const raw = paged.join('\n');
    return fog ? fogNetlistText(raw, viewerSeat) : raw;
  }, []);

  const saveGameToHistory = useCallback((gState, customLabel = null) => {
    if (!gState || !gState.logs || gState.logs.length === 0) return;
    const netlist = exportLogsToNetlist(gState.logs);
    const wPl = gState.winnerId !== null ? gState.players[gState.winnerId] : null;
    const entry = {
      id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      date: new Date().toLocaleString(),
      title: customLabel || (wPl ? `${wPl.name} (${PATHWAYS[wPl.pathwayId]?.arcana}) Won — ${gState.round} Rnds` : `In-Progress Match (Round ${gState.round})`),
      winnerSeat: wPl ? `#${wPl.id + 1}` : '—',
      rounds: gState.round,
      players: gState.players.map(p => `#${p.id + 1}: ${PATHWAYS[p.pathwayId]?.arcana} (z${p.pathwayId})`).join(' · '),
      netlist
    };
    setGameHistory(prev => {
      const next = [entry, ...prev].slice(0, 25);
      try { localStorage.setItem('lotm_game_history_v1', JSON.stringify(next)); } catch (_) {}
      return next;
    });
    setHistorySavedToast(true);
    setTimeout(() => setHistorySavedToast(false), 1800);
  }, [exportLogsToNetlist]);

  const openReplayWithNetlist = useCallback((netlistText, title = 'Custom Netlist Replay') => {
    const frames = parseNetlistToFrames(netlistText);
    setReplayInput(netlistText);
    setReplayFrames(frames);
    setReplayStep(0);
    setReplayPlaying(false);
    setReplayTitle(title);
    setScreen('replay');
  }, []);
  // Ability & Mechanics Lab State
  const [labPathwayId, setLabPathwayId] = useState(0);
  const [labSeq, setLabSeq] = useState(9);
  const [labAudit, setLabAudit] = useState(null);
  const [labAuditTab, setLabAuditTab] = useState('all');
  const [labAuditSearch, setLabAuditSearch] = useState('');
  const [labChaosId, setLabChaosId] = useState(0);
  const [labState, setLabState] = useState(null);

  const buildLabSandbox = useCallback((pId = 0, seqNum = 9) => {
    const minors = buildMinorDeck();
    const pick = (suit, rank) => {
      const idx = minors.findIndex(c => c.suit === suit && c.rank === rank);
      return idx !== -1 ? minors.splice(idx, 1)[0] : minors.shift();
    };
    const humanHand = [
      pick('swords', 7),
      pick('wands', 6),
      pick('pentacles', 8),
      pick('cups', 10),
      pick('swords', 12), // Knight
      pick('wands', 13),  // Queen
      pick('pentacles', 14), // King
      buildMajorCard(2) // High Priestess
    ];
    const humanPouch = [
      pick('cups', 4),
      pick('pentacles', 5),
      pick('swords', 11) // Page Trap
    ];
    const opp1Hand = [pick('pentacles', 9), pick('swords', 8), pick('cups', 3), pick('wands', 5), pick('pentacles', 2)];
    const opp1Pouch = [pick('wands', 4), pick('swords', 5)];
    const opp2Hand = [pick('cups', 7), pick('swords', 4), pick('wands', 2), pick('pentacles', 6)];
    const opp2Pouch = [pick('cups', 3), pick('pentacles', 6)];
    const grave = [pick('swords', 9), pick('cups', 2), pick('wands', 11), pick('pentacles', 1), pick('swords', 3), pick('cups', 8)];
    const trumpCard = pick('cups', 6);
    const allMajors = PATHWAYS.map(p => p.id).filter(id => id !== 2 && id !== 4).map(id => buildMajorCard(id));
    const deck = [pick('wands', 9), pick('pentacles', 7), pick('swords', 1), buildMajorCard(4), ...shuffle([...minors, ...allMajors])];

    const players = [
      {
        id: 0, name: 'Tester (You)', isHuman: true, pathwayId: pId, seq: seqNum,
        actingDone: false, abilityUsed: false, abilityCastsThisSeq: 0, skipNextTurn: false, skippedThisRound: false,
        hand: humanHand, pouch: humanPouch, pouchLostThisRound: false, targetedThisRound: false, lostCardThisRound: false, mods: {}
      },
      {
        id: 1, name: 'Dummy A (Audrey)', isHuman: false, pathwayId: (pId + 1) % 22, seq: 8,
        actingDone: false, abilityUsed: false, abilityCastsThisSeq: 0, skipNextTurn: false, skippedThisRound: false,
        hand: opp1Hand, pouch: opp1Pouch, pouchLostThisRound: false, targetedThisRound: false, lostCardThisRound: false, mods: {}
      },
      {
        id: 2, name: 'Dummy B (Alger)', isHuman: false, pathwayId: (pId + 2) % 22, seq: 7,
        actingDone: false, abilityUsed: false, abilityCastsThisSeq: 0, skipNextTurn: false, skippedThisRound: false,
        hand: opp2Hand, pouch: opp2Pouch, pouchLostThisRound: false, targetedThisRound: false, lostCardThisRound: false, mods: {}
      }
    ];

    const initLogs = [
      {
        id: 3,
        headerCode: `T1= ${cardCode(trumpCard)}`,
        actions: [],
        details: [{ text: `Trick Phase ready (Trump: ${cardShortName(trumpCard)}). Use the Phase Stepper to run full Pouch → Draft → Trick → Ascend flow.`, tone: 'gold' }],
        text: `Trick Phase ready (Trump: ${cardShortName(trumpCard)}).`,
        tone: 'gold',
        code: `T1= ${cardCode(trumpCard)}`
      },
      ...buildGameInitLogs(
        players,
        `Lab initialized with ${ROMAN[pId]}. ${PATHWAYS[pId].arcana} (Seq ${seqNum} ${PATHWAYS[pId].seqs[seqNum].name}) — Full 78-card Deck.`,
        1
      )
    ];
    return {
      round: 1, dealerIdx: 0, players, deck, grave, centerDraft: [], trumpCard,
      draftOrder: [0, 1, 2], draftTurnIdx: 0, trickOrder: [0, 1, 2], trickTurnIdx: 0,
      trickPlays: [], trickWinnerId: null, phase: 'TRICK', roundMods: {}, pendingInteraction: null,
      logs: initLogs,
      winnerId: null
    };
  }, []);

  const openAbilityLab = () => {
    const fresh = buildLabSandbox(labPathwayId, labSeq);
    setLabState(fresh);
    setScreen('lab');
  };

  // Core Game State
  const [game, setGame] = useState(null);
  const aiTimerRef = useRef(null);

  // Initialize 3 random Major Arcana options for Setup
  const rollDraftOptions = useCallback(() => {
    const ids = shuffle(PATHWAYS.map(p => p.id)).slice(0, 3);
    setDraftOptions(ids);
  }, []);

  useEffect(() => {
    rollDraftOptions();
    return () => {
      if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    };
  }, [rollDraftOptions]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    sfx.muted = next;
  };

  // Start a new game with human choosing `humanPathwayId`
  const startGame = (humanPathwayId) => {
    sfx.ascend();
    const remainingIds = shuffle(PATHWAYS.map(p => p.id).filter(id => id !== humanPathwayId));
    const aiNames = ['Audrey', 'Alger', 'Derrick'];
    const players = [];

    players.push({
      id: 0,
      name: 'You',
      isHuman: true,
      pathwayId: humanPathwayId,
      seq: 9,
      actingDone: false,
      abilityUsed: false,
      abilityCastsThisSeq: 0,
      skipNextTurn: false,
      hand: [],
      pouch: [],
      pouchLostThisRound: false,
      targetedThisRound: false,
      lostCardThisRound: false,
      mods: {},
      brain: 'human'
    });

    for (let i = 1; i < playerCount; i++) {
      const pid = remainingIds.shift();
      players.push({
        id: i,
        name: aiNames[i - 1],
        isHuman: false,
        pathwayId: pid,
        seq: 9,
        actingDone: false,
        abilityUsed: false,
        skipNextTurn: false,
        hand: [],
        pouch: [],
        pouchLostThisRound: false,
        targetedThisRound: false,
        lostCardThisRound: false,
        mods: {},
        brain: aiBrainMode
      });
    }

    // Build Full 78-Card Deck: 56 Minor + all 22 Major Arcana (keep all 78 cards in play)
    const majorCards = PATHWAYS.map(p => buildMajorCard(p.id));
    let deck = shuffle([...buildMinorDeck(), ...majorCards]);

    // Deal 7 cards each (logged separately after G= as #n: +card,+card,…)
    for (const p of players) {
      p.hand = deck.splice(0, 7);
    }

    const initialState = {
      round: 1,
      dealerIdx: 0,
      players,
      deck,
      grave: [],
      centerDraft: [],
      trumpCard: null,
      draftOrder: [],
      draftTurnIdx: 0,
      trickOrder: [],
      trickTurnIdx: 0,
      trickPlays: [],
      trickWinnerId: null,
      phase: 'POUCH_ADD', // POUCH_ADD -> DRAFT -> TRICK -> TRICK_REWARD -> ASCEND
      roundMods: {},
      pendingInteraction: null, // { type: 'TARGET' | 'INTERRUPT' | 'GAMBLE_SUIT' | 'POUCH_SWAP', ... }
      spectatorMode: false,
      logs: buildGameInitLogs(
        players,
        `Game started! You walk the ${PATHWAYS[humanPathwayId].arcana} (${PATHWAYS[humanPathwayId].lotm}) Pathway (Full 78-card Deck).`
      ),
      winnerId: null
    };

    // Start Round 1: draw 1 card for everyone, AI tucks 1 card into Pouch, human picks Pouch card
    const started = beginRoundDraw(initialState);
    setGame(started);
    setScreen('playing');
  };

  // Watch AI vs AI / NN vs Heuristic on the live board; netlist is saved for Replay
  const startWatchMatch = (p1Brain = 'nn_tabula', p2Brain = 'heuristic_6', p1PathwayId = null, p2PathwayId = null) => {
    sfx.ascend();
    const ids = shuffle(PATHWAYS.map(p => p.id));
    const pid1 = p1PathwayId ?? ids[0];
    const pid2 = p2PathwayId ?? ids.find(id => id !== pid1) ?? ((pid1 + 1) % 22);
    const brainLabel = (b) => b.startsWith('nn') ? b.toUpperCase() : b.replace('heuristic_', 'D');
    const players = [
      {
        id: 0, name: `P1 (${brainLabel(p1Brain)})`, isHuman: false, pathwayId: pid1, seq: 9,
        actingDone: false, abilityUsed: false, abilityCastsThisSeq: 0, skipNextTurn: false,
        hand: [], pouch: [], pouchLostThisRound: false, targetedThisRound: false, lostCardThisRound: false,
        mods: {}, brain: p1Brain
      },
      {
        id: 1, name: `P2 (${brainLabel(p2Brain)})`, isHuman: false, pathwayId: pid2, seq: 9,
        actingDone: false, abilityUsed: false, abilityCastsThisSeq: 0, skipNextTurn: false,
        hand: [], pouch: [], pouchLostThisRound: false, targetedThisRound: false, lostCardThisRound: false,
        mods: {}, brain: p2Brain
      }
    ];
    const majorCards = PATHWAYS.map(p => buildMajorCard(p.id));
    let deck = shuffle([...buildMinorDeck(), ...majorCards]);
    for (const p of players) p.hand = deck.splice(0, 7);

    const initialState = {
      round: 1, dealerIdx: 0, players, deck, grave: [], centerDraft: [], trumpCard: null,
      draftOrder: [], draftTurnIdx: 0, trickOrder: [], trickTurnIdx: 0, trickPlays: [], trickWinnerId: null,
      phase: 'POUCH_ADD', roundMods: {}, pendingInteraction: null, spectatorMode: true,
      seatBrains: [p1Brain, p2Brain],
      logs: buildGameInitLogs(
        players,
        `SPECTATE: ${players[0].name} (${PATHWAYS[pid1].arcana}) vs ${players[1].name} (${PATHWAYS[pid2].arcana})`
      ),
      winnerId: null
    };
    // Temporarily drive AI automation using each seat's brain
    setAiBrainMode(p1Brain);
    const started = beginRoundDraw(initialState);
    setGame(started);
    setScreen('playing');
  };

  // Helper: Draw from deck (auto-reshuffle grave if completely empty)
  function drawCardsFromDeck(state, count) {
    const drawn = [];
    let deck = [...state.deck];
    let grave = [...state.grave];
    for (let i = 0; i < count; i++) {
      if (deck.length === 0 && grave.length > 0) {
        deck = shuffle(grave);
        grave = [];
      }
      if (deck.length > 0) drawn.push(deck.shift());
    }
    return { drawn, deck, grave };
  }

  function addLog(logs, text, tone = 'normal', code = null, opts = {}) {
    const nextId = (logs[0]?.id || 0) + 1;
    if (opts.newPhase) {
      return [{
        id: nextId,
        headerCode: code || '',
        actions: [],
        details: [{ text, tone }],
        text,
        tone,
        code
      }, ...logs].slice(0, 300);
    }
    if (opts.appendEffect && logs.length > 0 && logs[0].actions && logs[0].actions.length > 0) {
      const head = logs[0];
      const acts = [...head.actions];
      // Skip trailing digestion board-state tokens {#1: q8$} (and legacy forms)
      let targetIdx = acts.length - 1;
      while (targetIdx > 0 && /^(?:\{#\d+:\s*q\d+\$\}|#\d+:\s*(?:\{q\d+\}|q\d+>))$/.test(acts[targetIdx])) targetIdx--;
      const last = acts[targetIdx];
      if (code) {
        acts[targetIdx] = mergeActionCode(last, code);
      }
      const nextDetails = [...(head.details || [{ text: head.text, tone: head.tone }]), { text, tone }];
      return [{ ...head, actions: acts, details: nextDetails }, ...logs.slice(1)];
    }
    // Digestion completes as a board-state sibling on the same line as the triggering action
    if (opts.appendDigest && logs.length > 0 && logs[0].actions && logs[0].actions.length > 0 && code) {
      const head = logs[0];
      const acts = [...head.actions];
      acts[acts.length - 1] = `${acts[acts.length - 1]}, ${code}`;
      const nextDetails = [...(head.details || [{ text: head.text, tone: head.tone }]), { text, tone }];
      return [{ ...head, actions: acts, details: nextDetails }, ...logs.slice(1)];
    }
    if (logs.length > 0 && logs[0].headerCode !== undefined && !opts.standalone) {
      const head = logs[0];
      const nextActions = code ? [...(head.actions || []), code] : (head.actions || []);
      const nextDetails = [...(head.details || [{ text: head.text, tone: head.tone }]), { text, tone }];
      return [{ ...head, actions: nextActions, details: nextDetails }, ...logs.slice(1)];
    }
    return [{ id: nextId, text, tone, code, details: [{ text, tone }] }, ...logs].slice(0, 300);
  }

  // Live card selector — PolicyNet candidate scorer
  function selectCardLiveHard(net, state, pId, candidates, phaseTag = 'trick') {
    return selectCardLivePolicy(net, state, pId, candidates, phaseTag);
  }

  // Activate the Suit Action of a Knight or Queen whenever played as an Instant Interrupt!
  function applyInstantFaceSuitAction(s, blocker, attacker, faceCard) {
    if (!faceCard || s.roundMods?.cancelSuitActions) return;
    if (faceCard.suit === 'pentacles') {
      const r = drawCardsFromDeck(s, 1);
      s.deck = r.deck; s.grave = r.grave;
      blocker.hand.push(...r.drawn);
      s.logs = addLog(s.logs, `INSTANT PENTACLE! ${blocker.name}'s ${cardShortName(faceCard)} drew 1 card from Deck!`, 'emerald', r.drawn.map(c => '+' + cardCode(c)).join(','), { appendEffect: true });
    } else if (faceCard.suit === 'cups') {
      if (s.grave.length > 0) {
        const pulled = s.grave.shift();
        blocker.hand.push(pulled);
        s.logs = addLog(s.logs, `INSTANT CUP! ${blocker.name}'s ${cardShortName(faceCard)} pulled ${cardShortName(pulled)} from Grave!`, 'info', `+${cardCode(pulled)}g`, { appendEffect: true });
      }
    } else if (faceCard.suit === 'swords' && attacker && !attacker.mods?.pouchImmune && attacker.pouch.length > 0) {
      const idx = Math.floor(Math.random() * attacker.pouch.length);
      const hit = attacker.pouch.splice(idx, 1)[0];
      s.grave.unshift(hit);
      attacker.pouchLostThisRound = true;
      s.logs = addLog(s.logs, `INSTANT SWORD! ${blocker.name}'s ${cardShortName(faceCard)} destroyed 1 of ${attacker.name}'s Pouch cards!`, 'danger', `${pCode(attacker.id)}: -/${cardCode(hit)}`, { appendEffect: true });
    } else if (faceCard.suit === 'wands' && attacker && !attacker.mods?.handImmune && attacker.hand.length > 0) {
      if (!(attacker.mods?.sunFloor && attacker.hand.length <= 3)) {
        if (attacker.isHuman) {
          s.pendingInteraction = { type: 'CHOOSE_DISCARD', count: 1, destination: 'grave', selectedUids: [], appendEffect: true, effectPrefix: '#1: ', reason: `${blocker.name}'s Instant ${cardShortName(faceCard)} forces you to discard 1 card.` };
          attacker.lostCardThisRound = true;
          s.logs = addLog(s.logs, `INSTANT WAND! ${blocker.name}'s ${cardShortName(faceCard)} forces you to choose 1 card to discard.`, 'danger');
        } else {
          const dIdx = pickDiscardCardIdx(attacker.hand, attacker.seq);
          const dropped = attacker.hand.splice(dIdx, 1)[0];
          s.grave.unshift(dropped);
          attacker.lostCardThisRound = true;
          s.logs = addLog(s.logs, `INSTANT WAND! ${blocker.name}'s ${cardShortName(faceCard)} forced ${attacker.name} to discard ${cardShortName(dropped)}!`, 'danger', `${pCode(attacker.id)}: -${cardCode(dropped)}`, { appendEffect: true });
        }
      }
    }
  }

  function beginRoundDraw(state) {
    let s = {
      ...state,
      players: state.players.map(p => ({
        ...p,
        abilityUsed: false,
        ascendedThisRound: false,
        pouchLostThisRound: false,
        targetedThisRound: false,
        lostCardThisRound: false,
        mods: {}
      })),
      roundMods: {},
      trickPlays: [],
      trickWinnerId: null,
      pendingInteraction: null
    };

    // Emit Round/Pouch header FIRST so Mental Break recoveries & AI Pouch tucks stay cleanly inside R{n}=
    const preInactive = s.players.filter(pl => pl.skipNextTurn).map(pl => `${pCode(pl.id)}x`);
    const roundHeaderTop = preInactive.length > 0 ? `R${s.round}= (${preInactive.join(', ')})` : `R${s.round}=`;
    s.logs = addLog(s.logs, `Round ${s.round} — Phase 1: Pouch Management${preInactive.length > 0 ? ` (Inactive this round: ${s.players.filter(pl => pl.skipNextTurn).map(pl => pl.name).join(', ')})` : ''}.`, 'info', roundHeaderTop, { newPhase: true });

    // Start-of-turn: NO initial draw! Players who ended last round at 0 cards skip this round & draw 2 to recover.
    for (let i = 0; i < s.players.length; i++) {
      const p = s.players[i];
      if (p.skipNextTurn) {
        p.skippedThisRound = true;
        const rec = drawCardsFromDeck(s, 2);
        s.deck = rec.deck;
        s.grave = rec.grave;
        p.hand = [...p.hand, ...rec.drawn];
        s.logs = addLog(s.logs, `MENTAL BREAK: ${p.name} is inactive this round and draws 2 recovery cards (${rec.drawn.map(cardShortName).join(', ')}).`, 'danger', `${pCode(p.id)}x (${rec.drawn.map(c => '+' + cardCode(c)).join(',')})`);
        continue;
      }

      // AI Phase 1 Pouch Tucking (respects selected Heuristic Depth 1-6 / NN Easy / NN Medium!)
      const maxP = p.mods.maxPouch || 3;
      if (!p.isHuman && p.pouch.length > 0 && !p.mods.savantSubtract) {
        for (let pi = p.pouch.length - 1; pi >= 0; pi--) {
          const pc = p.pouch[pi];
          if (pc.type === 'minor' && pc.rank <= 9 && pc.rank > p.seq) {
            const evicted = p.pouch.splice(pi, 1)[0];
            s.grave.unshift(evicted);
            s.logs = addLog(s.logs, `${p.name} discarded stale ${cardShortName(evicted)} from Pouch.`, 'muted', `${pCode(p.id)}: -/${cardCode(evicted)}`);
          }
        }
      }
      if (!p.isHuman && p.hand.length >= 2) {
        const seatBrain = p.brain || aiBrainMode;
        const evalAscent = isAscentBrain(seatBrain) ? makeAscentNet() : null;
        const evalHard = evalAscent ? null : makeCardNet(seatBrain);
        if (!findValidAscensionSubset(p.pouch, p.seq, p.mods)) {
          const hNums = p.hand.filter(c => c.type === 'minor' && ((c.rank >= 1 && c.rank <= p.seq) || c.rank === 10));
          const comb = [...p.pouch, ...hNums];
          let bestSub = null;
          const lim = Math.min(comb.length, 10);
          for (let mask = 1; mask < (1 << lim); mask++) {
            const sub = [];
            for (let b = 0; b < lim; b++) if (mask & (1 << b)) sub.push(comb[b]);
            if (sub.length > maxP) continue;
            if (checkAscensionMath(sub, p.seq, p.mods).valid) {
              const fromH = sub.filter(c => p.hand.some(h => h.uid === c.uid));
              if (p.hand.length - fromH.length >= (p.seq === 1 ? 0 : 1)) {
                if (!bestSub || fromH.length < bestSub.fromH.length) bestSub = { sub, fromH };
              }
            }
          }
          if (bestSub) {
            const keepSet = new Set(bestSub.sub.map(c => c.uid));
            while (p.pouch.length + bestSub.fromH.length > maxP) {
              const rIdx = p.pouch.findIndex(c => !keepSet.has(c.uid));
              if (rIdx === -1) break;
              const droppedP = p.pouch.splice(rIdx, 1)[0];
              s.grave.unshift(droppedP);
              s.logs = addLog(s.logs, `${p.name} discarded ${cardShortName(droppedP)} from Pouch.`, 'muted', `${pCode(p.id)}: -/${cardCode(droppedP)}`);
            }
            for (const hc of bestSub.fromH) {
              if (p.pouch.length < maxP) {
                p.hand = p.hand.filter(c => c.uid !== hc.uid);
                p.pouch.push(hc);
                s.logs = addLog(s.logs, `${p.name} tucked ${cardShortName(hc)} into Pouch.`, 'muted', `${pCode(p.id)}: +/${cardCode(hc)}`);
              }
            }
          } else if (p.pouch.length < maxP) {
            let pick = null;
            const cands = p.hand.filter(c => c.type === 'minor' && (c.rank <= p.seq || c.rank === 10 || (p.pouch.length < 2 && c.rank === 11)));
            if (evalAscent && cands.length > 0) {
              pick = selectCardLiveAscent(evalAscent, s, p.id, cands, 'pouch');
            } else if (evalHard && cands.length > 0) {
              pick = selectCardLiveHard(evalHard, s, p.id, cands, 'pouch');
            } else {
              const nonTen = hNums.filter(c => c.rank !== 10).sort((a, b) => b.rank - a.rank);
              pick = nonTen[0] || (p.pouch.length < 2 ? p.hand.find(c => c.type === 'minor' && c.rank === 11) : null);
            }
            if (pick) {
              p.hand = p.hand.filter(c => c.uid !== pick.uid);
              p.pouch.push(pick);
              s.logs = addLog(s.logs, `${p.name} tucked ${cardShortName(pick)} into Pouch.`, 'muted', `${pCode(p.id)}: +/${cardCode(pick)}`);
            }
          }
        }
      }
    }

    const human = s.players.find(p => p.isHuman);
    // Spectator / all-AI: skip interactive Bag phase (AI already tucked above)
    if (!human || human.skipNextTurn || (human.hand.length === 0 && human.pouch.length === 0) || s.spectatorMode) {
      return startDraftPhase(s);
    }
    s.phase = 'POUCH_ADD';
    return s;
  }

  function startDraftPhase(state) {
    let s = { ...state };
    const n = s.players.length;
    const res = drawCardsFromDeck(s, n + 1);
    s.deck = res.deck;
    s.grave = res.grave;
    s.centerDraft = res.drawn;

    // Draft order: active (non-skipped) players only; lowest rank (highest seq number) picks first
    const activeForDraft = s.players.filter(p => !p.skippedThisRound);
    const resAdj = drawCardsFromDeck({ ...s, deck: [...s.deck], grave: [...s.grave] }, 0);
    if (activeForDraft.length < s.players.length) {
      // Trim centerDraft to active + 1
      const extra = s.centerDraft.splice(activeForDraft.length + 1);
      s.deck = [...extra, ...s.deck];
    }
    const order = [...activeForDraft]
      .sort((a, b) => {
        if (b.seq !== a.seq) return b.seq - a.seq;
        const da = (a.id - s.dealerIdx + n) % n;
        const db = (b.id - s.dealerIdx + n) % n;
        return da - db;
      })
      .map(p => p.id);

    s.draftOrder = order;
    s.draftTurnIdx = 0;
    s.phase = 'DRAFT';
    s.logs = addLog(s.logs, `Center revealed ${s.centerDraft.length} cards (${s.centerDraft.map(cardShortName).join(', ')}). Lowest Sequence drafts first.`, 'info', `D${s.round}= ${s.centerDraft.map(cardCode).join(', ')}`, { newPhase: true });
    return s;
  }

  function startTrickPhase(state) {
    let s = { ...state };
    // Remaining card becomes Trump Card
    s.trumpCard = s.centerDraft[0] || null;
    s.centerDraft = [];
    // Trick order: reverse of draftOrder (last drafter / highest Sequence leads!)
    s.trickOrder = [...s.draftOrder].reverse();
    s.trickTurnIdx = 0;
    s.trickPlays = [];
    s.phase = 'TRICK';
    s.logs = addLog(
      s.logs,
      `Trump Card set: ${cardShortName(s.trumpCard)}. ${s.players[s.trickOrder[0]].name} leads the trick!`,
      'gold',
      `T${s.round}= ${cardCode(s.trumpCard)}`,
      { newPhase: true }
    );
    return s;
  }

  // Mark Acting Condition done if player hasn't completed it yet
  function markActed(player, logs, reason) {
    if (!player.actingDone) {
      player.actingDone = true;
      if (player.isHuman) sfx.digest();
      return addLog(logs, `${player.name} digested Sequence ${player.seq} (${PATHWAYS[player.pathwayId].seqs[player.seq]?.name}): ${reason}`, 'emerald', digestionCode(player), { appendDigest: true });
    }
    return logs;
  }

  // Resolve a Major Arcana Chaos Event (FIFO) + Grave Recycle X
  // opts.asTrick: Major was played into the trick — do NOT log as instant cast
  function resolveChaosEvent(state, playerId, majorCard, targetOppId = null, opts = {}) {
    sfx.chaosEvent();
    let s = {
      ...state,
      players: state.players.map(p => ({ ...p, hand: [...p.hand], pouch: [...p.pouch], mods: { ...p.mods } })),
      deck: [...state.deck],
      grave: [...state.grave],
      roundMods: { ...state.roundMods }
    };
    const actor = s.players[playerId];
    actor.hand = actor.hand.filter(c => c.uid !== majorCard.uid);

    const others = s.players.filter(p => p.id !== playerId && !p.skippedThisRound);
    const target = (targetOppId !== null && s.players[targetOppId] && !s.players[targetOppId].skippedThisRound) ? s.players[targetOppId] : (others[0] || null);
    const id = majorCard.majorId;

    const isTargetedChaos = [1, 3, 6, 17].includes(id);
    if (!opts.asTrick) {
      const tgt = (isTargetedChaos && target) ? pCode(target.id) : null;
      s.logs = addLog(s.logs, `CHAOS EVENT! ${actor.name} invokes ${majorCard.roman}. ${majorCard.name} (Recycles ${id} from Grave).`, 'chaos', instantCastCode(actor, `X${id}`, tgt));
    }

    // Guard Trump-dependent Chaos Events if Trump Card is not revealed yet (Phase 1 Pouch)
    if ((id === 0 || id === 16) && !s.trumpCard) {
      actor.hand.push(majorCard);
      s.logs = addLog(s.logs, `Wait until the Trump Card is revealed (after Draft) to invoke ${majorCard.roman}. ${majorCard.name}!`, 'danger');
      return s;
    }

    // AI / spectator: same chaos table as headless training engine
    if (!actor.isHuman) {
      const draw = (n) => {
        const out = [];
        for (let i = 0; i < n; i++) {
          if (s.deck.length === 0 && s.grave.length > 0) {
            s.deck = shuffle([...s.grave], Math.random);
            s.grave = [];
          }
          if (s.deck.length > 0) out.push(s.deck.shift());
        }
        return out;
      };
      s.trumpCard = applyHeadlessChaos(
        actor, majorCard, target, s.players, s.deck, s.grave, s.trumpCard, s.roundMods, draw, Math.random
      );
      s.logs = addLog(s.logs, `Chaos resolved via shared engine (X${id}).`, 'chaos', null, { appendEffect: true });
      return s;
    }

    // Human: interactive chaos (modals) — effects mirror applyHeadlessChaos
    if (id === 0) { // Fool: swap Trump with any Hand card
      const swapCands = actor.hand;
      if (swapCands.length > 0 && s.trumpCard) {
        if (actor.isHuman) {
          s.pendingInteraction = {
            type: 'HAND_SWAP_TRUMP',
            title: 'The Fool Chaos — Choose a Hand Card to Become the New Trump Card',
            cards: swapCands
          };
        } else {
          const chosenSwap = swapCands[0];
          actor.hand = actor.hand.filter(c => c.uid !== chosenSwap.uid);
          actor.hand.push(s.trumpCard);
          s.trumpCard = chosenSwap;
          s.roundMods.trumpChanged = true;
          s.logs = addLog(s.logs, `Trump Card swapped to ${cardShortName(chosenSwap)}!`, 'chaos', `(T=${cardCode(chosenSwap)})`);
        }
      }
    } else if (id === 1) { // Magician: swap Pouch with opp
      if (actor.pouch.length > 0 && target && target.pouch.length > 0) {
        const aCard = actor.pouch.pop();
        const tCard = target.pouch.pop();
        actor.pouch.push(tCard);
        target.pouch.push(aCard);
        s.logs = addLog(
          s.logs,
          `${actor.name} swapped a Pouch card with ${target.name}!`,
          'chaos',
          `${pCode(actor.id)}/B(${cardCode(aCard)})↔${pCode(target.id)}/B(${cardCode(tCard)})`,
          { appendEffect: true }
        );
      }
    } else if (id === 2) { // High Priestess: peek & reorder top 3
      if (s.deck.length >= 2) {
        const cnt = Math.min(3, s.deck.length);
        if (actor.isHuman) {
          s.pendingInteraction = {
            type: 'DECK_REORDER',
            title: 'High Priestess Chaos — Reorder Top 3 Deck Cards',
            cards: s.deck.slice(0, cnt),
            count: cnt
          };
          s.logs = addLog(s.logs, `${actor.name} divined the top ${cnt} Deck cards.`, 'chaos');
        } else {
          const beforeCodes = s.deck.slice(0, cnt).map(cardCode).join(',');
          const top = s.deck.splice(0, cnt);
          top.sort((a, b) => (b.rank || 10) - (a.rank || 10));
          s.deck = [...top, ...s.deck];
          const afterCodes = top.map(cardCode).join(',');
          const code = beforeCodes !== afterCodes
            ? `k^${boardState(`${beforeCodes}>${afterCodes}`)}`
            : `k^: V(${afterCodes})`;
          s.logs = addLog(s.logs, `${actor.name} divined and reordered the top ${cnt} Deck cards.`, 'chaos', code, { appendEffect: true });
        }
      }
    } else if (id === 3) { // Empress: opponent discards 1 card if they do not reveal a Page (even if Pouch empty!)
      if (target && !s.roundMods.globalImmunity) {
        let revealedPage = false;
        let revealedCard = null;
        if (target.pouch.length > 0 && !target.mods.pouchImmune) {
          const idx = Math.floor(Math.random() * target.pouch.length);
          revealedCard = target.pouch[idx];
          if (revealedCard.rank === 11) {
            target.pouch.splice(idx, 1);
            s.grave.unshift(revealedCard);
            revealedPage = true;
            s.logs = addLog(s.logs, `Empress exposed and destroyed ${target.name}'s Page Trap (${cardShortName(revealedCard)})!`, 'danger', `${pCode(target.id)}: /V(${cardCode(revealedCard)}), -/${cardCode(revealedCard)}`, { appendEffect: true });
          } else {
            s.logs = addLog(s.logs, `Empress revealed ${target.name}'s Pouch card: ${cardShortName(revealedCard)} (not a Page).`, 'chaos', `${pCode(target.id)}: /V(${cardCode(revealedCard)})`, { appendEffect: true });
          }
        }
        if (!revealedPage && !target.mods.handImmune && target.hand.length > 0) {
          if (target.isHuman) {
            const queens = target.hand.filter(c => c.rank === 13);
            if (queens.length > 0 && !actor.isHuman) {
              s.pendingInteraction = { type: 'INTERRUPT', source: 'chaos_discard', attackType: 'wand', attackerId: playerId, card: majorCard, blockCards: queens, blockCard: queens[0], discardCount: 1, reason: `Empress Chaos (${revealedCard ? 'revealed ' + cardShortName(revealedCard) : 'no Page in Pouch'}) forces you to discard 1 card.` };
            } else {
              s.pendingInteraction = { type: 'CHOOSE_DISCARD', count: 1, destination: 'grave', selectedUids: [], appendEffect: true, effectPrefix: '#1: ', reason: `Empress Chaos: ${revealedCard ? 'Revealed ' + cardShortName(revealedCard) + ' (not a Page)' : 'No Page in Pouch'} — choose 1 card to discard.` };
            }
          } else {
            const dIdx = pickDiscardCardIdx(target.hand, target.seq);
            const d = target.hand.splice(dIdx, 1)[0];
            s.grave.unshift(d);
            target.lostCardThisRound = true;
            s.logs = addLog(s.logs, `Empress Chaos: ${target.name} did not reveal a Page and discarded ${cardShortName(d)}.`, 'chaos', `${pCode(target.id)}: -${cardCode(d)}`, { appendEffect: true });
          }
        }
      }
    } else if (id === 4) { // Emperor: invert trick rankings
      s.roundMods.invertTrick = true;
      s.logs = addLog(s.logs, `Emperor inverted the trick: LOWEST number wins!`, 'chaos', 'inv', { appendEffect: true });
    } else if (id === 5) { // Hierophant: opps without Trump Suit discard 1
      const reqSuit = getCardSuit(s.trumpCard) || 'swords';
      for (const o of others) {
        if (!o.hand.some(c => getCardSuit(c) === reqSuit) && o.hand.length > 0 && !o.mods.handImmune) {
          if (o.isHuman) {
            s.pendingInteraction = { type: 'CHOOSE_DISCARD', count: 1, destination: 'grave', selectedUids: [], appendEffect: true, effectPrefix: '#1: ', reason: `Hierophant Chaos: You lack ${SUIT_META[reqSuit].name} — choose 1 card to discard.` };
            s.logs = addLog(s.logs, `${o.name} lacked ${SUIT_META[reqSuit].name} and must choose 1 card to discard.`, 'chaos');
          } else {
            const dIdx = pickDiscardCardIdx(o.hand, o.seq);
            const dropped = o.hand.splice(dIdx, 1)[0];
            s.grave.unshift(dropped);
            s.logs = addLog(s.logs, `${o.name} lacked ${SUIT_META[reqSuit].name} and discarded ${cardShortName(dropped)}.`, 'chaos', `${pCode(o.id)}: -${cardCode(dropped)}`, { appendEffect: true });
          }
        }
      }
    } else if (id === 6) { // Lovers: swap random Hand card with target
      if (actor.hand.length > 0 && target && target.hand.length > 0) {
        const aIdx = Math.floor(Math.random() * actor.hand.length);
        const tIdx = Math.floor(Math.random() * target.hand.length);
        const aC = actor.hand[aIdx];
        const tC = target.hand[tIdx];
        actor.hand[aIdx] = tC;
        target.hand[tIdx] = aC;
        s.logs = addLog(s.logs, `${actor.name} and ${target.name} exchanged 1 random Hand card.`, 'chaos', `${pCode(actor.id)}↔${pCode(target.id)} H(${cardCode(aC)}↔${cardCode(tC)})`, { appendEffect: true });
      }
    } else if (id === 7) { // Chariot: leading suit cannot be trumped
      s.roundMods.noTrumpChariot = true;
      s.logs = addLog(s.logs, `Chariot locked the trick: Leading Suit cannot be trumped!`, 'chaos', 'noT', { appendEffect: true });
    } else if (id === 8) { // Strength: all Pouches & Hands immune this turn
      s.roundMods.globalImmunity = true;
      s.logs = addLog(s.logs, `Strength protects all Pouches and Hands from Swords/Wands this round!`, 'chaos', 'immAll', { appendEffect: true });
    } else if (id === 9) { // Hermit: take top card from Grave before recycle
      if (s.grave.length > 0) {
        const taken = s.grave.shift();
        actor.hand.push(taken);
        s.logs = addLog(s.logs, `${actor.name} retrieved ${cardShortName(taken)} from the Grave.`, 'chaos', `+${cardCode(taken)}g`, { appendEffect: true });
      }
    } else if (id === 10) { // Wheel of Fortune: everyone passes 1 left + draws 1
      const passed = s.players.map(p => (p.hand.length > 0 ? p.hand.pop() : null));
      const wheelParts = [];
      s.players.forEach((p, idx) => {
        const fromIdx = (idx - 1 + s.players.length) % s.players.length;
        const got = passed[fromIdx];
        if (got) {
          p.hand.push(got);
          wheelParts.push(`${pCode(p.id)}: +${cardCode(got)}s`);
        }
        const r = drawCardsFromDeck(s, 1);
        s.deck = r.deck; s.grave = r.grave;
        p.hand.push(...r.drawn);
        if (r.drawn.length > 0) wheelParts.push(`${pCode(p.id)}: ${r.drawn.map(c => '+' + cardCode(c)).join(',')}`);
      });
      s.logs = addLog(s.logs, `Wheel of Fortune rotated 1 Hand card left and drew 1 for everyone!`, 'chaos', wheelParts.join(', ') || 'rotL', { appendEffect: true });
    } else if (id === 11) { // Justice: richest gives 1 to poorest
      const sorted = [...s.players].sort((a, b) => b.hand.length - a.hand.length);
      const rich = sorted[0];
      const poor = sorted[sorted.length - 1];
      if (rich.id !== poor.id && rich.hand.length > 0) {
        const given = rich.hand.pop();
        poor.hand.push(given);
        s.logs = addLog(s.logs, `Justice balanced hands: ${rich.name} gave 1 card to ${poor.name}.`, 'chaos', `${pCode(rich.id)}>${pCode(poor.id)}(${cardCode(given)})`, { appendEffect: true });
      }
    } else if (id === 12) { // Hanged Man: discard 2 -> top 2 of Deck to Pouch
      const r = drawCardsFromDeck(s, 2);
      s.deck = r.deck; s.grave = r.grave;
      const gainedCodes = [];
      for (const c of r.drawn) {
        if (actor.pouch.length < (actor.mods.maxPouch || 3)) { actor.pouch.push(c); gainedCodes.push('+/' + cardCode(c)); }
        else { actor.hand.push(c); gainedCodes.push('+' + cardCode(c)); }
      }
      if (actor.isHuman && actor.hand.length > 0) {
        const cnt = Math.min(2, actor.hand.length);
        s.pendingInteraction = { type: 'CHOOSE_DISCARD', count: cnt, destination: 'grave', selectedUids: [], appendEffect: true, effectPrefix: '#1: ', reason: `Hanged Man Chaos: Choose ${cnt} Hand card(s) to sacrifice.` };
        s.logs = addLog(s.logs, `${actor.name} invoked Hanged Man (${gainedCodes.join(', ')}) — choose ${cnt} Hand card(s) to sacrifice.`, 'chaos', gainedCodes.join(','), { appendEffect: true });
      } else {
        const sac = [];
        for (let k = 0; k < 2 && actor.hand.length > 0; k++) {
          const dIdx = pickDiscardCardIdx(actor.hand, actor.seq);
          const dc = actor.hand.splice(dIdx, 1)[0];
          s.grave.unshift(dc);
          sac.push('-' + cardCode(dc));
        }
        s.logs = addLog(s.logs, `${actor.name} sacrificed ${sac.length} Hand cards to tuck Deck cards into Pouch!`, 'chaos', [...sac, ...gainedCodes].join(','), { appendEffect: true });
      }
    } else if (id === 13) { // Death: destroy 1 from every Pouch
      const deathParts = [];
      for (const p of s.players) {
        if (p.pouch.length > 0 && !p.mods.pouchImmune) {
          const idx = Math.floor(Math.random() * p.pouch.length);
          const rem = p.pouch.splice(idx, 1)[0];
          s.grave.unshift(rem);
          p.pouchLostThisRound = true;
          deathParts.push(`${pCode(p.id)}: -/${cardCode(rem)}`);
        }
      }
      s.logs = addLog(s.logs, `Death destroyed 1 face-down card from every unprotected Bag!`, 'danger', deathParts.join(', ') || 'all -/B', { appendEffect: true });
    } else if (id === 14) { // Temperance: cancel Suit Actions this trick
      s.roundMods.cancelSuitActions = true;
      s.logs = addLog(s.logs, `Temperance silenced Suit Actions for the rest of this trick.`, 'chaos', 'noSuit', { appendEffect: true });
    } else if (id === 15) { // Devil: every opp discards 1 or loses 1 Pouch
      const devilParts = [];
      for (const o of others) {
        if (s.roundMods.globalImmunity) continue;
        if (o.hand.length > 1 && !o.mods.handImmune) {
          if (o.isHuman) {
            const queens = o.hand.filter(c => c.rank === 13);
            if (queens.length > 0 && !actor.isHuman) {
              s.pendingInteraction = { type: 'INTERRUPT', source: 'chaos_discard', attackType: 'wand', attackerId: playerId, card: majorCard, blockCards: queens, blockCard: queens[0], discardCount: 1, reason: 'The Devil Chaos forces you to discard 1 card.' };
            } else {
              s.pendingInteraction = { type: 'CHOOSE_DISCARD', count: 1, destination: 'grave', selectedUids: [], reason: 'The Devil Chaos — choose 1 Hand card to discard.' };
            }
          } else {
            const dIdx = pickDiscardCardIdx(o.hand, o.seq);
            const dc = o.hand.splice(dIdx, 1)[0];
            s.grave.unshift(dc);
            o.lostCardThisRound = true;
            devilParts.push(`${pCode(o.id)}: -${cardCode(dc)}`);
          }
        } else if (o.pouch.length > 0 && !o.mods.pouchImmune) {
          const rem = o.pouch.pop();
          s.grave.unshift(rem);
          o.pouchLostThisRound = true;
          devilParts.push(`${pCode(o.id)}: -/${cardCode(rem)}`);
        }
      }
      s.logs = addLog(s.logs, `The Devil forced every opponent to sacrifice a card!`, 'danger', devilParts.join(', ') || null, { appendEffect: true });
    } else if (id === 16) { // Tower: destroy Trump, replace with top card in Grave
      const oldTrump = s.trumpCard;
      if (s.grave.length > 0) {
        s.trumpCard = s.grave.shift();
        if (oldTrump) s.grave.unshift(oldTrump);
      }
      s.roundMods.trumpChanged = true;
      s.logs = addLog(s.logs, `The Tower shattered the Trump Card! New Trump: ${cardShortName(s.trumpCard)}.`, 'chaos', `(T=${cardCode(s.trumpCard)})`);
    } else if (id === 17) { // Star: inspect opp Pouch + draw 1
      const r = drawCardsFromDeck(s, 1);
      s.deck = r.deck; s.grave = r.grave;
      actor.hand.push(...r.drawn);
      const starParts = r.drawn.map(c => '+' + cardCode(c));
      if (target && target.pouch.length > 0) starParts.push(`${pCode(target.id)}: /V(${target.pouch.map(cardCode).join(',')})`);
      s.logs = addLog(s.logs, `The Star drew ${r.drawn.map(cardShortName).join(', ') || 'nothing'}${target && target.pouch.length ? ' and revealed ' + target.name + "'s Pouch" : ''}.`, 'gold', starParts.join(', '), { appendEffect: true });
    } else if (id === 18) { // Moon: shuffle all Pouches together
      const pool = [];
      const counts = s.players.map(p => {
        if (p.mods.pouchImmune) return 0;
        const cnt = p.pouch.length;
        pool.push(...p.pouch);
        p.pouch = [];
        return cnt;
      });
      const mixed = shuffle(pool);
      const moonParts = [];
      s.players.forEach((p, idx) => {
        if (counts[idx] > 0) {
          p.pouch = mixed.splice(0, counts[idx]);
          moonParts.push(`${pCode(p.id)}: /~(${p.pouch.map(cardCode).join(',')})`);
        }
      });
      s.logs = addLog(s.logs, `The Moon scrambled every unprotected Pouch across the table!`, 'chaos', moonParts.join(', ') || '/~', { appendEffect: true });
    } else if (id === 19) { // Sun: draw 1 + tuck 1 extra to Pouch
      const r = drawCardsFromDeck(s, 1);
      s.deck = r.deck; s.grave = r.grave;
      actor.hand.push(...r.drawn);
      const sunParts = r.drawn.map(c => '+' + cardCode(c));
      if (actor.pouch.length < 3 && actor.hand.length > 0) {
        const tucked = actor.hand.pop();
        actor.pouch.push(tucked);
        sunParts.push('+/' + cardCode(tucked));
      }
      s.logs = addLog(s.logs, `The Sun blessed ${actor.name} with +1 Draw and an extra Pouch tuck!`, 'chaos', sunParts.join(', '), { appendEffect: true });
    } else if (id === 20) { // Judgement: every opp returns 1 Pouch card to Hand
      const judgeParts = [];
      for (const o of others) {
        if (o.pouch.length > 0 && !o.mods.pouchImmune) {
          const rem = o.pouch.pop();
          o.hand.push(rem);
          judgeParts.push(`${pCode(o.id)}: -/${cardCode(rem)}>+${cardCode(rem)}`);
        }
      }
      s.logs = addLog(s.logs, `Judgement returned 1 Bag card to every opponent's Hand!`, 'chaos', judgeParts.join(', ') || 'opps -/B>+H', { appendEffect: true });
    } else if (id === 21) { // World: +3 trick boost
      actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 3;
      s.logs = addLog(s.logs, `The World granted ${actor.name} +3 trick dominance!`, 'chaos', '+3', { appendEffect: true });
    }

    // Acting triggers for Chaos Event resolution
    if (actor.pathwayId === 2 && (actor.seq === 5 || actor.seq === 4 || actor.seq === 1)) {
      s.logs = markActed(actor, s.logs, 'Resolved a Major Arcana Chaos Event');
    }
    if (actor.pathwayId === 12 && actor.seq === 1) {
      s.logs = markActed(actor, s.logs, 'Resolved a Major Arcana Chaos Event');
    }

    // Grave Recycle Rule: take Major Arcana + top X cards of Grave -> bottom of Deck
    const recycleCount = actor.mods.skipRecycle ? 0 : id;
    const recycled = s.grave.splice(0, Math.min(recycleCount, s.grave.length));
    // Spirit Guide (Death Seq 6) bonus check
    for (const p of s.players) {
      if (p.pathwayId === 13 && p.seq === 6 && recycled.length > 0) {
        p.hand.push(recycled.shift());
        s.logs = markActed(p, s.logs, 'Harvested a card during Major Arcana Grave Recycle');
      }
    }
    s.deck.push(majorCard, ...recycled);
    const recAll = [majorCard, ...recycled].map(cardCode).join(',');
    s.logs = addLog(s.logs, `Recycled ${majorCard.roman}. ${majorCard.name} + ${recycled.length} Grave card(s) to bottom of Deck.`, 'muted', `g^>k_${boardState(recAll)}`, { appendEffect: true });

    return s;
  }

  // Resolve a Sequence Ability (1/turn) for any of the 22 Pathways × 9 Sequences
  function executeSequenceAbility(state, playerId, targetOppId = null, overrideTag = null, copyDepth = 0, opts = {}) {
    let s = {
      ...state,
      players: state.players.map(p => ({ ...p, hand: [...p.hand], pouch: [...p.pouch], mods: { ...p.mods } })),
      deck: [...state.deck],
      grave: [...state.grave],
      roundMods: { ...state.roundMods }
    };
    const actor = s.players[playerId];
    if (!overrideTag && (actor.abilityUsed || actor.seq === 0)) return s;

    const pathway = PATHWAYS[actor.pathwayId];
    const seqData = pathway.seqs[actor.seq];
    if (!overrideTag && !seqData) return s;

    if (!overrideTag) {
      const isRecast = !!actor.actingDone && !actor._recastPrepaid;
      if (actor._recastPrepaid) actor._recastPrepaid = false;
      if (isRecast) {
        if (actor.hand.length === 0) {
          if (actor.isHuman) sfx.error();
          s.logs = addLog(s.logs, `${actor.name} needs 1 Hand card to pay the Sanity Recast cost!`, 'danger');
          return s;
        }
        const paidIdx = actor.isHuman ? actor.hand.length - 1 : pickDiscardCardIdx(actor.hand, actor.seq);
        const paid = actor.hand.splice(paidIdx, 1)[0];
        s.grave.unshift(paid);
        s.logs = addLog(s.logs, `SANITY COST: ${actor.name} discarded ${cardShortName(paid)} to recast Seq ${actor.seq} ${seqData.name}.`, 'muted', `${pCode(playerId)}: -${cardCode(paid)} (sanity)`);
      }
      actor.abilityUsed = true;
      actor.abilityCastsThisSeq = (actor.abilityCastsThisSeq || 0) + 1;
      if (actor.isHuman) sfx.cardPlay();
    }

    const others = s.players.filter(p => p.id !== playerId && !p.skippedThisRound);
    const target = (targetOppId !== null && s.players[targetOppId] && !s.players[targetOppId].skippedThisRound) ? s.players[targetOppId] : (others[0] || null);
    const tag = overrideTag || seqData.tag;

    const isTargetedAb = TARGETED_ABILITY_TAGS.has(tag);
    if (!overrideTag) {
      const isCopy = tag === 'copy_ability' && target;
      let abCode = abilityCastCode(actor, target, { copy: isCopy, targeted: !isCopy && isTargetedAb });
      if (opts.asInstant) {
        // Interrupt form: ![#2: z3q9] or ![#2: z0q7=z8q8]
        const inner = abCode.replace(/^#\d+:\s*/, '');
        abCode = instantCastCode(actor, inner);
      }
      const abLabel = isCopy
        ? `${actor.name} copies ${target.name}'s Seq ${target.seq} ${PATHWAYS[target.pathwayId]?.seqs[target.seq]?.name || ''}!`
        : `ABILITY: ${actor.name} uses Seq ${actor.seq} ${seqData.name}${opts.asInstant ? ' (Interrupt)' : ''}!`;
      s.logs = addLog(s.logs, abLabel, 'gold', abCode);
    }

    const drawFor = (p, n) => {
      const r = drawCardsFromDeck(s, n);
      s.deck = r.deck; s.grave = r.grave;
      p.hand.push(...r.drawn);
      return r.drawn;
    };

    const selfDiscard = (p, count = 1, reason = '') => {
      if (!p || p.hand.length === 0) return [];
      const actual = Math.min(count, p.hand.length);
      if (p.isHuman) {
        s.pendingInteraction = {
          type: 'CHOOSE_DISCARD',
          count: actual,
          destination: 'grave',
          selectedUids: [],
          appendEffect: true,
          effectPrefix: '#1: ',
          reason: reason || `Choose ${actual} Hand card(s) to discard for ${seqData.name}.`
        };
        p.lostCardThisRound = true;
        return [];
      }
      const dropped = [];
      for (let i = 0; i < actual && p.hand.length > 0; i++) {
        const dIdx = pickDiscardCardIdx(p.hand, p.seq);
        const dc = p.hand.splice(dIdx, 1)[0];
        s.grave.unshift(dc);
        dropped.push(dc);
      }
      if (dropped.length > 0) {
        p.lostCardThisRound = true;
        s.logs = addLog(s.logs, `${p.name} discarded ${dropped.map(cardShortName).join(', ')} for ${seqData.name}.`, 'muted', `${pCode(p.id)}: ${dropped.map(c => '-' + cardCode(c)).join(',')}`, { appendEffect: true });
      }
      return dropped;
    };

    const forceDiscard = (victim, count = 1, isRandom = false) => {
      if (!victim || victim.mods.handImmune || s.roundMods.globalImmunity) return 0;
      if (victim.isHuman && !isRandom) {
        const maxAllowed = victim.mods.sunFloor ? Math.max(0, victim.hand.length - 3) : victim.hand.length;
        const actual = Math.min(count, maxAllowed);
        if (actual > 0) {
          s.pendingInteraction = { type: 'CHOOSE_DISCARD', count: actual, destination: 'grave', selectedUids: [], appendEffect: true, effectPrefix: '#1: ', reason: `${actor.name}'s ability forces you to discard ${actual} card(s).` };
          victim.lostCardThisRound = true;
          return actual;
        }
        if (victim.hand.length === 0) {
          victim.skipNextTurn = true;
          s.logs = addLog(s.logs, `${victim.name} has 0 cards and loses their next turn!`, 'danger', `${pCode(victim.id)}: MB()`, { appendEffect: true });
        }
        return 0;
      }
      let dropped = 0;
      const droppedCards = [];
      for (let i = 0; i < count; i++) {
        if (victim.mods.sunFloor && victim.hand.length <= 3) break;
        if (victim.hand.length === 0) {
          victim.skipNextTurn = true;
          s.logs = addLog(s.logs, `${victim.name} has 0 cards and loses their next turn!`, 'danger', `${pCode(victim.id)}: MB()`, { appendEffect: true });
          break;
        }
        const idx = isRandom ? Math.floor(Math.random() * victim.hand.length) : pickDiscardCardIdx(victim.hand, victim.seq);
        const dc = victim.hand.splice(idx, 1)[0];
        s.grave.unshift(dc);
        droppedCards.push(dc);
        victim.lostCardThisRound = true;
        dropped++;
      }
      if (droppedCards.length > 0) {
        s.logs = addLog(s.logs, `${victim.name} discarded ${droppedCards.map(cardShortName).join(', ')}.`, 'danger', `${pCode(victim.id)}: ${droppedCards.map(c => '-' + cardCode(c)).join(',')}`, { appendEffect: true });
      }
      return dropped;
    };

    const destroyPouch = (victim, count = 1, ignoreTraps = false) => {
      if (!victim || victim.mods.pouchImmune || s.roundMods.globalImmunity) return 0;
      let hits = 0;
      for (let i = 0; i < count && victim.pouch.length > 0; i++) {
        const idx = Math.floor(Math.random() * victim.pouch.length);
        const card = victim.pouch[idx];
        if (!ignoreTraps && (card.rank === 11 || victim.mods.despairTraps)) {
          victim.pouch.splice(idx, 1);
          s.grave.unshift(card);
          if (actor.pouch.length > 0) victim.hand.push(actor.pouch.pop());
          else if (actor.hand.length > 0) victim.hand.push(actor.hand.pop());
          s.logs = addLog(s.logs, `TRAP! ${victim.name}'s ${cardShortName(card)} stole a card from ${actor.name}!`, 'danger');
          if (victim.pathwayId === 3 && victim.seq === 4) s.logs = markActed(victim, s.logs, 'Triggered a Page Trap');
          if (victim.pathwayId === 0 && victim.seq === 4) s.logs = markActed(victim, s.logs, 'Triggered a Bizarro Trap');
          continue;
        }
        victim.pouch.splice(idx, 1);
        s.grave.unshift(card);
        victim.pouchLostThisRound = true;
        hits++;
      }
      return hits;
    };

    // Execute by tag
    const _tvBeforeActor = {
      tb: actor.mods.trickBonus || 0,
      wcb: actor.mods.wandCupBonus || 0,
      sb: actor.mods.sunBoost || 0,
      jb: !!actor.mods.jackpotBoost
    };
    const _tvBeforeOpps = others.map(o => ({
      id: o.id,
      tp: o.mods.trickPenalty || 0,
      ntp: o.mods.nonTrumpPenalty || 0
    }));

    switch (tag) {
      case 'peek_deck_2': {
        if (s.deck.length >= 2) {
          if (actor.isHuman) {
            s.pendingInteraction = {
              type: 'DECK_REORDER',
              title: 'Seer Divination — Reorder Top 2 Deck Cards',
              cards: s.deck.slice(0, 2),
              count: 2
            };
            s.logs = addLog(s.logs, `Seer peeks at the top 2 cards of the Deck...`, 'info');
          } else {
            const beforeCodes = s.deck.slice(0, 2).map(cardCode).join(',');
            const top2 = s.deck.splice(0, 2);
            top2.sort((a, b) => (b.rank || 10) - (a.rank || 10));
            s.deck = [...top2, ...s.deck];
            const afterCodes = top2.map(cardCode).join(',');
            const code = beforeCodes !== afterCodes
              ? `k^${boardState(`${beforeCodes}>${afterCodes}`)}`
              : `k^: V(${afterCodes})`;
            s.logs = addLog(s.logs, `Seer reordered top 2 Deck cards to: ${top2.map(cardShortName).join(', ')}.`, 'info', code, { appendEffect: true });
          }
        }
        break;
      }
      case 'clown_shield': {
        // Paper Figurine: optional Sword interrupt (Hand↔Bag swap), like Knight — not auto-immune
        actor.mods.clownFigurine = true;
        break;
      }
      case 'pouch_immune_draw': {
        actor.mods.pouchImmune = true;
        drawFor(actor, 1);
        break;
      }
      case 'illusion_boost': {
        actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 3;
        actor.mods.countsAsTrump = true;
        break;
      }
      case 'copy_ability': {
        if (target) {
          const oppSeq = PATHWAYS[target.pathwayId].seqs[target.seq];
          if (actor.pathwayId === 6 && actor.seq === 5) target.abilityUsed = true;
          s.logs = markActed(actor, s.logs, `Copied ${oppSeq?.name}`);
          if (oppSeq && oppSeq.tag !== 'copy_ability' && copyDepth < 1) {
            const activeOpps = s.players.filter(o => o.id !== playerId && !o.skippedThisRound);
            if (actor.isHuman && TARGETED_ABILITY_TAGS.has(oppSeq.tag) && activeOpps.length > 1) {
              s.pendingInteraction = { type: 'TARGET_COPIED_ABILITY', copiedTag: oppSeq.tag, copiedName: oppSeq.name };
              return s;
            }
            return executeSequenceAbility(s, playerId, target.id, oppSeq.tag, copyDepth + 1);
          } else {
            actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 1;
          }
        }
        break;
      }
      case 'marionette': {
        if (target) {
          forceDiscard(target, 1);
          target.mods.trickPenalty = (target.mods.trickPenalty || 0) + 2;
          s.logs = markActed(actor, s.logs, `Controlled ${target.name} as a Marionette`);
        }
        break;
      }
      case 'grave_to_pouch_trap': {
        if (s.grave.length > 0 && actor.pouch.length < 4) {
          actor.pouch.push(s.grave.shift());
          actor.mods.despairTraps = true;
        }
        break;
      }
      case 'scholar_proj': {
        const idx = s.grave.findIndex(c => c.type === 'minor');
        if (idx !== -1) actor.hand.push(s.grave.splice(idx, 1)[0]);
        actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 2;
        break;
      }
      case 'swap_trump_deck': {
        const r = drawCardsFromDeck(s, 1);
        s.deck = r.deck; s.grave = r.grave;
        if (r.drawn[0]) {
          if (s.trumpCard) s.deck.push(s.trumpCard);
          s.trumpCard = r.drawn[0];
          s.roundMods.trumpChanged = true;
          s.logs = addLog(s.logs, `New Trump Card: ${cardShortName(s.trumpCard)}!`, 'gold', `(T=${cardCode(s.trumpCard)})`);
        }
        break;
      }
      case 'grafting': {
        drawFor(actor, 2);
        actor.mods.handImmune = true;
        actor.mods.pouchImmune = true;
        break;
      }
      case 'swap_hand_trump': {
        const minors = actor.hand.filter(c => c.type === 'minor');
        if (minors.length > 0 && s.trumpCard) {
          if (actor.isHuman) {
            s.pendingInteraction = {
              type: 'HAND_SWAP_TRUMP',
              title: 'Apprentice (Door Opening) — Choose a Hand Card to Swap with Trump',
              cards: minors,
              markAct: true
            };
          } else {
            const m = minors[0];
            actor.hand = actor.hand.filter(c => c.uid !== m.uid);
            actor.hand.push(s.trumpCard);
            s.trumpCard = m;
            s.roundMods.trumpChanged = true;
            s.logs = markActed(actor, s.logs, 'Swapped with the Trump Card');
          }
        }
        break;
      }
      case 'cycle_2_1': {
        const drawn = drawFor(actor, 2);
        if (drawn.length > 0) s.logs = addLog(s.logs, `${actor.name} drew ${drawn.map(cardShortName).join(', ')}.`, 'emerald', drawn.map(c => '+' + cardCode(c)).join(','), { appendEffect: true });
        selfDiscard(actor, 1, `${seqData.name}: Choose 1 Hand card to discard.`);
        if (actor.pathwayId === 1 || actor.pathwayId === 12 || actor.pathwayId === 5) {
          s.logs = markActed(actor, s.logs, 'Cycled cards via ability');
        }
        break;
      }
      case 'astrologer': {
        if (actor.isHuman && s.deck.length >= 1) {
          s.pendingInteraction = {
            type: 'DECK_TOP_OR_BOTTOM',
            title: 'Astrologer — Keep on Top or Send to Bottom?',
            card: s.deck[0]
          };
          s.logs = markActed(actor, s.logs, 'Divined the Deck');
        } else {
          drawFor(actor, 1);
          s.logs = markActed(actor, s.logs, 'Divined the Deck');
        }
        break;
      }
      case 'scribe_grave': {
        const topG = s.grave.find(c => c.type === 'minor');
        if (topG) {
          if (topG.suit === 'pentacles') drawFor(actor, 1);
          else if (topG.suit === 'cups' && s.grave.length > 0) actor.hand.push(s.grave.shift());
          else if (topG.suit === 'wands' && target) forceDiscard(target, 1);
          else if (topG.suit === 'swords' && target) destroyPouch(target, 1);
          s.logs = markActed(actor, s.logs, `Copied ${SUIT_META[topG.suit].name} action from Grave`);
        } else {
          drawFor(actor, 1);
        }
        break;
      }
      case 'blink_immune': {
        actor.mods.handImmune = true;
        actor.mods.pouchImmune = true;
        drawFor(actor, 1);
        break;
      }
      case 'swap_trump_grave': {
        const idx = s.grave.findIndex(c => c.type === 'minor');
        if (idx !== -1 && s.trumpCard) {
          const gCard = s.grave.splice(idx, 1)[0];
          s.grave.unshift(s.trumpCard);
          s.trumpCard = gCard;
          s.roundMods.trumpChanged = true;
          s.logs = addLog(s.logs, `Wanderer swapped Trump to ${cardShortName(gCard)}!`, 'gold', `(T=${cardCode(gCard)})`);
        }
        break;
      }
      case 'grave_best_to_hand': {
        const minors = s.grave.filter(c => c.type === 'minor').sort((a, b) => b.rank - a.rank);
        if (minors[0]) {
          s.grave = s.grave.filter(c => c.uid !== minors[0].uid);
          actor.hand.push(minors[0]);
          s.logs = markActed(actor, s.logs, `Replicated ${cardShortName(minors[0])} from Grave`);
        }
        break;
      }
      case 'spatial_lock': {
        s.roundMods.spatialLock = true;
        s.logs = addLog(s.logs, `Spatial Lock / Punishment active: Knights, Queens & 10-overrides disabled this round!`, 'gold');
        if (actor.pathwayId === 20 && actor.seq === 5) s.logs = markActed(actor, s.logs, 'Enforced Punishment');
        break;
      }
      case 'mystery_pryer_swap': {
        if (s.deck.length > 0 && s.grave.length > 0) {
          const topD = s.deck[0], botG = s.grave[s.grave.length - 1];
          const usefulG = botG.type === 'minor' && (botG.rank === 10 || botG.rank <= actor.seq);
          const usefulD = topD.type === 'minor' && (topD.rank === 10 || topD.rank <= actor.seq);
          if (usefulG && !usefulD) {
            s.deck[0] = botG;
            s.grave[s.grave.length - 1] = topD;
            s.logs = addLog(s.logs, `Mystery Pryer swapped Deck top (${cardShortName(topD)}) with Grave bottom (${cardShortName(botG)})!`, 'info', `k^${cardCode(topD)}↔g_${cardCode(botG)}`, { appendEffect: true });
          } else {
            s.logs = addLog(s.logs, `Mystery Pryer peeked at Deck top (${cardShortName(topD)}) and kept it.`, 'info', `k^: V(${cardCode(topD)})`, { appendEffect: true });
          }
        }
        s.logs = markActed(actor, s.logs, 'Peeked at hidden Deck/Grave card');
        break;
      }
      case 'grave_peek_take': {
        const top3 = s.grave.slice(0, 3);
        if (actor.isHuman && top3.length > 0) {
          s.pendingInteraction = {
            type: 'GRAVE_PICK',
            title: 'Choose 1 Card from Top 3 of the Grave',
            cards: top3
          };
        } else if (top3.length > 0) {
          actor.hand.push(s.grave.shift());
          s.logs = markActed(actor, s.logs, 'Retrieved a card from the Grave');
        } else {
          drawFor(actor, 1);
        }
        break;
      }
      case 'wand_cup_boost': {
        actor.mods.wandCupBonus = 2;
        break;
      }
      case 'warlock_cast': {
        const drawn = drawFor(actor, 1);
        if (drawn.length > 0) s.logs = addLog(s.logs, `Warlock drew ${drawn.map(cardShortName).join(', ')}.`, 'emerald', drawn.map(c => '+' + cardCode(c)).join(','), { appendEffect: true });
        selfDiscard(actor, 1, 'Warlock: Choose 1 Hand card to discard.');
        if (target) destroyPouch(target, 1);
        s.logs = markActed(actor, s.logs, 'Cast dual Warlock spells');
        break;
      }
      case 'scroll_charge': {
        drawFor(actor, 1);
        actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 1;
        s.logs = markActed(actor, s.logs, 'Activated Spell Scroll');
        break;
      }
      case 'find_major': {
        const idx = s.deck.slice(0, 4).findIndex(c => c.type === 'major');
        if (idx !== -1) {
          actor.hand.push(s.deck.splice(idx, 1)[0]);
          s.logs = markActed(actor, s.logs, 'Drew a Major Arcana from the Stars');
        } else {
          drawFor(actor, 1);
        }
        break;
      }
      case 'mystic_fairytale': {
        actor.mods.skipRecycle = true;
        drawFor(actor, 1);
        break;
      }
      case 'clairvoyant': {
        actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 2;
        actor.mods.peekedOpp = true;
        if (actor.isHuman && target && target.hand[0]) {
          s.logs = addLog(s.logs, `Clairvoyant reveals ${target.name} holds ${cardShortName(target.hand[0])}.`, 'info', `${pCode(target.id)}: V(${cardCode(target.hand[0])})`, { appendEffect: true });
        }
        break;
      }
      case 'hand_swap_opp': {
        if (actor.hand.length > 0 && target && target.hand.length > 0) {
          const aIdx = Math.floor(Math.random() * actor.hand.length);
          const tIdx = Math.floor(Math.random() * target.hand.length);
          const tmp = actor.hand[aIdx];
          actor.hand[aIdx] = target.hand[tIdx];
          target.hand[tIdx] = tmp;
          s.logs = markActed(actor, s.logs, `Swapped a Hand card with ${target.name}`);
        }
        break;
      }
      case 'grave_major_to_hand': {
        const idx = s.grave.findIndex(c => c.type === 'major');
        if (idx !== -1) {
          const maj = s.grave.splice(idx, 1)[0];
          actor.hand.push(maj);
          s.logs = addLog(s.logs, `${actor.name} pulled ${cardShortName(maj)} from the Grave!`, 'chaos', `+${cardCode(maj)}g`, { appendEffect: true });
        } else {
          const drawn = drawFor(actor, 2);
          if (drawn.length > 0) s.logs = addLog(s.logs, `No Major Arcana in Grave — ${actor.name} drew ${drawn.map(cardShortName).join(', ')}.`, 'emerald', drawn.map(c => '+' + cardCode(c)).join(','), { appendEffect: true });
        }
        selfDiscard(actor, 1, `${seqData.name}: Choose 1 Hand card to discard.`);
        break;
      }
      case 'assassin_ambush': {
        actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 2;
        actor.mods.assassinSwordDraw = true;
        break;
      }
      case 'instigator_redirect': {
        actor.mods.redirectNext = true;
        break;
      }
      case 'witch_burn': {
        if (target) {
          if (destroyPouch(target, 1) > 0) {
            drawFor(actor, 1);
            s.logs = markActed(actor, s.logs, 'Burned an opponent Pouch card & drew 1');
          }
        }
        break;
      }
      case 'pleasure_gift': {
        if (target && target.hand.length > 0) {
          const giveIdx = pickDiscardCardIdx(target.hand, target.seq);
          const gifted = target.hand.splice(giveIdx, 1)[0];
          actor.hand.push(gifted);
          s.logs = addLog(s.logs, `PLEASURE! ${target.name} gave ${cardShortName(gifted)} to ${actor.name}.`, 'emerald');
          s.logs = markActed(actor, s.logs, `Charmed ${target.name}`);
        }
        break;
      }
      case 'plague_aoe': {
        let total = 0;
        for (const o of others) if (o.hand.length >= 3) total += forceDiscard(o, 1);
        if (total > 0 && s.grave.length > 0) {
          const taken = s.grave.shift();
          actor.hand.push(taken);
          s.logs = addLog(s.logs, `Plague claimed ${cardShortName(taken)} into ${actor.name}'s Hand!`, 'emerald');
        }
        s.logs = markActed(actor, s.logs, 'Unleashed Plague');
        break;
      }
      case 'despair_traps': {
        actor.mods.despairTraps = true;
        if (actor.pouch.length >= 2) s.logs = markActed(actor, s.logs, 'Filled Pouch with 2+ Mirror Traps');
        break;
      }
      case 'pouch_swap_grave': {
        if (actor.pouch.length > 0 && s.grave.length > 0) {
          const pCard = actor.pouch.pop();
          actor.pouch.push(s.grave.shift());
          s.grave.unshift(pCard);
          s.logs = markActed(actor, s.logs, 'Refreshed Pouch via Grave');
        }
        break;
      }
      case 'catastrophe_aoe': {
        let victims = 0;
        for (const o of others) {
          if (o.pouch.length > 0) { if (destroyPouch(o, 1) > 0) victims++; }
          else if (forceDiscard(o, 2) > 0) victims++;
        }
        if (victims >= 1) s.logs = markActed(actor, s.logs, 'Unleashed Catastrophe');
        break;
      }
      case 'apocalypse_mode': {
        s.roundMods.apocalypse = true;
        s.roundMods.spatialLock = true;
        break;
      }
      case 'math_plus_minus_1': {
        actor.mods.mathLeeway = Math.max(actor.mods.mathLeeway || 0, 1);
        actor.mods.lawyerKeepOne = true;
        break;
      }
      case 'math_plus_minus_2': {
        actor.mods.mathLeeway = Math.max(actor.mods.mathLeeway || 0, 2);
        drawFor(actor, 1);
        if (actor.pathwayId === 12 || actor.pathwayId === 21) s.logs = markActed(actor, s.logs, 'Altered Ascension Math');
        break;
      }
      case 'unblockable_next': {
        actor.mods.unblockable = true;
        break;
      }
      case 'bribe_opp': {
        if (actor.hand.length > 0 && target) {
          target.hand.push(actor.hand.pop());
          actor.mods.handImmune = true;
          actor.mods.pouchImmune = true;
          drawFor(actor, 2);
          s.logs = markActed(actor, s.logs, `Bribed ${target.name} (+2 Draw)`);
        }
        break;
      }
      case 'invert_trick': {
        s.roundMods.invertTrick = true;
        actor.mods.baronPouch = true;
        s.logs = addLog(s.logs, `Baron of Corruption inverted trick rankings & will claim a trick card into Pouch!`, 'gold', 'inv', { appendEffect: true });
        break;
      }
      case 'disorder_pass': {
        const passed = others.map(o => (o.hand.length > 0 ? o.hand.pop() : null));
        others.forEach((o, idx) => {
          const dest = s.players[(o.id + 1) % s.players.length];
          if (passed[idx] && dest) dest.hand.push(passed[idx]);
        });
        s.logs = markActed(actor, s.logs, 'Triggered Disorder (opponents passed 1 card left)');
        break;
      }
      case 'double_suit': {
        actor.mods.doubleSuit = true;
        break;
      }
      case 'weaken_opp': {
        if (target) target.mods.trickPenalty = (target.mods.trickPenalty || 0) + 3;
        actor.mods.weakenedOpp = true;
        break;
      }
      case 'draw_2': {
        drawFor(actor, 2);
        s.logs = markActed(actor, s.logs, 'Drew bonus cards');
        break;
      }
      case 'abolish_trump': {
        s.roundMods.abolishTrump = true;
        if (actor.pathwayId === 20) drawFor(actor, 1);
        s.logs = addLog(s.logs, `Trump Suit and 10-overrides abolished for this trick!`, 'gold', 'noT', { appendEffect: true });
        break;
      }
      case 'trick_plus_1': {
        actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 1;
        if (actor.pathwayId === 5 && actor.seq === 9) actor.mods.sailorLeadDraw = true;
        break;
      }
      case 'trick_plus_2': {
        actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 2;
        break;
      }
      case 'fury_boost': {
        selfDiscard(actor, 1, `${seqData.name}: Choose 1 Hand card to discard for +3 Trick Value.`);
        actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 3;
        actor.mods.folkWinDraw = true;
        break;
      }
      case 'siren_song': {
        let hits = 0;
        for (const o of others) if (o.hand.length > actor.hand.length) hits += forceDiscard(o, 1);
        if (hits > 0) s.logs = markActed(actor, s.logs, 'Drained rival Hands');
        break;
      }
      case 'tsunami_aoe': {
        let hits = 0;
        for (const o of others) { if (destroyPouch(o, 1) > 0) { hits++; drawFor(actor, 1); } }
        if (hits > 0) s.logs = markActed(actor, s.logs, `Smashed ${hits} Pouch(es) & drew ${hits}`);
        break;
      }
      case 'replace_trump_draw': {
        const r = drawCardsFromDeck(s, 1);
        s.deck = r.deck; s.grave = r.grave;
        if (r.drawn[0]) {
          if (s.trumpCard) s.grave.unshift(s.trumpCard);
          s.trumpCard = r.drawn[0];
          s.roundMods.trumpChanged = true;
        }
        drawFor(actor, 1);
        s.logs = markActed(actor, s.logs, 'Replaced the Trump Card');
        break;
      }
      case 'thunderclap': {
        for (const o of others) o.mods.nonTrumpPenalty = (o.mods.nonTrumpPenalty || 0) + 3;
        s.logs = addLog(s.logs, `Thunderclap! Opponents' non-Trump cards suffer -3 trick value (min 1)!`, 'gold');
        break;
      }
      case 'wrath_sea': {
        for (const o of others) forceDiscard(o, o.hand.length > 2 ? 2 : 1);
        break;
      }
      case 'pouch_swap_deck': {
        if (actor.pouch.length > 0) {
          const r = drawCardsFromDeck(s, 1);
          s.deck = r.deck; s.grave = r.grave;
          if (r.drawn[0]) {
            s.deck.push(actor.pouch.pop());
            actor.pouch.push(r.drawn[0]);
            s.logs = markActed(actor, s.logs, 'Swapped Pouch card with Deck');
          }
        }
        break;
      }
      case 'steal_pouch_safe': {
        if (target && target.pouch.length > 0 && !target.mods.pouchImmune) {
          const idx = Math.floor(Math.random() * target.pouch.length);
          const stolen = target.pouch.splice(idx, 1)[0];
          actor.hand.push(stolen);
          target.pouchLostThisRound = true;
          s.logs = addLog(s.logs, `${actor.name} stole ${cardShortName(stolen)} from ${target.name}'s Pouch!`, 'gold', `${pCode(target.id)}: -/${cardCode(stolen)}s`, { appendEffect: true });
          s.logs = markActed(actor, s.logs, `Stole a Pouch card from ${target.name}`);
        }
        break;
      }
      case 'swap_best_hand': {
        if (target && target.hand.length > 0 && actor.hand.length > 0) {
          target.hand.sort((a, b) => (b.rank || 10) - (a.rank || 10));
          actor.hand.sort((a, b) => (a.rank || 1) - (b.rank || 1));
          const stolen = target.hand.shift();
          const given = actor.hand.shift();
          actor.hand.push(stolen);
          target.hand.push(given);
          s.logs = addLog(s.logs, `${actor.name} swapped ${cardShortName(given)} for ${target.name}'s ${cardShortName(stolen)}!`, 'gold', `${pCode(target.id)}: -${cardCode(stolen)}s, +${cardCode(given)}`, { appendEffect: true });
        }
        break;
      }
      case 'hijack_trump': {
        if (s.trumpCard && actor.hand.length > 0) {
          const dropIdx = actor.isHuman ? actor.hand.length - 1 : pickDiscardCardIdx(actor.hand, actor.seq);
          const swapOut = actor.hand.splice(dropIdx, 1)[0];
          actor.hand.push(s.trumpCard);
          s.trumpCard = swapOut;
          s.logs = markActed(actor, s.logs, 'Swapped Hand card with center Trump Card');
        }
        break;
      }
      case 'steal_time': {
        if (target) {
          if (actor.isHuman) {
            s.pendingInteraction = { type: 'WORM_CHOICE', targetId: target.id };
          } else {
            if (target.seq <= actor.seq || target.hand.length <= 2) {
              target.skipNextTurn = true;
              s.logs = addLog(s.logs, `Worm of Time forced ${target.name} to skip their next turn!`, 'danger', `${pCode(target.id)}x`, { appendEffect: true });
            } else {
              forceDiscard(target, 1);
              s.logs = addLog(s.logs, `Worm of Time forced ${target.name} to discard 1 card!`, 'danger');
            }
            s.logs = markActed(actor, s.logs, 'Stole Time');
          }
        }
        break;
      }
      case 'hunter_track': {
        actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 1;
        if (actor.isHuman && target && target.pouch.length > 0) {
          s.logs = addLog(s.logs, `Hunter tracked ${target.name}'s Pouch: ${cardShortName(target.pouch[0])}`, 'info', `${pCode(target.id)}: /V(${cardCode(target.pouch[0])})`, { appendEffect: true });
        }
        break;
      }
      case 'taunt_discard': {
        if (target) forceDiscard(target, 1);
        actor.mods.handImmune = true;
        s.logs = markActed(actor, s.logs, 'Provoked an opponent');
        break;
      }
      case 'pyro_aoe': {
        selfDiscard(actor, 1, 'Pyromaniac: Choose 1 Hand card to discard to scorch 2 opponents.');
        let cnt = 0;
        for (const o of others.slice(0, 2)) if (forceDiscard(o, 1) > 0) cnt++;
        if (cnt >= 1) s.logs = markActed(actor, s.logs, 'Scorched opponents with Pyromaniac');
        break;
      }
      case 'conspirator_dual': {
        if (others[0]) destroyPouch(others[0], 1);
        if (others[1]) forceDiscard(others[1], 1);
        s.logs = markActed(actor, s.logs, 'Hit multiple opponents with Conspirator');
        break;
      }
      case 'reaper_strike': {
        if (target) {
          destroyPouch(target, 1);
          if (target.hand.length > 0) actor.hand.push(target.hand.pop());
          s.logs = markActed(actor, s.logs, 'Executed Fatal Strike');
        }
        break;
      }
      case 'face_can_win': {
        actor.mods.faceCanWin = true;
        actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 2;
        break;
      }
      case 'declare_war': {
        s.roundMods.warDeclared = true;
        s.logs = addLog(s.logs, `War Bishop declared WAR! Trick losers discard 1 Hand card!`, 'danger', 'WAR', { appendEffect: true });
        break;
      }
      case 'weather_swords': {
        s.roundMods.weatherSwords = true;
        actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 2;
        s.logs = addLog(s.logs, `Weather Warlock turned Trump Suit into SWORDS!`, 'gold', 'T=S', { appendEffect: true });
        break;
      }
      case 'conqueror_lock': {
        s.roundMods.spatialLock = true;
        if (target) {
          target.abilityUsed = true;
          forceDiscard(target, 1);
        }
        break;
      }
      case 'warrior_mastery': {
        actor.mods.warriorTakeWinner = true;
        s.logs = addLog(s.logs, `${actor.name} readied Combat Mastery (if trick lost, claims winning card)!`, 'info');
        break;
      }
      case 'dawn_paladin': {
        actor.mods.dawnPaladin = true;
        actor.mods.pouchImmune = true;
        s.logs = addLog(s.logs, `Armor of Light! Any Sword attacking ${actor.name}'s Pouch will enter it instead!`, 'emerald');
        break;
      }
      case 'counter_shield': {
        actor.mods.handImmune = true;
        actor.mods.pouchImmune = true;
        actor.mods.counterPunch = true;
        break;
      }
      case 'demon_hunter_strike': {
        if (target && destroyPouch(target, 1, true) > 0) {
          s.logs = markActed(actor, s.logs, 'Destroyed an opponent Pouch card');
        }
        break;
      }
      case 'grave_defense_pull': {
        const idx = s.grave.findIndex(c => c.rank === 12 || c.rank === 13);
        if (idx !== -1) actor.hand.push(s.grave.splice(idx, 1)[0]);
        else drawFor(actor, 2);
        break;
      }
      case 'glory_aura': {
        for (const o of others) o.mods.trickPenalty = (o.mods.trickPenalty || 0) + 2;
        break;
      }
      case 'hand_of_god': {
        if (target) destroyPouch(target, 1, true);
        actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 2;
        s.roundMods.forbidSuit = null;
        s.roundMods.forbidOwner = null;
        break;
      }
      case 'reader_scry': {
        if (s.deck.length > 0) {
          if (actor.isHuman) {
            s.pendingInteraction = { type: 'DECK_TOP_OR_BOTTOM', card: s.deck[0], title: 'Reader — Keep on Top or Send to Bottom' };
          } else if (s.deck.length > 1) {
            const top = s.deck[0];
            if (!(top.type === 'minor' && (top.rank === 10 || top.rank <= actor.seq))) s.deck.push(s.deck.shift());
          }
          s.logs = markActed(actor, s.logs, 'Used Reader Speed Read');
        }
        break;
      }
      case 'student_deduce': {
        const r = drawCardsFromDeck(s, 1);
        s.deck = r.deck; s.grave = r.grave;
        const topCard = r.drawn[0] || null;
        const oppIdx = (target && target.hand.length > 0) ? Math.floor(Math.random() * target.hand.length) : -1;
        const oppCard = oppIdx !== -1 ? target.hand.splice(oppIdx, 1)[0] : null;
        if (topCard && oppCard) {
          if (actor.isHuman) {
            s.pendingInteraction = { type: 'STUDENT_PICK', oppId: target.id, oppName: target.name, oppCard, topCard };
          } else {
            const val = (c) => c.type === 'major' ? 7 : (c.rank === 10 ? 22 : c.rank === actor.seq ? 20 : c.rank <= actor.seq ? 12 : c.rank);
            if (val(oppCard) >= val(topCard)) { actor.hand.push(oppCard); target.hand.push(topCard); }
            else { actor.hand.push(topCard); target.hand.push(oppCard); }
          }
          s.logs = markActed(actor, s.logs, 'Deduced & split cards with opponent');
        } else if (topCard) { actor.hand.push(topCard); s.logs = markActed(actor, s.logs, 'Deduced top Deck card'); }
        else if (oppCard) { actor.hand.push(oppCard); s.logs = markActed(actor, s.logs, 'Deduced opponent card'); }
        break;
      }
      case 'mysticism_cycle': {
        drawFor(actor, 2);
        if (actor.hand.length > 0) {
          const dropIdx = pickDiscardCardIdx(actor.hand, actor.seq);
          const putBack = actor.hand.splice(dropIdx, 1)[0];
          s.deck.push(putBack);
          s.logs = addLog(s.logs, `Spell Analysis drew 2 and placed ${cardShortName(putBack)} on the bottom of the Deck.`, 'info', `${cardCode(putBack)}>k_`, { appendEffect: true });
        }
        s.logs = markActed(actor, s.logs, 'Completed Spell Analysis');
        break;
      }
      case 'telepathist_reveal': {
        if (target && target.hand.length > 0) {
          const tSuit = getCardSuit(s.trumpCard);
          const pool = [...target.hand];
          const revealed = [];
          let matches = 0;
          for (let k = 0; k < Math.min(2, pool.length); k++) {
            const rIdx = Math.floor(Math.random() * pool.length);
            const rev = pool.splice(rIdx, 1)[0];
            revealed.push(rev);
            if (tSuit && getCardSuit(rev) === tSuit) matches++;
          }
          if (matches > 0) drawFor(actor, matches);
          if (actor.isHuman) s.logs = addLog(s.logs, `Read Mind revealed ${revealed.map(cardShortName).join(', ')} — drew ${matches} matching Trump Suit!`, 'info');
          s.logs = markActed(actor, s.logs, 'Read opponent mind');
        }
        break;
      }
      case 'draw_1_peek': {
        // Archaeologist Excavate: look at bottom 3 of Deck, draw 1 of them into Hand
        const n = Math.min(3, s.deck.length);
        if (n > 0) {
          const bottom = s.deck.splice(s.deck.length - n, n);
          if (actor.isHuman) {
            s.pendingInteraction = {
              type: 'CHOOSE_FROM_CARDS',
              title: 'Archaeologist Excavate — Choose 1 of the bottom 3 Deck cards',
              cards: bottom,
              destination: 'hand',
              remainderZone: 'deck_bottom',
              appendEffect: true
            };
            s.logs = addLog(s.logs, `Archaeologist excavates the bottom ${n} Deck cards...`, 'info', `k_: V(${bottom.map(cardCode).join(',')})`, { appendEffect: true });
          } else {
            bottom.sort((a, b) => (b.rank || 10) - (a.rank || 10));
            const pick = bottom.shift();
            actor.hand.push(pick);
            s.deck.push(...bottom);
            s.logs = addLog(
              s.logs,
              `Archaeologist excavated ${cardShortName(pick)} from the bottom of the Deck.`,
              'emerald',
              `k_: V(${[pick, ...bottom].map(cardCode).join(',')}), +${cardCode(pick)}`,
              { appendEffect: true }
            );
            s.logs = markActed(actor, s.logs, 'Excavated a card from the Deck');
          }
        } else {
          drawFor(actor, 1);
          s.logs = markActed(actor, s.logs, 'Analyzed & drew from Deck');
        }
        break;
      }
      case 'deduce_reveal': {
        drawFor(actor, 1);
        if (actor.isHuman && target && target.hand.length > 0) {
          s.logs = addLog(s.logs, `Revealed ${target.name}'s Hand: ${target.hand.slice(0, 3).map(cardShortName).join(', ')}`, 'info', `${pCode(target.id)}: V(${target.hand.slice(0, 3).map(cardCode).join(',')})`, { appendEffect: true });
        }
        s.logs = markActed(actor, s.logs, 'Revealed opponent Hand cards');
        break;
      }
      case 'prophet_foresight': {
        actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 2;
        if (actor.isHuman && s.deck[0]) s.logs = addLog(s.logs, `Prophet foresees: ${cardShortName(s.deck[0])}`, 'info', `k^: V(${cardCode(s.deck[0])})`, { appendEffect: true });
        break;
      }
      case 'steal_trump_hand': {
        if (target && target.hand.length > 0) {
          const tSuit = getCardSuit(s.trumpCard);
          let idx = tSuit ? target.hand.findIndex(c => getCardSuit(c) === tSuit) : -1;
          const stoleTrump = idx !== -1;
          if (idx === -1) idx = 0;
          actor.hand.push(target.hand.splice(idx, 1)[0]);
          if (stoleTrump || actor.pathwayId !== 9) s.logs = markActed(actor, s.logs, `Stole a ${stoleTrump ? 'Trump-suited ' : ''}card from ${target.name}'s Hand`);
        }
        break;
      }
      case 'author_coincidence': {
        drawFor(actor, 2);
        const maxPA = actor.mods.maxPouch || 3;
        if (!actor.isHuman && actor.pouch.length < maxPA && actor.hand.length > 2) {
          const tIdx = actor.hand.findIndex(c => c.type === 'minor' && (c.rank === 10 || c.rank <= actor.seq));
          if (tIdx !== -1) actor.pouch.push(actor.hand.splice(tIdx, 1)[0]);
        }
        if (actor.hand.length >= 5 || actor.pouch.length >= 3) s.logs = markActed(actor, s.logs, 'Wrote Coincidence (5+ Hand or 3 Pouch)');
        break;
      }
      case 'omniscient_eye': {
        drawFor(actor, 2);
        const maxPO = actor.mods.maxPouch || 3;
        if (actor.pouch.length < maxPO && actor.hand.length > 0) {
          actor.pouch.push(actor.hand.pop());
          actor.mods.addedDeckToPouch = true;
        }
        break;
      }
      case 'robot_pair': {
        const counts = {};
        for (const c of actor.hand) if (c.rank) counts[c.rank] = (counts[c.rank] || 0) + 1;
        const hasPair = Object.values(counts).some(v => v >= 2);
        drawFor(actor, hasPair ? 2 : 1);
        if (hasPair) s.logs = markActed(actor, s.logs, 'Revealed a matching Number Pair');
        break;
      }
      case 'lucky_two_suits': {
        actor.mods.luckyTwoSuits = true;
        drawFor(actor, 1);
        break;
      }
      case 'calamity_jinx': {
        if (target) {
          const r = drawCardsFromDeck(s, 1);
          s.deck = r.deck; s.grave = r.grave;
          if (r.drawn[0]) s.grave.unshift(r.drawn[0]);
          if (forceDiscard(target, 1) > 0) s.logs = markActed(actor, s.logs, 'Inflicted Bad Luck');
        }
        break;
      }
      case 'jackpot_boost': {
        actor.mods.jackpotBoost = true;
        break;
      }
      case 'jinx_cycle': {
        if (target && target.hand.length > 0) {
          forceDiscard(target, 1);
          drawFor(target, 1);
          s.logs = markActed(actor, s.logs, 'Disrupted opponent Hand');
        }
        break;
      }
      case 'soothsayer_flip': {
        const r = drawCardsFromDeck(s, 2);
        s.deck = r.deck; s.grave = r.grave;
        let kept = 0;
        for (const c of r.drawn) {
          if (c.rank && c.rank % 2 === 0) { actor.hand.push(c); kept++; }
          else s.grave.unshift(c);
        }
        if (kept === 0 && r.drawn[0]) { actor.hand.push(s.grave.shift()); kept = 1; }
        s.logs = markActed(actor, s.logs, 'Profited from blind Deck flip');
        break;
      }
      case 'reboot_trick': {
        for (const play of s.trickPlays) {
          s.players[play.playerId].hand.push(play.card);
        }
        s.trickPlays = [];
        s.trickTurnIdx = 0;
        drawFor(actor, 2);
        s.logs = addLog(s.logs, `Snake of Mercury REBOOTED the trick!`, 'chaos', 'reboot', { appendEffect: true });
        break;
      }
      case 'spectator_draw': {
        drawFor(actor, 1);
        break;
      }
      case 'frenzy_discard': {
        if (target && forceDiscard(target, 1) > 0) s.logs = markActed(actor, s.logs, 'Caused discard without Wand');
        break;
      }
      case 'hypnotist_steal': {
        if (target && target.hand.length >= 5) actor.hand.push(target.hand.pop());
        else drawFor(actor, 1);
        s.logs = markActed(actor, s.logs, 'Triggered Hypnotic Cue');
        break;
      }
      case 'pouch_swap_opp': {
        if (actor.pouch.length > 0 && target && target.pouch.length > 0 && !target.mods.pouchImmune) {
          const aC = actor.pouch.pop();
          const tC = target.pouch.pop();
          actor.pouch.push(tC);
          target.pouch.push(aC);
          s.logs = markActed(actor, s.logs, `Dreamwalked and swapped Pouch card with ${target.name}`);
        }
        break;
      }
      case 'manipulator_aoe': {
        const richest = [...others].sort((a, b) => b.hand.length - a.hand.length)[0];
        if (richest) forceDiscard(richest, 1);
        s.logs = markActed(actor, s.logs, 'Manipulated rival Hands');
        break;
      }
      case 'listener_grave': {
        const pulled = s.grave.length > 0 ? s.grave.shift() : null;
        if (pulled) {
          actor.hand.push(pulled);
          s.logs = addLog(s.logs, `Listener pulled ${cardShortName(pulled)} from the Grave.`, 'info', `+${cardCode(pulled)}g`, { appendEffect: true });
          s.logs = markActed(actor, s.logs, 'Pulled card from Grave after discarding');
        }
        selfDiscard(actor, 1, 'Listener: Choose 1 Hand card to discard.');
        break;
      }
      case 'shadow_sacrifice': {
        actor.mods.handImmune = true;
        actor.mods.pouchImmune = true;
        s.logs = addLog(s.logs, `Shadow Hide! ${actor.name}'s Hand & Pouch are immune this round.`, 'emerald', 'imm', { appendEffect: true });
        break;
      }
      case 'grave_to_pouch_sac': {
        if (s.grave.length > 0) {
          const c = s.grave.shift();
          if (actor.pouch.length < (actor.mods.maxPouch || 3)) actor.pouch.push(c);
          else actor.hand.push(c);
          s.logs = markActed(actor, s.logs, 'Moved top Grave card via Flesh & Blood');
        }
        break;
      }
      case 'dark_sub_4': {
        if (actor.hand.length >= 1) {
          selfDiscard(actor, 1, 'Dark Substitution: Choose 1 Hand card to discard for Pouch Wildcard.');
          actor.mods.darkSubBonus = true;
          s.logs = markActed(actor, s.logs, 'Performed Dark Substitution (Pouch Wildcard Ascension)');
        }
        break;
      }
      case 'blood_ritual': {
        selfDiscard(actor, 1, 'Blood Ritual: Choose 1 Hand card to discard so every opponent discards 1.');
        let cnt = 0;
        for (const o of others) cnt += forceDiscard(o, 1);
        if (cnt >= 1) s.logs = markActed(actor, s.logs, 'Forced opponents to discard via Blood Ritual');
        break;
      }
      case 'degenerate_10': {
        if (actor.pouch.length > 0) {
          s.grave.unshift(actor.pouch.pop());
          actor.mods.degenerateTen = true;
        }
        break;
      }
      case 'exhume_swap': {
        if (actor.hand.length > 0 && s.grave.length > 0) {
          const h = actor.hand.pop();
          actor.hand.push(s.grave.shift());
          s.grave.unshift(h);
          s.logs = markActed(actor, s.logs, 'Exhumed card from Grave');
        }
        break;
      }
      case 'grave_face_pull': {
        const idx = s.grave.findIndex(c => isFaceCard(c));
        if (idx !== -1) actor.hand.push(s.grave.splice(idx, 1)[0]);
        else if (s.grave.length > 0) actor.hand.push(s.grave.shift());
        else drawFor(actor, 1);
        s.logs = markActed(actor, s.logs, 'Pulled Face Card from Grave');
        break;
      }
      case 'soul_harvest': {
        if (s.grave.length > 0) actor.hand.push(s.grave.shift());
        if (s.grave.length >= 4) {
          drawFor(actor, 1);
          s.logs = markActed(actor, s.logs, 'Harvested souls from deep Grave');
        }
        break;
      }
      case 'grave_trump_pull': {
        const tSuit = getCardSuit(s.trumpCard);
        const idx = s.grave.findIndex(c => !tSuit || getCardSuit(c) === tSuit);
        if (idx !== -1) {
          actor.hand.push(s.grave.splice(idx, 1)[0]);
          s.logs = markActed(actor, s.logs, 'Opened Underworld Gate');
        } else drawFor(actor, 1);
        break;
      }
      case 'undying_revive': {
        for (let i = 0; i < 2 && s.grave.length > 0; i++) actor.hand.push(s.grave.shift());
        s.logs = markActed(actor, s.logs, 'Revived cards from Grave');
        break;
      }
      case 'ferryman_swap': {
        if (target && target.pouch.length > 0 && s.grave.length > 0 && !target.mods.pouchImmune) {
          const tCard = target.pouch.pop();
          target.pouch.push(s.grave.shift());
          s.grave.unshift(tCard);
          s.logs = markActed(actor, s.logs, `Swapped ${target.name}'s Pouch with Grave`);
        }
        break;
      }
      case 'pale_decree': {
        actor.mods.trickBonus = (actor.mods.trickBonus || 0) + Math.min(3, Math.floor(s.grave.length / 3) + 1);
        break;
      }
      case 'pale_emperor': {
        let added = 0;
        for (let i = 0; i < 2 && actor.pouch.length < 3; i++) {
          const idx = s.grave.findIndex(c => isNumberCard(c));
          if (idx !== -1) { actor.pouch.push(s.grave.splice(idx, 1)[0]); added++; }
        }
        if (added > 0) s.logs = markActed(actor, s.logs, 'Enslaved Grave cards into Pouch');
        break;
      }
      case 'prisoner_restraint': {
        if (actor.pouch.length > 0) actor.hand.push(actor.pouch.pop());
        drawFor(actor, 2);
        break;
      }
      case 'werewolf_blood': {
        actor.mods.trickBonus = (actor.mods.trickBonus || 0) + (actor.hand.length <= 4 ? 3 : 2);
        break;
      }
      case 'wraith_possess': {
        if (target) {
          target.mods.ascendLocked = true;
          forceDiscard(target, 1);
          s.logs = markActed(actor, s.logs, `Locked ${target.name}'s Ascension`);
        }
        break;
      }
      case 'puppet_curse': {
        if (actor.hand.length > 0 && target) {
          selfDiscard(actor, 1, 'Curse Doll: Choose 1 Hand card to discard.');
          destroyPouch(target, 1);
          forceDiscard(target, 1);
          s.logs = markActed(actor, s.logs, 'Triggered Puppet Curse');
        }
        break;
      }
      case 'silence_opp': {
        if (target) {
          target.abilityUsed = true;
          target.mods.silenced = true;
          drawFor(actor, 1);
        }
        break;
      }
      case 'ancient_bane': {
        for (const o of others) if (o.hand.length >= 5) forceDiscard(o, 1);
        actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 2;
        break;
      }
      case 'abomination_unchain': {
        actor.mods.maxPouch = 5;
        for (let i = 0; i < 2 && actor.hand.length > 0 && actor.pouch.length < 5; i++) {
          actor.pouch.push(actor.hand.pop());
        }
        if (actor.pouch.length >= 4) s.logs = markActed(actor, s.logs, 'Unchained Pouch to 4+ cards');
        break;
      }
      case 'criminal_discard': {
        if (target && target.hand.length > 0) {
          target.hand.sort((a, b) => (b.rank || 0) - (a.rank || 0));
          s.grave.unshift(target.hand.shift());
          s.logs = markActed(actor, s.logs, 'Forced Cold-Blooded discard');
        }
        break;
      }
      case 'serial_killer': {
        if (target) {
          const hits = destroyPouch(target, target.hand.length <= 4 ? 2 : 1);
          if (hits > 0 || target.hand.length <= 4) s.logs = markActed(actor, s.logs, 'Struck a vulnerable target');
        }
        break;
      }
      case 'devil_desire': {
        if (target) {
          if (target.hand.length > 0) actor.hand.push(target.hand.pop());
          else destroyPouch(target, 1);
          s.logs = markActed(actor, s.logs, 'Collected Desire tribute');
        }
        break;
      }
      case 'abyssal_filth': {
        let total = 0;
        for (const o of others) {
          if (o.hand.length > 5) total += forceDiscard(o, o.hand.length - 5);
        }
        if (total > 0) s.logs = markActed(actor, s.logs, 'Purged bloated Hands with Abyssal Filth');
        break;
      }
      case 'blatherer_2': {
        if (target) {
          forceDiscard(target, 2);
          if (target.hand.length <= 2 || target.skipNextTurn) s.logs = markActed(actor, s.logs, 'Broke opponent Hand');
        }
        break;
      }
      case 'massacre_aoe': {
        selfDiscard(actor, 1, 'Massacre: Choose 1 Hand card to discard.');
        let hits = 0;
        for (const o of others) if (o.hand.length <= 5) hits += destroyPouch(o, 1);
        if (hits > 0) s.logs = markActed(actor, s.logs, 'Massacred low-hand Pouches');
        break;
      }
      case 'filthy_monarch': {
        if (target) {
          forceDiscard(target, 2);
          if (target.hand.length <= 1 || target.skipNextTurn) {
            drawFor(actor, 2);
            if (actor.pouch.length < 3 && actor.hand.length > 0) actor.pouch.push(actor.hand.pop());
            s.logs = markActed(actor, s.logs, 'Corrupted opponent to mental break');
          }
        }
        break;
      }
      case 'savant_subtract': {
        actor.mods.savantSubtract = true;
        if (actor.pouch.length >= 2) s.logs = markActed(actor, s.logs, 'Prepared Savant Subtraction Math');
        break;
      }
      case 'appraiser_draw': {
        const hasFace = actor.hand.some(isFaceCard);
        drawFor(actor, hasFace ? 2 : 1);
        if (hasFace) s.logs = markActed(actor, s.logs, 'Appraised a Face Card');
        break;
      }
      case 'artisan_artifact': {
        actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 2;
        drawFor(actor, 1);
        s.logs = markActed(actor, s.logs, 'Forged an Artifact');
        break;
      }
      case 'astronomer_wild': {
        actor.mods.astronomerWild = true;
        if (actor.hand.some(c => c.rank === 1 || c.rank === 10) || actor.pouch.some(c => c.rank === 1)) {
          s.logs = markActed(actor, s.logs, 'Aligned 10s & Aces');
        }
        break;
      }
      case 'transmute_trump': {
        actor.mods.countsAsTrump = true;
        break;
      }
      case 'hand_ascend': {
        actor.mods.handAscend = true;
        break;
      }
      case 'night_owl': {
        drawFor(actor, 1);
        actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 1;
        s.logs = markActed(actor, s.logs, 'Acted as Night Owl');
        break;
      }
      case 'eternal_night': {
        for (const o of others) forceDiscard(o, 1);
        actor.mods.eternalNight = true;
        break;
      }
      case 'swap_own_pouch': {
        if (actor.pouch.length > 0 && actor.hand.length > 0) {
          const p = actor.pouch.pop();
          const h = actor.hand.pop();
          actor.pouch.push(h);
          actor.hand.push(p);
          s.logs = markActed(actor, s.logs, 'Swapped Hand & Pouch via Herbalism');
        }
        break;
      }
      case 'extra_pouch_add': {
        if (actor.pouch.length < 3 && actor.hand.length > 0) {
          actor.pouch.push(actor.hand.pop());
          s.logs = markActed(actor, s.logs, 'Brewed extra Pouch ingredient');
        }
        if (actor.pathwayId === 21) drawFor(actor, 1);
        break;
      }
      case 'cups_are_trump': {
        actor.mods.cupsAreTrump = true;
        break;
      }
      case 'life_giver': {
        drawFor(actor, actor.hand.length <= 3 ? 3 : 2);
        break;
      }
      case 'crimson_moon': {
        if (target && target.pouch.length > 0 && !target.mods.pouchImmune) {
          const stolen = target.pouch.pop();
          actor.hand.push(stolen);
          target.pouchLostThisRound = true;
          s.logs = addLog(s.logs, `${actor.name} stole ${cardShortName(stolen)} from ${target.name}'s Pouch (Crimson Moon)!`, 'gold', `${pCode(target.id)}: -/${cardCode(stolen)}s`, { appendEffect: true });
        }
        drawFor(actor, 1);
        break;
      }
      case 'bard_inspire': {
        drawFor(actor, 1);
        if (target) drawFor(target, 1);
        s.logs = markActed(actor, s.logs, 'Inspired self and opponent');
        break;
      }
      case 'flash_light': {
        const d = drawFor(actor, 1);
        if (d[0] && (d[0].suit === 'cups' || d[0].suit === 'pentacles')) {
          drawFor(actor, 1);
          s.logs = markActed(actor, s.logs, 'Revealed Cup/Pentacle with Flash of Light');
        }
        break;
      }
      case 'notary_pact': {
        if (actor.hand.length > 0 && target && target.hand.length > 0) {
          const tmp = actor.hand.pop();
          actor.hand.push(target.hand.pop());
          target.hand.push(tmp);
          drawFor(actor, 1);
          drawFor(target, 1);
          s.logs = markActed(actor, s.logs, 'Completed Notarized Pact');
        }
        break;
      }
      case 'sun_protect': {
        actor.mods.sunFloor = true;
        drawFor(actor, 1);
        break;
      }
      case 'radiant_law': {
        for (const p of s.players) drawFor(p, 1);
        s.logs = markActed(actor, s.logs, 'Enacted Radiant Law');
        break;
      }
      case 'sun_boost': {
        actor.mods.sunBoost = 3;
        break;
      }
      case 'white_angel': {
        drawFor(actor, 2);
        for (const o of others) o.mods = {};
        break;
      }
      case 'arbiter_auth': {
        actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 1;
        actor.mods.arbiterTrumpDraw = true;
        s.logs = addLog(s.logs, `Authority! +1 trick value (draw 1 if you play Trump Suit).`, 'gold');
        break;
      }
      case 'interrogator': {
        if (target) {
          const tSuit = getCardSuit(s.trumpCard);
          const hasTrump = tSuit && target.hand.some(c => getCardSuit(c) === tSuit);
          forceDiscard(target, hasTrump ? 2 : 1);
          s.logs = markActed(actor, s.logs, 'Interrogated opponent');
        }
        break;
      }
      case 'forbid_swords': {
        if (actor.isHuman) {
          s.pendingInteraction = {
            type: 'FORBID_SUIT',
            title: 'Judge Prohibition — Choose a Suit to Forbid This Trick'
          };
        } else {
          s.roundMods.forbidSuit = 'swords';
          s.roundMods.forbidOwner = playerId;
          s.logs = addLog(s.logs, `${actor.name} PROHIBITED Swords for this trick!`, 'gold', '!forbid(S)', { appendEffect: true });
          s.logs = markActed(actor, s.logs, 'Enforced Prohibition');
        }
        break;
      }
      case 'balancer_equalize': {
        for (const o of others) {
          const diff = Math.min(2, Math.max(0, o.hand.length - actor.hand.length));
          if (diff > 0) forceDiscard(o, diff);
        }
        break;
      }
      case 'supreme_verdict': {
        s.roundMods.abolishTrump = true;
        actor.mods.trickBonus = (actor.mods.trickBonus || 0) + 2;
        break;
      }
      case 'doctor_heal': {
        if (s.grave.length > 0) {
          actor.hand.push(s.grave.shift());
          s.logs = markActed(actor, s.logs, 'Recovered card from Grave');
        }
        actor.mods.handImmune = true;
        break;
      }
      case 'harvest_draw': {
        drawFor(actor, actor.pouch.length >= 3 ? 2 : 1);
        if (actor.pouch.length >= 3) s.logs = markActed(actor, s.logs, 'Harvested from full 3-card Pouch');
        break;
      }
      case 'grave_to_pouch_free': {
        const idx = s.grave.findIndex(c => c.type === 'minor');
        if (idx !== -1 && actor.pouch.length < 3) {
          actor.pouch.push(s.grave.splice(idx, 1)[0]);
          s.logs = markActed(actor, s.logs, 'Cycled Grave card into Pouch');
        }
        break;
      }
      case 'world_tree': {
        actor.mods.pouchImmune = true;
        actor.mods.mathLeeway = 2;
        break;
      }
      default: {
        drawFor(actor, 1);
        break;
      }
    }
    const _tvEffects = [];
    const _tbDiff = (actor.mods.trickBonus || 0) - _tvBeforeActor.tb;
    if (_tbDiff > 0) _tvEffects.push(`+${_tbDiff}`);
    const _wcbDiff = (actor.mods.wandCupBonus || 0) - _tvBeforeActor.wcb;
    if (_wcbDiff > 0) _tvEffects.push(`+${_wcbDiff} W/C`);
    const _sbDiff = (actor.mods.sunBoost || 0) - _tvBeforeActor.sb;
    if (_sbDiff > 0) _tvEffects.push(`+${_sbDiff} C/P`);
    if (actor.mods.jackpotBoost && !_tvBeforeActor.jb) _tvEffects.push('+4 Trump');
    for (const ob of _tvBeforeOpps) {
      const o = s.players[ob.id];
      if (!o) continue;
      const _tpDiff = (o.mods.trickPenalty || 0) - ob.tp;
      if (_tpDiff > 0) _tvEffects.push(`${pCode(o.id)}: -${_tpDiff}`);
      const _ntpDiff = (o.mods.nonTrumpPenalty || 0) - ob.ntp;
      if (_ntpDiff > 0) _tvEffects.push(`${pCode(o.id)}: -${_ntpDiff} non-T`);
    }
    if (_tvEffects.length > 0) {
      s.logs = addLog(s.logs, `Trick value modifier active: ${_tvEffects.join(', ')}.`, 'gold', _tvEffects.join(', '), { appendEffect: true });
    }

    return s;
  }

  // Play a Minor Arcana card into the trick + immediately resolve its Suit Action (with Interrupt support!)
  function playTrickCard(state, playerId, card, targetOppId = null, skipInterruptCheck = false) {
    let s = {
      ...state,
      players: state.players.map(p => ({ ...p, hand: [...p.hand], pouch: [...p.pouch], mods: { ...p.mods } })),
      deck: [...state.deck],
      grave: [...state.grave],
      trickPlays: [...state.trickPlays],
      roundMods: { ...state.roundMods }
    };
    const actor = s.players[playerId];
    if (!actor || !card) return state;
    const others = s.players.filter(p => p.id !== playerId && !p.skippedThisRound);
    let target = (targetOppId !== null && s.players[targetOppId] && !s.players[targetOppId].skippedThisRound) ? s.players[targetOppId] : (others[0] || null);

    // Major Arcana played directly into Trick: count as trick play (NOT instant), then resolve Chaos effects onto that play line
    if (card.type === 'major') {
      s.trickPlays.push({
        playerId,
        card,
        effValue: card.majorId,
        effSuit: 'major',
        isTenOverride: false,
        countsAsTrump: s.trumpCard?.type === 'major',
        faceCanWin: false,
        winsTies: !!actor.mods.winsTies,
        absorbed: true
      });
      s.logs = addLog(s.logs, `${actor.name} played Major Arcana ${card.roman}. ${card.name} (Value ${card.majorId}) into the Trick!`, 'chaos', `${pCode(playerId)}: ${cardCode(card)}`);
      s = resolveChaosEvent(s, playerId, card, target ? target.id : null, { asTrick: true });
      s.trickTurnIdx++;
      while (s.trickTurnIdx < s.trickOrder.length && s.players[s.trickOrder[s.trickTurnIdx]]?.skipNextTurn) s.trickTurnIdx++;
      if (s.trickTurnIdx >= s.trickOrder.length) {
        const winPlay = evaluateTrickWinner(s.trickPlays, s.trumpCard, s.roundMods);
        s.trickWinnerId = winPlay ? winPlay.playerId : 0;
        s.logs = addLog(s.logs, `TRICK WINNER: ${s.players[s.trickWinnerId]?.name || 'Player'} wins with ${winPlay ? cardShortName(winPlay.card) : 'the trick'}!`, 'gold');
        s.phase = 'TRICK_REWARD';
      }
      return s;
    }

    // Interrupt window: human may react with Knight/Queen (only when that face is legal),
    // Paper Figurine (sword + figurine charge), instant Major, or Seq ability
    const isAttackingHuman = !skipInterruptCheck && target && target.isHuman && !actor.isHuman && !s.roundMods.cancelSuitActions && !s.roundMods.globalImmunity && !actor.mods.unblockable && !s.roundMods.spatialLock && !s.roundMods.apocalypse;
    if (isAttackingHuman && (card.suit === 'swords' || card.suit === 'wands')) {
      const canFigurine = card.suit === 'swords' && !!target.mods.clownFigurine && target.pouch.length > 0 && target.hand.length > 0;
      const swordHit = card.suit === 'swords' && target.pouch.length > 0 && !target.mods.pouchImmune;
      const wandHit = card.suit === 'wands' && !target.mods.handImmune;
      if (swordHit || wandHit || canFigurine) {
        // Knight only on swords; Queen only on wands — never cross-offer
        const blockCards = target.hand.filter(c => card.suit === 'swords' ? c.rank === 12 : c.rank === 13);
        const instantMajors = target.hand.filter(c => c.type === 'major');
        const canAbility = !target.abilityUsed && target.seq > 0;
        if (blockCards.length > 0 || instantMajors.length > 0 || canAbility || canFigurine) {
          s.pendingInteraction = {
            type: 'INTERRUPT',
            source: 'trick',
            attackType: card.suit === 'swords' ? 'sword' : 'wand',
            attackerId: playerId,
            card,
            blockCards,
            blockCard: blockCards[0] || null,
            instantMajors,
            canAbility,
            canFigurine
          };
          return s;
        }
      }
    }

    // Remove card from actor's Hand
    actor.hand = actor.hand.filter(c => c.uid !== card.uid);
    if (actor.isHuman) sfx.cardPlay();

    // Judge Prohibition check (Swords forbidden)
    if (s.roundMods.forbidSuit && s.roundMods.forbidOwner !== playerId && card.suit === s.roundMods.forbidSuit) {
      const judge = s.players[s.roundMods.forbidOwner];
      if (judge && actor.hand.length > 0) {
        judge.hand.push(actor.hand.pop());
        s.logs = addLog(s.logs, `PROHIBITION! ${actor.name} played forbidden ${SUIT_META[card.suit].name} and paid 1 card to ${judge.name}!`, 'gold', `${pCode(actor.id)}>${pCode(judge.id)} (-1H)`);
      }
    }

    // Calculate effective trick value & suit
    let effValue = card.rank <= 10 ? card.rank : (actor.mods.faceCanWin ? 11 : 0);
    if (actor.mods.trickBonus && card.rank <= 9) effValue = Math.min(9, effValue + actor.mods.trickBonus);
    if (actor.mods.wandCupBonus && (card.suit === 'wands' || card.suit === 'cups') && card.rank <= 9) {
      effValue = Math.min(9, effValue + actor.mods.wandCupBonus);
    }
    if (actor.mods.sunBoost && (card.suit === 'cups' || card.suit === 'pentacles') && card.rank <= 9) {
      effValue = Math.min(9, effValue + actor.mods.sunBoost);
    }
    if (actor.mods.jackpotBoost && s.trumpCard && (getCardSuit(card) === getCardSuit(s.trumpCard) || (card.rank && card.rank === s.trumpCard.rank))) {
      effValue = Math.min(10, effValue + 4);
      s.logs = markActed(actor, s.logs, 'Hit Jackpot match with Trump');
    }
    const isLeadingPlay = s.trickPlays.length === 0;
    const isTrumpCardPlay = !!(s.trumpCard && getCardSuit(card) === getCardSuit(s.trumpCard) && !s.roundMods.abolishTrump && !s.roundMods.noTrumpChariot);
    if (actor.mods.nonTrumpPenalty && !isTrumpCardPlay && effValue > 1) {
      effValue = Math.max(1, effValue - actor.mods.nonTrumpPenalty);
    }
    if (actor.mods.trickPenalty && effValue > 1) {
      effValue = Math.max(1, effValue - actor.mods.trickPenalty);
    }
    if (actor.mods.sailorLeadDraw && isLeadingPlay) {
      const r = drawCardsFromDeck(s, 1);
      s.deck = r.deck; s.grave = r.grave;
      actor.hand.push(...r.drawn);
      s.logs = markActed(actor, s.logs, 'Led the trick with Sea Legs (+1 Draw)');
    }
    if (actor.mods.arbiterTrumpDraw && isTrumpCardPlay) {
      const r = drawCardsFromDeck(s, 1);
      s.deck = r.deck; s.grave = r.grave;
      actor.hand.push(...r.drawn);
      s.logs = markActed(actor, s.logs, 'Played Trump Suit under Authority (+1 Draw)');
    }

    const countsAsTrump = !!actor.mods.countsAsTrump || (!!actor.mods.cupsAreTrump && card.suit === 'cups');
    const isTenOverride = card.rank === 10 || !!actor.mods.degenerateTen;

    s.trickPlays.push({
      playerId,
      card,
      effValue,
      effSuit: card.suit,
      isTenOverride,
      countsAsTrump,
      faceCanWin: !!actor.mods.faceCanWin,
      winsTies: !!actor.mods.winsTies
    });

    const playEffects = [];
    const playDetails = [`${actor.name} played ${cardShortName(card)}`];
    let playTone = 'normal';
    const postInterruptLogs = [];

    // Immediate King + Suit Action Resolution (unless silenced/canceled)
    if (!s.roundMods.cancelSuitActions && !actor.mods.silenced) {
      const times = actor.mods.doubleSuit ? 2 : 1;
      if (actor.mods.doubleSuit) s.logs = markActed(actor, s.logs, 'Resolved a doubled Suit Action');

      // KING ACTION (also continues into Suit Action below!)
      if (card.rank === 14 && target) {
        const revealedBefore = [...target.hand];
        if (revealedBefore.length > 0) {
          playEffects.push(`${pCode(target.id)}: V(${revealedBefore.map(cardCode).join(',')})`);
        }
        const matchIdx = target.hand.findIndex(c => c.suit === card.suit);
        if (matchIdx !== -1) {
          const stolen = target.hand.splice(matchIdx, 1)[0];
          actor.hand.push(stolen);
          playEffects.push(`${pCode(target.id)}: -${cardCode(stolen)}s`);
          playDetails.push(`revealed ${target.name}'s Hand (${revealedBefore.map(cardShortName).join(', ')}) and stole ${cardShortName(stolen)}`);
          playTone = 'gold';
        } else {
          playDetails.push(`revealed ${target.name}'s Hand (${revealedBefore.length > 0 ? revealedBefore.map(cardShortName).join(', ') : 'empty'} — no ${SUIT_META[card.suit].name} found)`);
        }
        if (actor.pathwayId === 16 && actor.seq === 2) s.logs = markActed(actor, s.logs, 'Resolved King theft');
      }

      // INSTIGATOR REDIRECT (Empress Seq 8): bounce incoming Sword/Wand to another active opponent + draw 1!
      if ((card.suit === 'swords' || card.suit === 'wands') && target && target.mods.redirectNext && !s.roundMods.globalImmunity) {
        const instigator = target;
        instigator.mods.redirectNext = false;
        const rDraw = drawCardsFromDeck(s, 1);
        s.deck = rDraw.deck; s.grave = rDraw.grave;
        instigator.hand.push(...rDraw.drawn);
        const alt = s.players.find(o => o.id !== actor.id && o.id !== instigator.id && !o.skippedThisRound) || actor;
        playEffects.push(`${pCode(instigator.id)}: redirect>${pCode(alt.id)}${rDraw.drawn[0] ? ', +' + cardCode(rDraw.drawn[0]) : ''}`);
        playDetails.push(`INSTIGATOR! ${instigator.name} redirected the ${SUIT_META[card.suit].name} to ${alt.name} and drew ${rDraw.drawn.map(cardShortName).join(', ')}`);
        s.logs = markActed(instigator, s.logs, 'Redirected an attack with Instigator');
        target = alt;
      }

      // SUIT ACTION (always fires, including when playing a King!)
      if (card.suit === 'swords' && target && !s.roundMods.globalImmunity) {
        target.targetedThisRound = true;
        // AI interrupt: Knight, instant Major, or Seq ability (NN meta head 6 when available)
        let aiSwordInterrupted = false;
        if (!target.isHuman && !actor.mods.unblockable && !s.roundMods.spatialLock && !s.roundMods.apocalypse) {
          const knights = target.hand.filter(c => c.rank === 12);
          const majors = target.hand.filter(c => c.type === 'major');
          const canAbil = !target.abilityUsed && target.seq > 0;
          let wantInt = knights.length > 0;
          try {
            const intBrain = target.brain || aiBrainMode;
            if (isAscentBrain(intBrain)) {
              const net = makeAscentNet();
              if (net) wantInt = queryPolicyYesNo(net, s, target.id, 'meta_yesno');
            } else if (intBrain === 'nn_small' || intBrain === 'nn_medium' || intBrain === 'nn_large' || intBrain === 'nn_easy' || intBrain === 'nn_tabula' || intBrain === 'nn_hard') {
              const net = intBrain === 'nn_large' || intBrain === 'nn_hard' ? nnLargeRef.current
                : intBrain === 'nn_medium' || intBrain === 'nn_tabula' ? nnMediumRef.current
                  : nnSmallRef.current;
              if (net) wantInt = queryPolicyYesNo(net, s, target.id, 'meta_yesno');
            }
          } catch (_) { /* heuristic fallback */ }
          if (wantInt && (knights.length || majors.length || canAbil)) {
            if (knights.length) {
              const kn = knights[0];
              target.hand = target.hand.filter(c => c.uid !== kn.uid);
              sfx.shieldBlock();
              playEffects.push(`${instantCastCode(target, cardCode(kn))}`);
              playDetails.push(`${target.name} blocked Sword with ${cardShortName(kn)}`);
              playTone = 'emerald';
              postInterruptLogs.push(() => {
                applyInstantFaceSuitAction(s, target, actor, kn);
                s.grave.unshift(kn);
                if (target.pathwayId === 8 && (target.seq === 8 || target.seq === 7)) s.logs = markActed(target, s.logs, 'Blocked a Sword with Knight');
              });
              aiSwordInterrupted = true;
            } else {
              const prefer = majors.find(m => m.majorId === 14 || m.majorId === 8) || majors[0];
              if (prefer) {
                s = resolveChaosEvent(s, target.id, prefer, actor.id);
                playEffects.push(`${instantCastCode(target, cardCode(prefer))}`);
                playDetails.push(`${target.name} interrupted with instant ${cardShortName(prefer)}`);
                playTone = 'violet';
                aiSwordInterrupted = true;
                if (s.roundMods.cancelSuitActions || target.mods.pouchImmune) {
                  /* attack neutralized */
                }
              } else if (canAbil) {
                s = executeSequenceAbility(s, target.id, actor.id, null, 0, { asInstant: true });
                playDetails.push(`${target.name} interrupted with Seq ability`);
                playTone = 'gold';
                aiSwordInterrupted = true;
              }
            }
          }
        }
        if (aiSwordInterrupted) {
          /* suit attack cancelled / mitigated by interrupt */
        } else if (target.mods.dawnPaladin) {
          if (target.pouch.length < (target.mods.maxPouch || 3)) target.pouch.push(card);
          else target.hand.push(card);
          s.trickPlays[s.trickPlays.length - 1].absorbed = true;
          sfx.shieldBlock();
          playEffects.push(`${pCode(target.id)}: +/${cardCode(card)}`);
          playDetails.push(`Dawn Paladin absorbed ${cardShortName(card)} into ${target.name}'s Bag`);
          playTone = 'emerald';
          s.logs = markActed(target, s.logs, 'Absorbed attacking Sword');
        } else if (
          target.mods.clownFigurine &&
          !target.isHuman &&
          target.pouch.length > 0 &&
          target.hand.length > 0 &&
          // Prefer figurine when Bag has an ascension key or only 1–2 cards left
          (target.pouch.some(c => c.rank === target.seq || c.rank === 10) || target.pouch.length <= 2 || Math.random() < 0.55)
        ) {
          target.mods.clownFigurine = false;
          const pIdx = Math.floor(Math.random() * target.pouch.length);
          const hIdx = Math.floor(Math.random() * target.hand.length);
          const fromP = target.pouch[pIdx];
          const fromH = target.hand[hIdx];
          target.pouch[pIdx] = fromH;
          target.hand[hIdx] = fromP;
          sfx.shieldBlock();
          playEffects.push(`${pCode(target.id)}: /B↔H(${cardCode(fromP)}↔${cardCode(fromH)})`);
          playDetails.push(`Paper Figurine! ${target.name} swapped ${cardShortName(fromP)} (Bag) with ${cardShortName(fromH)} (Hand)`);
          playTone = 'emerald';
          if (target.pathwayId === 0 && target.seq === 8) s.logs = markActed(target, s.logs, 'Survived a Sword with Paper Figurine');
        } else if (!target.mods.pouchImmune) {
          const hits = (s.roundMods.apocalypse ? 2 : 1) * times;
          let destroyed = 0;
          const destroyedCards = [];
          for (let h = 0; h < hits && target.pouch.length > 0; h++) {
            const idx = Math.floor(Math.random() * target.pouch.length);
            const pCard = target.pouch[idx];
            if (pCard.rank === 11 || target.mods.despairTraps) {
              target.pouch.splice(idx, 1);
              s.grave.unshift(pCard);
              let stolenByTrap = null;
              let stolenFromPouch = false;
              if (actor.pouch.length > 0) { stolenByTrap = actor.pouch.pop(); target.hand.push(stolenByTrap); stolenFromPouch = true; }
              else if (actor.hand.length > 0) { stolenByTrap = actor.hand.pop(); target.hand.push(stolenByTrap); }
              sfx.swordHit();
              const stealTok = stolenByTrap ? `, ${stolenFromPouch ? '-/' : '-'}${cardCode(stolenByTrap)}s` : '';
              playEffects.push(`${pCode(target.id)}: -/${cardCode(pCard)}${stealTok}`);
              playDetails.push(`PAGE TRAP! ${target.name}'s ${cardShortName(pCard)} counter-stole ${stolenByTrap ? cardShortName(stolenByTrap) : 'a card'} from ${actor.name}`);
              playTone = 'danger';
              if (target.pathwayId === 0 && target.seq === 4) s.logs = markActed(target, s.logs, 'Triggered Page Trap');
              if (target.pathwayId === 3 && target.seq === 4) s.logs = markActed(target, s.logs, 'Triggered Page Trap');
            } else {
              target.pouch.splice(idx, 1);
              s.grave.unshift(pCard);
              destroyedCards.push(pCard);
              target.pouchLostThisRound = true;
              destroyed++;
              sfx.swordHit();
            }
          }
          if (destroyed > 0) {
            playEffects.push(`${pCode(target.id)}: ${destroyedCards.map(c => '-/' + cardCode(c)).join(',')}`);
            playDetails.push(`Sword destroyed ${destroyedCards.map(cardShortName).join(', ')} in ${target.name}'s Bag`);
            playTone = 'danger';
            if (actor.mods.assassinSwordDraw) {
              const r = drawCardsFromDeck(s, 1);
              s.deck = r.deck; s.grave = r.grave;
              actor.hand.push(...r.drawn);
              playEffects.push(r.drawn.map(c => '+' + cardCode(c)).join(','));
              playDetails.push(`Assassin drew ${r.drawn.map(cardShortName).join(', ')}`);
            }
            if ((actor.pathwayId === 7 && actor.seq === 9) || (actor.pathwayId === 3 && (actor.seq === 9 || actor.seq === 7 || actor.seq === 1)) || (actor.pathwayId === 5 && actor.seq === 4) || (actor.pathwayId === 8 && actor.seq === 7) || (actor.pathwayId === 4 && actor.seq === 8)) {
              s.logs = markActed(actor, s.logs, 'Destroyed an opponent Bag card');
            }
          }
        }
      } else if (card.suit === 'wands' && target && !s.roundMods.globalImmunity) {
        target.targetedThisRound = true;
        let aiWandInterrupted = false;
        if (!target.isHuman && !actor.mods.unblockable && !s.roundMods.spatialLock && !s.roundMods.apocalypse) {
          const queens = target.hand.filter(c => c.rank === 13);
          const majors = target.hand.filter(c => c.type === 'major');
          const canAbil = !target.abilityUsed && target.seq > 0;
          let wantInt = queens.length > 0;
          try {
            const intBrain = target.brain || aiBrainMode;
            if (isAscentBrain(intBrain)) {
              const net = makeAscentNet();
              if (net) wantInt = queryPolicyYesNo(net, s, target.id, 'meta_yesno');
            } else if (intBrain === 'nn_small' || intBrain === 'nn_medium' || intBrain === 'nn_easy' || intBrain === 'nn_tabula' || intBrain === 'nn_hard') {
              const net = intBrain === 'nn_large' || intBrain === 'nn_hard' ? nnLargeRef.current
                : intBrain === 'nn_medium' || intBrain === 'nn_tabula' ? nnMediumRef.current
                  : nnSmallRef.current;
              if (net) wantInt = queryPolicyYesNo(net, s, target.id, 'meta_yesno');
            }
          } catch (_) { /* heuristic fallback */ }
          if (wantInt && (queens.length || majors.length || canAbil)) {
            if (queens.length) {
              const qn = queens[0];
              target.hand = target.hand.filter(c => c.uid !== qn.uid);
              sfx.shieldBlock();
              playEffects.push(`${instantCastCode(target, cardCode(qn))}`);
              aiWandInterrupted = true;
              playDetails.push(`${target.name} blocked Wand with ${cardShortName(qn)}`);
              playTone = 'emerald';
              postInterruptLogs.push(() => {
                applyInstantFaceSuitAction(s, target, actor, qn);
                s.grave.unshift(qn);
                if (target.pathwayId === 8 && (target.seq === 8 || target.seq === 7)) s.logs = markActed(target, s.logs, 'Blocked a Wand with Queen');
              });
            } else {
              const prefer = majors.find(m => m.majorId === 14 || m.majorId === 8) || majors[0];
              if (prefer) {
                s = resolveChaosEvent(s, target.id, prefer, actor.id);
                playEffects.push(`${instantCastCode(target, cardCode(prefer))}`);
                playDetails.push(`${target.name} interrupted with instant ${cardShortName(prefer)}`);
                aiWandInterrupted = true;
              } else if (canAbil) {
                s = executeSequenceAbility(s, target.id, actor.id, null, 0, { asInstant: true });
                playDetails.push(`${target.name} interrupted with Seq ability`);
                aiWandInterrupted = true;
              }
            }
          }
        }
        if (aiWandInterrupted) {
          /* mitigated by interrupt */
        } else if (!target.mods.handImmune) {
          if (target.isHuman && !(target.mods.sunFloor && target.hand.length <= 3)) {
            const maxAllowed = target.mods.sunFloor ? Math.max(0, target.hand.length - 3) : target.hand.length;
            const actualDrop = Math.min(times, maxAllowed);
            if (actualDrop > 0) {
              s.pendingInteraction = { type: 'CHOOSE_DISCARD', count: actualDrop, destination: 'grave', selectedUids: [], appendEffect: true, effectPrefix: '#1: ', reason: `${actor.name} played ${cardShortName(card)}! Choose ${actualDrop} card(s) to discard.` };
              target.lostCardThisRound = true;
              playDetails.push(`Wand forces ${target.name} to choose ${actualDrop} card(s) to discard`);
              playTone = 'danger';
            } else if (target.hand.length === 0) {
              target.skipNextTurn = true;
              playEffects.push(`${pCode(target.id)}: MB()`);
              playDetails.push(`MENTAL BREAK! ${target.name} had 0 cards and loses next turn`);
              playTone = 'danger';
            }
          } else {
            const wandDropped = [];
            for (let h = 0; h < times; h++) {
              if (target.mods.sunFloor && target.hand.length <= 3) break;
              if (target.hand.length === 0) {
                target.skipNextTurn = true;
                playEffects.push(`${pCode(target.id)}: MB()`);
                playDetails.push(`MENTAL BREAK! ${target.name} had 0 cards and loses next turn`);
                if (actor.pathwayId === 7 && actor.seq === 1) s.logs = markActed(actor, s.logs, 'Forced opponent to lose a turn');
                break;
              }
              const idx = pickDiscardCardIdx(target.hand, target.seq);
              const dCard = target.hand.splice(idx, 1)[0];
              wandDropped.push(dCard);
              s.grave.unshift(dCard);
              target.lostCardThisRound = true;
            }
            if (wandDropped.length > 0) {
              playEffects.push(`${pCode(target.id)}: ${wandDropped.map(c => '-' + cardCode(c)).join(',')}`);
              playDetails.push(`Wand forced ${target.name} to discard ${wandDropped.map(cardShortName).join(', ')}`);
              playTone = 'danger';
            }
          }
          if ((actor.pathwayId === 15 && actor.seq === 9) || (actor.pathwayId === 3 && (actor.seq === 8 || actor.seq === 5)) || (actor.pathwayId === 4 && actor.seq === 8)) {
            s.logs = markActed(actor, s.logs, 'Forced an opponent to discard with a Wand');
          }
        }
      } else if (card.suit === 'pentacles') {
        const r = drawCardsFromDeck(s, times);
        s.deck = r.deck; s.grave = r.grave;
        actor.hand.push(...r.drawn);
        if (r.drawn.length > 0) {
          playEffects.push(r.drawn.map(c => '+' + cardCode(c)).join(','));
          playDetails.push(`Pentacle drew ${r.drawn.map(cardShortName).join(', ')}`);
          playTone = 'emerald';
        }
        if ((actor.pathwayId === 16 && actor.seq === 9) || (actor.pathwayId === 21 && actor.seq === 5) || (actor.pathwayId === 19 && (actor.seq === 8 || actor.seq === 7))) {
          s.logs = markActed(actor, s.logs, 'Played a Pentacle');
        }
      } else if (card.suit === 'cups') {
        const healedCards = [];
        for (let h = 0; h < times && s.grave.length > 0; h++) {
          const hc = s.grave.shift();
          actor.hand.push(hc);
          healedCards.push(hc);
        }
        if (healedCards.length > 0) {
          playEffects.push(healedCards.map(c => '+' + cardCode(c) + 'g').join(','));
          playDetails.push(`Cup pulled ${healedCards.map(cardShortName).join(', ')} from Grave`);
          playTone = 'info';
        }
        if ((actor.pathwayId === 18 && actor.seq === 8) || (actor.pathwayId === 21 && actor.seq === 8) || (actor.pathwayId === 13 && actor.seq === 9)) {
          s.logs = markActed(actor, s.logs, 'Played a Cup');
        }
      }
    }

    const baseTrickVal = card.rank <= 10 ? card.rank : 0;
    const tvDelta = (card.type === 'minor' && card.rank <= 10) ? (effValue - baseTrickVal) : 0;
    const tvTag = tvDelta !== 0 ? `(${tvDelta > 0 ? '+' : ''}${tvDelta}=${effValue})` : '';
    const unifiedCode = `${pCode(playerId)}: ${cardCode(card)}${tvTag}${playEffects.length > 0 ? ` (${playEffects.join(', ')})` : ''}`;
    s.logs = addLog(s.logs, playDetails.join(' — ') + '.', playTone, unifiedCode);
    for (const fn of postInterruptLogs) fn();

    // Play-based Acting checks
    if (actor.pathwayId === 4 && actor.seq === 9 && card.rank <= 6) s.logs = markActed(actor, s.logs, 'Played a card ≤ 6');
    if (actor.pathwayId === 8 && actor.seq === 9 && (card.suit === 'swords' || card.rank === 12)) s.logs = markActed(actor, s.logs, 'Played Sword/Knight');
    if (actor.pathwayId === 8 && actor.seq === 8 && card.rank <= 10 && card.rank >= 5) s.logs = markActed(actor, s.logs, 'Played a card ≥ 5');
    if (actor.pathwayId === 8 && actor.seq === 3 && isFaceCard(card)) s.logs = markActed(actor, s.logs, 'Played a Face Card');
    if (actor.pathwayId === 16 && actor.seq === 5 && (card.rank === 1 || card.rank === 10)) s.logs = markActed(actor, s.logs, 'Played a 10 or Ace');
    if (actor.pathwayId === 17 && actor.seq === 9 && s.trickPlays.length === s.players.length) s.logs = markActed(actor, s.logs, 'Played last in the trick');

    // Advance trick turn
    s.trickTurnIdx++;
    while (s.trickTurnIdx < s.trickOrder.length && s.players[s.trickOrder[s.trickTurnIdx]].skipNextTurn) {
      s.trickTurnIdx++;
    }

    if (s.trickTurnIdx >= s.trickOrder.length) {
      // Evaluate Trick Winner!
      const winPlay = evaluateTrickWinner(s.trickPlays, s.trumpCard, s.roundMods);
      s.trickWinnerId = winPlay ? winPlay.playerId : 0;
      const winner = s.players[s.trickWinnerId];
      s.logs = addLog(s.logs, `TRICK WINNER: ${winner.name} wins with ${winPlay ? cardShortName(winPlay.card) : 'the trick'}!`, 'gold');

      // War Bishop War penalty on trick losers
      if (s.roundMods.warDeclared) {
        const warDropped = [];
        for (const p of s.players) {
          if (p.id !== winner.id && p.hand.length > 0 && !p.mods.handImmune) {
            if (p.isHuman) {
              s.pendingInteraction = { type: 'CHOOSE_DISCARD', count: 1, destination: 'grave', selectedUids: [], appendEffect: true, effectPrefix: '#1: ', reason: 'War Penalty: You lost the trick — choose 1 Hand card to discard.' };
              p.lostCardThisRound = true;
            } else {
              const dIdx = pickDiscardCardIdx(p.hand, p.seq);
              const dc = p.hand.splice(dIdx, 1)[0];
              s.grave.unshift(dc);
              warDropped.push(`${pCode(p.id)}: -${cardCode(dc)}`);
              p.lostCardThisRound = true;
            }
          }
        }
        s.logs = addLog(s.logs, `WAR PENALTY: Trick losers discard 1 card!`, 'danger', warDropped.length > 0 ? `WAR(${warDropped.join(', ')})` : null);
      }

      // Eternal Night & Folk of Rage rewards
      if (winner.mods.eternalNight) {
        const r = drawCardsFromDeck(s, 2);
        s.deck = r.deck; s.grave = r.grave;
        winner.hand.push(...r.drawn);
      }
      if (winner.mods.folkWinDraw) {
        const r = drawCardsFromDeck(s, 1);
        s.deck = r.deck; s.grave = r.grave;
        winner.hand.push(...r.drawn);
        s.logs = addLog(s.logs, `FOLK OF RAGE! ${winner.name} won the trick and drew 1 card!`, 'emerald', `${pCode(winner.id)}: (${r.drawn.map(c => '+' + cardCode(c)).join(',')})`);
      }
      // Strength S9 Warrior: if you lose a trick, take the winning card into Hand!
      let winTaken = false;
      for (const pl of s.players) {
        if (pl.id !== winner.id && pl.mods.warriorTakeWinner && !winPlay.absorbed && !winTaken) {
          pl.hand.push(winPlay.card);
          winPlay.absorbed = true;
          winTaken = true;
          s.logs = addLog(s.logs, `WARRIOR! ${pl.name} lost the trick and claimed ${cardShortName(winPlay.card)} into Hand!`, 'emerald', `${pCode(pl.id)}: (+${cardCode(winPlay.card)})`);
        }
      }
      // Emperor S6 Baron of Corruption: take 1 played trick card into Pouch!
      for (const pl of s.players) {
        if (pl.mods.baronPouch && pl.pouch.length < (pl.mods.maxPouch || 3)) {
          const avail = s.trickPlays.filter(tp => !tp.absorbed);
          const pickTp = avail.find(tp => tp.card.type === 'minor' && (tp.card.rank === 10 || tp.card.rank <= pl.seq)) || avail[0];
          if (pickTp) {
            pl.pouch.push(pickTp.card);
            pickTp.absorbed = true;
            s.logs = addLog(s.logs, `BARON OF CORRUPTION! ${pl.name} tucked ${cardShortName(pickTp.card)} from the trick into Pouch!`, 'gold', `${pCode(pl.id)}: (+/${cardCode(pickTp.card)})`);
          }
        }
      }

      // Win-based Acting checks
      if (winner.pathwayId === 0 && (winner.seq === 7 || winner.seq === 3 || winner.seq === 2 || winner.seq === 1)) s.logs = markActed(winner, s.logs, 'Won the trick');
      if (winner.pathwayId === 1 && (winner.seq === 4 || winner.seq === 3 || winner.seq === 1)) s.logs = markActed(winner, s.logs, 'Won the trick');
      if (winner.pathwayId === 2 && winner.seq === 8 && (winPlay.card.suit === 'wands' || winPlay.card.suit === 'cups')) s.logs = markActed(winner, s.logs, 'Won trick with Wand/Cup');
      if (winner.pathwayId === 2 && winner.seq === 3) s.logs = markActed(winner, s.logs, 'Won trick after Clairvoyance');
      if (winner.pathwayId === 3 && (winner.seq === 9 || winner.seq === 1)) s.logs = markActed(winner, s.logs, 'Won the trick');
      if (winner.pathwayId === 6 && winner.seq === 3) s.logs = markActed(winner, s.logs, 'Won trick after Swap Fate');
      if (winner.pathwayId === 11 && winner.seq === 3) s.logs = markActed(winner, s.logs, 'Won trick after False Lead');
      if (winner.pathwayId === 12 && winner.seq === 2 && winner.mods.degenerateTen) s.logs = markActed(winner, s.logs, 'Won trick after Degenerate sacrifice');
      if (winner.pathwayId === 17 && winner.seq === 6) s.logs = markActed(winner, s.logs, 'Won trick with Soul Assurer');
      if (winner.pathwayId === 4 && winner.seq === 6 && winPlay.card.rank <= 4) s.logs = markActed(winner, s.logs, 'Won trick with card ≤ 4');
      if (winner.pathwayId === 4 && (winner.seq === 3 || winner.seq === 1)) s.logs = markActed(winner, s.logs, 'Won distorted trick');
      if (winner.pathwayId === 5 && (winner.seq === 9 || winner.seq === 8 || winner.seq === 6 || winner.seq === 2 || winner.seq === 1)) s.logs = markActed(winner, s.logs, 'Dominated the trick');
      if (winner.pathwayId === 7 && (winner.seq === 5 || winner.seq === 4 || winner.seq === 3 || winner.seq === 2)) s.logs = markActed(winner, s.logs, 'Won trick in Warfare');
      if (winner.pathwayId === 8 && (winner.seq === 2 || winner.seq === 1)) s.logs = markActed(winner, s.logs, 'Won trick with Twilight dominance');
      if (winner.pathwayId === 10 && (winner.seq === 7 || winner.seq === 1)) s.logs = markActed(winner, s.logs, 'Won the trick');
      if (winner.pathwayId === 14 && (winner.seq === 7 || winner.seq === 3 || winner.seq === 2)) s.logs = markActed(winner, s.logs, 'Won trick under Chained power');
      if (winner.pathwayId === 16 && (winner.seq === 4 || winner.seq === 1)) s.logs = markActed(winner, s.logs, 'Won trick with Alchemy');
      if (winner.pathwayId === 17 && (winner.seq === 4 || winner.seq === 2 || winner.seq === 1)) s.logs = markActed(winner, s.logs, 'Won concealed trick');
      if (winner.pathwayId === 18 && winner.seq === 5 && winPlay.card.suit === 'cups') s.logs = markActed(winner, s.logs, 'Won trick with a Cup');
      if (winner.pathwayId === 19 && (winner.seq === 2 || winner.seq === 1)) s.logs = markActed(winner, s.logs, 'Won trick with Solar power');
      if (winner.pathwayId === 20 && (winner.seq === 4 || winner.seq === 3 || winner.seq === 1)) s.logs = markActed(winner, s.logs, 'Won trick under Order');
      if (winner.pathwayId === 21 && (winner.seq === 6 || winner.seq === 1)) s.logs = markActed(winner, s.logs, 'Won trick with Mother power');

      s.phase = 'TRICK_REWARD';
    }

    return s;
  }

  // Trick Winner Reward: Option 1 (Take Trump) or Option 2 (Suit-Guess Gamble)
  function resolveTrickReward(state, choice, guessedSuits = []) {
    let s = {
      ...state,
      players: state.players.map(p => ({ ...p, hand: [...p.hand], pouch: [...p.pouch] })),
      deck: [...state.deck],
      grave: [...state.grave]
    };
    const winner = s.players[s.trickWinnerId];

    if (choice === 'take_trump') {
      if (s.trumpCard) {
        winner.hand.push(s.trumpCard);
        s.logs = addLog(s.logs, `${winner.name} claimed the Trump Card (${cardShortName(s.trumpCard)}).`, 'emerald', `T${s.round}& ${pCode(winner.id)}: ?0 (+${cardCode(s.trumpCard)})`);
        s.trumpCard = null;
      }
    } else if (choice === 'gamble') {
      const revealed = [];
      let foundMinor = null;
      while (s.deck.length > 0 && !foundMinor) {
        const top = s.deck.shift();
        revealed.push(top);
        if (top.type === 'minor') foundMinor = top;
      }
      const success = foundMinor && guessedSuits.includes(foundMinor.suit);
      if (success) {
        sfx.ascend();
        const claimedTrump = s.trumpCard;
        winner.hand.push(...revealed);
        if (claimedTrump) winner.hand.push(claimedTrump);
        s.trumpCard = null;
        const wonCodes = [...revealed, ...(claimedTrump ? [claimedTrump] : [])].map(c => '+' + cardCode(c)).join(',');
        s.logs = addLog(
          s.logs,
          `SEER GAMBLE WON! ${winner.name} guessed ${guessedSuits.map(x => SUIT_META[x].name).join('/')} and scooped ${revealed.length} revealed card(s) + Trump!`,
          'emerald',
          `T${s.round}& ${pCode(winner.id)}: ?${guessedSuits.map(suitCode).join('/')} (${wonCodes})`
        );
        if (winner.pathwayId === 0 && winner.seq === 9) s.logs = markActed(winner, s.logs, 'Won the Suit-Guess Gamble');
        if (winner.pathwayId === 9 && (winner.seq === 9 || winner.seq === 2)) s.logs = markActed(winner, s.logs, 'Won the Suit-Guess Gamble');
      } else {
        sfx.error();
        s.grave.unshift(...revealed);
        if (s.trumpCard) s.grave.unshift(s.trumpCard);
        s.trumpCard = null;
        s.logs = addLog(
          s.logs,
          `SEER GAMBLE MISSED! Revealed ${foundMinor ? cardShortName(foundMinor) : 'nothing'} — all cards sent to Grave.`,
          'danger',
          `T${s.round}& ${pCode(winner.id)}: ?${guessedSuits.map(suitCode).join('/')} ()`
        );
      }
    }

    // Move remaining played trick cards to Grave (skip cards claimed by Warrior/Baron/Paladin)
    for (const p of s.trickPlays) {
      if (!p.absorbed) s.grave.unshift(p.card);
    }
    s.trickPlays = [];

    // End-of-round Acting checks
    const maxHandLive = Math.max(...s.players.map(pl => pl.hand.length));
    for (const p of s.players) {
      if (!p.pouchLostThisRound && !p.lostCardThisRound) p.safeRoundsCount = (p.safeRoundsCount || 0) + 1;
      if (p.pathwayId === 0 && p.seq === 8 && !p.pouchLostThisRound) s.logs = markActed(p, s.logs, 'Survived round losing 0 Pouch cards');
      if (p.pathwayId === 3 && p.seq === 4 && p.pouch.length >= 2) s.logs = markActed(p, s.logs, 'Held 2+ Mirror Traps in Pouch');
      if (p.pathwayId === 8 && p.seq === 5 && p.safeRoundsCount >= 2) s.logs = markActed(p, s.logs, 'Ended 2 rounds without Hand/Pouch losses');
      if (p.pathwayId === 10 && (p.seq === 9 || p.seq === 8)) {
        const cnts = {};
        for (const c of p.hand) if (c.rank) cnts[c.rank] = (cnts[c.rank] || 0) + 1;
        if (Object.values(cnts).some(v => v >= 2)) s.logs = markActed(p, s.logs, 'Held a matching Number Pair');
      }
      if (p.pathwayId === 20 && p.seq === 2 && p.hand.length >= maxHandLive) s.logs = markActed(p, s.logs, 'Ended round with most Hand cards');
      if (p.pathwayId === 1 && p.seq === 5 && !p.pouchLostThisRound && !p.lostCardThisRound) s.logs = markActed(p, s.logs, 'Took 0 Hand/Pouch losses');
      if (p.pathwayId === 11 && p.seq === 9 && !p.targetedThisRound) s.logs = markActed(p, s.logs, 'Completed round untargeted');
      if (p.pathwayId === 12 && p.seq === 7 && !p.pouchLostThisRound && !p.lostCardThisRound) s.logs = markActed(p, s.logs, 'Ended round without Hand/Pouch losses');
      if (p.pathwayId === 11 && p.seq === 1 && (p.hand.length >= 5 || p.pouch.length >= 3)) s.logs = markActed(p, s.logs, 'Author Coincidence (5+ Hand or 3 Pouch)');
      if (p.pathwayId === 8 && p.seq === 6 && !p.pouchLostThisRound) s.logs = markActed(p, s.logs, 'Lost 0 Pouch cards');
      if (p.pathwayId === 14 && p.seq === 9 && p.pouch.length <= 1) s.logs = markActed(p, s.logs, 'Ended round with ≤1 Pouch card');
      if (p.pathwayId === 14 && p.seq === 6 && !p.pouchLostThisRound) s.logs = markActed(p, s.logs, 'Survived round losing 0 Pouch cards');
      if (p.pathwayId === 17 && p.seq === 5 && !p.pouchLostThisRound) s.logs = markActed(p, s.logs, 'Kept Pouch untouched');
      if (p.pathwayId === 18 && p.seq === 2 && p.hand.length >= 6) s.logs = markActed(p, s.logs, 'Ended round with 6+ Hand cards');
      if (p.pathwayId === 19 && p.seq === 5 && p.hand.length >= 4) s.logs = markActed(p, s.logs, 'Ended round with 4+ Hand cards');
      if (p.pathwayId === 21 && p.seq === 9 && !p.pouchLostThisRound && p.pouch.length > 0) s.logs = markActed(p, s.logs, 'Cultivated Pouch untouched');
    }

    s.phase = 'ASCEND';
    s.logs = addLog(s.logs, `Phase 3: Ascension Phase — spend Pouch ingredients to Ascend, or proceed to next round.`, 'info', `A${s.round}=`, { newPhase: true });

    // AI Ascension check (once per turn — ascendedThisRound enforced inside performAscension)
    for (const p of s.players) {
      if (!p.isHuman && !p.mods.ascendLocked && !p.ascendedThisRound && p.seq > 0) {
        const pool = p.mods.handAscend ? [...p.pouch, ...p.hand] : p.pouch;
        const subset = findValidAscensionSubset(pool, p.seq, p.mods);
        if (subset && (p.actingDone || p.hand.length >= 5 || p.seq <= 2)) {
          s = performAscension(s, p.id, subset.map(c => c.uid));
          if (s.winnerId !== null) return s;
        }
      }
    }
    return s;
  }

  function performAscension(state, playerId, cardUids) {
    let s = {
      ...state,
      players: state.players.map(p => ({ ...p, hand: [...p.hand], pouch: [...p.pouch], mods: { ...p.mods } })),
      deck: [...state.deck],
      grave: [...state.grave]
    };
    const p = s.players[playerId];
    // Rule: ascend only once per turn/round
    if (p.ascendedThisRound) {
      if (p.isHuman) sfx.error();
      s.logs = addLog(s.logs, `${p.name} already ascended this turn — only one Ascension per turn.`, 'danger');
      return s;
    }
    const pool = p.mods.handAscend ? [...p.pouch, ...p.hand] : p.pouch;
    const chosen = pool.filter(c => cardUids.includes(c.uid));
    const check = checkAscensionMath(chosen, p.seq, p.mods);
    if (!check.valid) return s;

    // Emperor S9 Lawyer: if ascending using ±1 leeway, keep 1 used ingredient card in Pouch!
    const exactCheck = checkAscensionMath(chosen, p.seq, { ...p.mods, mathLeeway: 0 });
    const usedLeeway = !exactCheck.valid && !!p.mods.lawyerKeepOne;
    const keepCard = usedLeeway && chosen.length > 0 ? chosen[0] : null;
    const spentCards = keepCard ? chosen.filter(c => c.uid !== keepCard.uid) : chosen;
    const spentSet = new Set(spentCards.map(c => c.uid));
    p.pouch = p.pouch.filter(c => !spentSet.has(c.uid));
    p.hand = p.hand.filter(c => !spentSet.has(c.uid));
    s.grave.unshift(...spentCards);
    if (keepCard) s.logs = addLog(s.logs, `LAWYER LOOPHOLE! ${p.name} kept ${cardShortName(keepCard)} in their Pouch!`, 'gold');

    const digested = p.actingDone;
    const oldSeq = p.seq;
    p.seq = oldSeq - 1;
    p.actingDone = false;
    p.safeRoundsCount = 0;
    p.ascendedThisRound = true;
    // Rule: sequence ability once per turn — do NOT refresh abilityUsed on ascend
    p.abilityCastsThisSeq = 0;

    sfx.ascend();

    if (p.seq === 0) {
      s.winnerId = p.id;
      s.logs = addLog(s.logs, `APOTHEOSIS! ${p.name} ascended to SEQUENCE 0 (${PATHWAYS[p.pathwayId].arcana}) and WON THE GAME!`, 'gold', `${pCode(p.id)}: @q0 (WIN)`);
      return s;
    }

    if (digested) {
      const r = drawCardsFromDeck(s, 1);
      s.deck = r.deck; s.grave = r.grave;
      p.hand.push(...r.drawn);
      const spentStr = formatSpentPouchCodes(spentCards, oldSeq, p.mods);
      const drawStr = r.drawn.map(c => '+' + cardCode(c)).join(',');
      s.logs = addLog(s.logs, `SAFE ASCENSION! ${p.name} digested Seq ${oldSeq} → Seq ${p.seq} (${PATHWAYS[p.pathwayId].seqs[p.seq].name}) and drew +1 card!`, 'emerald', `${pCode(p.id)}: @q${p.seq} (${spentStr}${drawStr ? ', ' + drawStr : ''})`);
    } else {
      if (p.isHuman && p.hand.length > 0) {
        const cnt = Math.min(3, p.hand.length);
        if (p.hand.length < 3) p.skipNextTurn = true;
        s.pendingInteraction = { type: 'CHOOSE_DISCARD', count: cnt, destination: 'grave', selectedUids: [], appendEffect: true, effectPrefix: '', reason: `Reckless (Undigested) Ascension to Seq ${p.seq} — choose ${cnt} Hand card(s) to discard.` };
        const spentStrH = formatSpentPouchCodes(spentCards, oldSeq, p.mods);
        s.logs = addLog(s.logs, `RECKLESS ASCENSION! ${p.name} advanced Undigested to Seq ${p.seq} — choose ${cnt} Hand card(s) to discard.`, 'danger', `${pCode(p.id)}: @q${p.seq}* (${spentStrH})`);
      } else {
        let dropped = 0;
        for (let i = 0; i < 3; i++) {
          if (p.hand.length === 0) {
            p.skipNextTurn = true;
            break;
          }
          const dIdx = p.isHuman ? p.hand.length - 1 : pickDiscardCardIdx(p.hand, p.seq);
          s.grave.unshift(p.hand.splice(dIdx, 1)[0]);
          dropped++;
        }
        const spentStrU = formatSpentPouchCodes(spentCards, oldSeq, p.mods);
        s.logs = addLog(
          s.logs,
          `RECKLESS ASCENSION! ${p.name} advanced Undigested to Seq ${p.seq} and lost ${dropped} Hand card(s)${p.skipNextTurn ? ' (LOSES NEXT TURN!)' : ''}!`,
          'danger',
          `${pCode(p.id)}: @q${p.seq}* (${spentStrU}, -${dropped}H)`
        );
      }
    }

    return s;
  }

  function advanceToNextRound(state) {
    const humanP = state.players[0];
    const humanCap = getHandLimit(humanP.seq, handLimitMode);
    if (humanP && humanP.isHuman && humanP.hand.length > humanCap) {
      const excess = humanP.hand.length - humanCap;
      return {
        ...state,
        pendingInteraction: {
          type: 'CHOOSE_DISCARD',
          count: excess,
          destination: 'grave',
          selectedUids: [],
          afterAction: 'NEXT_ROUND',
          reason: `End-of-Round Hand Limit (${humanCap}): choose ${excess} excess card(s) to discard.`
        }
      };
    }
    let grave = [...state.grave];
    let logs = [...state.logs];
    const nextPlayers = state.players.map(p => {
      const hand = [...p.hand];
      const cap = getHandLimit(p.seq, handLimitMode);
      let trimmed = 0;
      while (hand.length > cap) {
        grave.unshift(hand.pop());
        trimmed++;
      }
      if (trimmed > 0) {
        logs = addLog(logs, `HAND LIMIT (${cap}): ${p.name} discarded ${trimmed} excess card(s) to Grave.`, 'muted', `${pCode(p.id)}: (-${trimmed}H cap)`);
      }
      // If ended round with 0 cards (and wasn't already skipped), they lose next turn & draw 2
      const mentalBreak = !p.skippedThisRound && hand.length === 0;
      if (mentalBreak) {
        logs = addLog(logs, `${p.name} ended the round with 0 cards — loses next turn (draws 2)!`, 'danger');
      }
      return {
        ...p,
        hand,
        skipNextTurn: p.skippedThisRound ? false : (p.skipNextTurn || mentalBreak),
        skippedThisRound: false
      };
    });
    const s = {
      ...state,
      round: state.round + 1,
      dealerIdx: (state.dealerIdx + 1) % state.players.length,
      players: nextPlayers,
      grave,
      logs: addLog(logs, `--- Round ${state.round + 1} Begins ---`, 'info', `A${state.round}&`)
    };
    return beginRoundDraw(s);
  }

  // ============================================================================
  // 6. AI TURN AUTOMATION EFFECT
  // ============================================================================
  useEffect(() => {
    if (screen !== 'playing' || !game || game.winnerId !== null) return;
    if (game.pendingInteraction) return;

    // Draft Phase AI
    if (game.phase === 'DRAFT') {
      const currentDrafterId = game.draftOrder[game.draftTurnIdx];
      const drafter = game.players[currentDrafterId];
      if (!drafter) return;

      if (!drafter.isHuman) {
        aiTimerRef.current = setTimeout(() => {
          setGame(prev => {
            if (!prev || prev.phase !== 'DRAFT') return prev;
            const dId = prev.draftOrder[prev.draftTurnIdx];
            const p = prev.players[dId];
            if (!p || p.isHuman) return prev;
            let s = {
              ...prev,
              players: prev.players.map(x => ({ ...x, hand: [...x.hand] })),
              centerDraft: [...prev.centerDraft]
            };
            // Draft using per-seat brain (spectator) or global Opponent Brain
            const seatBrain = p.brain || aiBrainMode;
            let pick = s.centerDraft[0];
            if (seatBrain === 'nn_small' || seatBrain === 'nn_medium' || seatBrain === 'nn_easy' || seatBrain === 'nn_ascent' || seatBrain === 'nn_tabula' || seatBrain === 'nn_hard') {
              const net = seatBrain === 'nn_large' || seatBrain === 'nn_hard' || seatBrain === 'nn_ascent' ? nnLargeRef.current
                : seatBrain === 'nn_medium' || seatBrain === 'nn_tabula' ? nnMediumRef.current
                  : nnSmallRef.current;
              pick = selectCardLivePolicy(net, s, dId, s.centerDraft, 'draft') || s.centerDraft[0];
            } else {
              const hDepth = seatBrain.startsWith('heuristic_') ? (Number(seatBrain.split('_')[1]) || 6) : 5;
              let bestSc = -999;
              for (const c of s.centerDraft) {
                let sc = c.type === 'major' ? 9 : (c.rank <= 10 ? c.rank : 6);
                if (c.type === 'minor' && (c.rank <= p.seq || c.rank === 10)) {
                  if (hDepth >= 2 && findValidAscensionSubset([...p.pouch, c], p.seq, p.mods)) sc += 30;
                  if (hDepth >= 3 && (c.rank === p.seq || c.rank === 10)) sc += 24;
                  if (hDepth >= 6 && c.rank === 1 && !p.hand.some(h => h.rank === 1)) sc += 26;
                }
                if (sc > bestSc) { bestSc = sc; pick = c; }
              }
            }
            s.centerDraft = s.centerDraft.filter(c => c.uid !== pick.uid);
            s.players[dId].hand.push(pick);
            s.logs = addLog(s.logs, `${p.name} drafted ${cardShortName(pick)}.`, 'muted', `${pCode(dId)}: D+${cardCode(pick)}`);
            s.draftTurnIdx++;
            if (s.draftTurnIdx >= s.draftOrder.length) {
              return startTrickPhase(s);
            }
            return s;
          });
        }, 420);
      }
      return;
    }

    // Trick Phase AI
    if (game.phase === 'TRICK') {
      const activeId = game.trickOrder[game.trickTurnIdx];
      const active = game.players[activeId];
      if (!active) return;

      if (active.skipNextTurn) {
        aiTimerRef.current = setTimeout(() => {
          setGame(prev => {
            if (!prev || prev.phase !== 'TRICK') return prev;
            let s = { ...prev, trickTurnIdx: prev.trickTurnIdx + 1 };
            if (s.trickTurnIdx >= s.trickOrder.length) {
              const winPlay = evaluateTrickWinner(s.trickPlays, s.trumpCard, s.roundMods);
              s.trickWinnerId = winPlay ? winPlay.playerId : 0;
              s.phase = 'TRICK_REWARD';
            }
            return s;
          });
        }, 300);
        return;
      }

      if (!active.isHuman) {
        aiTimerRef.current = setTimeout(() => {
          setGame(prev => {
            if (!prev || prev.phase !== 'TRICK') return prev;
            const aId = prev.trickOrder[prev.trickTurnIdx];
            const p = prev.players[aId];
            if (!p || p.isHuman) return prev;
            let s = prev;

            const seatBrain = p.brain || aiBrainMode;
            let activeNet = null;
            try {
              if (seatBrain === 'nn_large' || seatBrain === 'nn_hard' || seatBrain === 'nn_ascent') activeNet = nnLargeRef.current;
              else if (seatBrain === 'nn_medium' || seatBrain === 'nn_tabula') activeNet = nnMediumRef.current;
              else if (seatBrain === 'nn_small' || seatBrain === 'nn_easy') activeNet = nnSmallRef.current;
            } catch (_) { activeNet = null; }
            const useTrainedNN = !!(activeNet && (isBrowserRLNet(activeNet) || isPolicyNet(activeNet)));
            const isAscentPolicy = useTrainedNN;
            const isCardPolicy = useTrainedNN;
            const hDepth = seatBrain.startsWith('heuristic_') ? (Number(seatBrain.split('_')[1]) || 6) : 5;
            const liveObs = () => null;
            const liveQuery = (headEasy, headHard) => {
              if (!activeNet || !(isBrowserRLNet(activeNet) || isPolicyNet(activeNet))) return false;
              try {
                return queryPolicyYesNo(activeNet, s, aId, 'meta_yesno');
              } catch (_) { return false; }
            };
            const pickTargetPolicy = (opps) => {
              if (!activeNet || !opps?.length) return opps?.[0] || null;
              if (isBrowserRLNet(activeNet)) {
                const items = opps.map((o, i) => ({ kind: 'play', card: null, targetId: o.id, targetRel: i }));
                const pick = activeNet.pickCandidate(s, aId, items, { training: false, exploreRate: 0 });
                return opps.find(o => o.id === pick?.targetId) || opps[0];
              }
              if (!isPolicyNet(activeNet)) return opps[0];
              try {
                const pick = policyPick(activeNet, s, aId, 'target', { opps }, activeNet.tier === 'medium' ? 'medium' : 'small');
                return pick?.opp || opps[0];
              } catch (_) { return opps[0]; }
            };

            // AI plays Major Arcana Chaos Event (only when holding >= 2 cards so AI still has a card to play!)
            const majorInHand = s.players[aId].hand.find(c => c.type === 'major');
            const wantChaos = majorInHand && s.players[aId].hand.length >= 2 && (useTrainedNN ? liveQuery(3, 1) : (s.players[aId].hand.length >= 3 && Math.random() < 0.4));
            if (wantChaos) {
              const oppsC = s.players.filter(x => x.id !== aId && !x.skippedThisRound);
              let target = oppsC.sort((a, b) => a.seq - b.seq)[0];
              if (isAscentPolicy && oppsC.length > 1) { target = pickTargetPolicy(oppsC) || target; }
              s = resolveChaosEvent(s, aId, majorInHand, target ? target.id : null);
              // Pause immediately if Chaos opened a Human Interrupt / Choose Discard modal or changed phase!
              if (s.pendingInteraction || s.phase !== 'TRICK' || s.winnerId !== null) return s;
            }

            // AI uses Sequence Ability (FREE while Undigested; 1-card Sanity Toll once Digested)
            const recastNeed = s.players[aId].actingDone ? 1 : 0;
            const wantAbil = !s.players[aId].abilityUsed && s.players[aId].hand.length >= (recastNeed > 0 ? 3 : 2) && (
              useTrainedNN ? liveQuery(2, 0) : (recastNeed === 0 ? true : (hDepth >= 2 && s.players[aId].hand.length >= 4))
            );
            if (wantAbil) {
              const oppsA = s.players.filter(x => x.id !== aId && !x.skippedThisRound);
              let target = oppsA.sort((a, b) => a.seq - b.seq)[0];
              if (isAscentPolicy && oppsA.length > 1) { target = pickTargetPolicy(oppsA) || target; }
              s = executeSequenceAbility(s, aId, target ? target.id : null);
              // Pause immediately if Ability opened a Human modal, rebooted trick turn order, or changed phase!
              if (s.pendingInteraction || s.phase !== 'TRICK' || s.winnerId !== null || s.trickOrder[s.trickTurnIdx] !== aId) return s;
            }

            // AI picks ANY card in Hand to play into Trick (Minor OR Major Arcana are legal!)
            const currP = s.players[aId];
            if (!currP || currP.hand.length === 0) {
              const nextIdx = s.trickTurnIdx + 1;
              let nextS = { ...s, trickTurnIdx: nextIdx };
              if (nextS.trickTurnIdx >= nextS.trickOrder.length) {
                const winPlay = evaluateTrickWinner(nextS.trickPlays, nextS.trumpCard, nextS.roundMods);
                nextS.trickWinnerId = winPlay ? winPlay.playerId : 0;
                nextS.phase = 'TRICK_REWARD';
              }
              return nextS;
            }

            const legal = [...currP.hand];
            let chosenCard = legal[0];
            if (isAscentPolicy) {
              try {
                chosenCard = selectCardLiveAscent(activeNet, s, aId, legal, 'trick') || legal[0];
              } catch (_) { chosenCard = legal[0]; }
            } else if (isCardPolicy) {
              try {
                chosenCard = selectCardLiveHard(activeNet, s, aId, legal, 'trick') || legal[0];
              } catch (_) { chosenCard = legal[0]; }
            } else {
              const tSuit = (!s.roundMods.abolishTrump && !s.roundMods.noTrumpChariot && s.trumpCard) ? getCardSuit(s.trumpCard) : null;
              legal.sort((a, b) => {
                const sc = (c) => {
                  if (c.type === 'major') return (s.trumpCard?.type === 'major' ? 14 : 4) + (c.majorId || 0) * 0.1;
                  let v = c.rank <= 10 ? c.rank : (c.rank === 14 ? 8 : 5);
                  if (tSuit && c.suit === tSuit && c.rank <= 10) v += 6;
                  if (hDepth >= 4 && (c.rank <= currP.seq || c.rank === 10) && findValidAscensionSubset([...currP.pouch, c], currP.seq, currP.mods)) v -= 25;
                  if (hDepth >= 6 && (c.rank === 1 || (c.rank === 10 && currP.seq <= 4))) v -= 32;
                  return v;
                };
                return sc(b) - sc(a);
              });
              chosenCard = legal[0];
            }
            const oppsLive = s.players.filter(x => x.id !== aId && !x.skippedThisRound);
            let bestTarget = oppsLive.length === 0 ? null : oppsLive.sort((a, b) => a.seq - b.seq)[0];
            if (useTrainedNN && oppsLive.length > 1) { bestTarget = pickTargetPolicy(oppsLive) || bestTarget; }
            return playTrickCard(s, aId, chosenCard, bestTarget ? bestTarget.id : null);
          });
        }, 620);
      }
      return;
    }

    // Trick Reward AI
    if (game.phase === 'TRICK_REWARD') {
      const winner = game.players[game.trickWinnerId];
      if (winner && !winner.isHuman) {
        aiTimerRef.current = setTimeout(() => {
          setGame(prev => {
            if (!prev || prev.phase !== 'TRICK_REWARD') return prev;
            const w = prev.players[prev.trickWinnerId];
            if (!w || w.isHuman) return prev;
            let doGamble = Math.random() < 0.35;
            const seatBrain = w.brain || aiBrainMode;
            if (isAscentBrain(seatBrain)) {
              try {
                const net = makeAscentNet();
                if (net) doGamble = queryPolicyYesNo(net, prev, w.id, 'meta_yesno');
              } catch (_) {}
            }
            if (doGamble) {
              const guess = [SUITS[Math.floor(Math.random() * 4)]];
              return resolveTrickReward(prev, 'gamble', guess);
            }
            return resolveTrickReward(prev, 'take_trump');
          });
        }, 650);
      }
    }

    // Spectator: auto-advance Ascension window (AI already attempted ascends in resolveTrickReward)
    if (game.phase === 'ASCEND' && game.spectatorMode) {
      aiTimerRef.current = setTimeout(() => {
        setGame(prev => {
          if (!prev || prev.phase !== 'ASCEND' || !prev.spectatorMode) return prev;
          return advanceToNextRound(prev);
        });
      }, 700);
    }
  }, [game, screen, aiBrainMode, ascentLookaheadDepth, handLimitMode]);

  // 5-Second Auto-Pass Countdown for Human Interrupt Window
  useEffect(() => {
    if (screen !== 'playing' || !game || game.pendingInteraction?.type !== 'INTERRUPT') return;
    setInterruptSecLeft(5);
    const interval = setInterval(() => {
      setInterruptSecLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [screen, game?.pendingInteraction?.type, game?.pendingInteraction?.card?.uid]);

  useEffect(() => {
    if (screen === 'playing' && game?.pendingInteraction?.type === 'INTERRUPT' && interruptSecLeft === 0) {
      handleInterruptDecision(false);
    }
  }, [interruptSecLeft, screen, game?.pendingInteraction?.type]);

  // Check for winner transition & auto-save completed match to Past Game History
  // Only auto-jump from the live/spectate table — never bounce back from sim/setup/replay
  useEffect(() => {
    if (game && game.winnerId !== null && screen === 'playing') {
      const sig = `${game.round}_${game.winnerId}_${game.logs.length}`;
      if (lastSavedGameRef.current !== sig) {
        lastSavedGameRef.current = sig;
        saveGameToHistory(game);
      }
      setScreen('gameover');
    }
  }, [game, screen, saveGameToHistory]);

  // Netlist Replay auto-play timer
  useEffect(() => {
    if (screen !== 'replay' || !replayPlaying) return;
    if (replayStep >= replayFrames.length - 1) {
      setReplayPlaying(false);
      return;
    }
    const t = setTimeout(() => setReplayStep(s => Math.min(replayFrames.length - 1, s + 1)), replaySpeedMs);
    return () => clearTimeout(t);
  }, [screen, replayPlaying, replayStep, replayFrames.length, replaySpeedMs]);

  // ============================================================================
  // 7. HUMAN INTERACTION HANDLERS
  // ============================================================================
  const human = game?.players[0];
  const humanPathway = human ? PATHWAYS[human.pathwayId] : null;
  const humanSeqData = human && human.seq > 0 ? humanPathway.seqs[human.seq] : null;

  const isHumanDraftTurn = !!human?.isHuman && game?.phase === 'DRAFT' && game.draftOrder[game.draftTurnIdx] === 0;
  const isHumanTrickTurn = !!human?.isHuman && game?.phase === 'TRICK' && game.trickOrder[game.trickTurnIdx] === 0 && !game.pendingInteraction;
  const isHumanRewardTurn = !!human?.isHuman && game?.phase === 'TRICK_REWARD' && game.trickWinnerId === 0;

  const leadSuit = game?.trickPlays[0]?.effSuit || null;
  const humanHasLeadSuit = useMemo(() => {
    if (!human || !leadSuit) return false;
    if (human.mods.countsAsTrump) return false;
    return human.hand.some(c => getCardSuit(c) === leadSuit);
  }, [human, leadSuit]);

  const handleHumanPouchAdd = (card) => {
    if (!game || game.phase !== 'POUCH_ADD') return;
    const maxP = human.mods.maxPouch || 3;
    if (human.pouch.length >= maxP) return;
    sfx.cardFlip();
    setGame(prev => {
      let s = {
        ...prev,
        players: prev.players.map(p => ({ ...p, hand: [...p.hand], pouch: [...p.pouch] }))
      };
      const h = s.players[0];
      if (h.pouch.length >= (h.mods.maxPouch || 3)) return prev;
      h.hand = h.hand.filter(c => c.uid !== card.uid);
      h.pouch.push(card);
      s.logs = addLog(s.logs, `You tucked ${cardShortName(card)} into your Pouch (${h.pouch.length}/${h.mods.maxPouch || 3}).`, 'info', `#1: +/${cardCode(card)}`);
      return s;
    });
  };

  const handleHumanPouchDiscard = (card) => {
    if (!game || game.phase !== 'POUCH_ADD') return;
    sfx.cardFlip();
    setGame(prev => {
      let s = {
        ...prev,
        players: prev.players.map(p => ({ ...p, pouch: [...p.pouch] })),
        grave: [card, ...prev.grave]
      };
      s.players[0].pouch = s.players[0].pouch.filter(c => c.uid !== card.uid);
      s.logs = addLog(s.logs, `Discarded ${cardShortName(card)} from your Pouch to the Grave.`, 'muted', `#1: -/${cardCode(card)}`);
      return s;
    });
  };

  const handleHumanDraft = (card) => {
    if (!isHumanDraftTurn) return;
    sfx.cardFlip();
    setGame(prev => {
      let s = {
        ...prev,
        players: prev.players.map(p => ({ ...p, hand: [...p.hand] })),
        centerDraft: prev.centerDraft.filter(c => c.uid !== card.uid)
      };
      s.players[0].hand.push(card);
      s.logs = addLog(s.logs, `You drafted ${cardShortName(card)}.`, 'emerald', `#1: D+${cardCode(card)}`);
      s.draftTurnIdx++;
      if (s.draftTurnIdx >= s.draftOrder.length) {
        return startTrickPhase(s);
      }
      return s;
    });
  };

  const getCardDescription = (card) => {
    if (!card) return '';
    if (card.type === 'major') {
      const pw = PATHWAYS[card.majorId];
      return `Event: ${pw?.chaosDesc || ''} (Recycle +${card.majorId} Grave→Deck)`;
    }
    const suitAction = card.suit === 'swords' ? 'Destroy 1 opponent Pouch card'
      : card.suit === 'wands' ? 'Force 1 opponent discard'
      : card.suit === 'pentacles' ? 'Draw 1 card'
      : 'Take top Grave card';
    let cardAction = '';
    if (card.rank === 14) cardAction = `Reveal opponent Hand & steal 1 ${SUIT_META[card.suit]?.name}`;
    else if (card.rank === 13) cardAction = 'Block an incoming discard (Wand)';
    else if (card.rank === 12) cardAction = 'Block an incoming Pouch attack (Sword)';
    else if (card.rank === 11) cardAction = 'Pouch Trap — counter-steal 1 card when hit by Sword';
    else if (card.rank === 10) cardAction = 'Overrides Trump Suit; Wildcard (1–9) in Pouch';
    else if (card.rank === 1) cardAction = 'Beats 10 of same Suit';
    return cardAction ? `Suit Action: ${suitAction} • Card Action: ${cardAction}` : `Suit Action: ${suitAction}`;
  };

  const handleHumanCardClick = (card) => {
    if (!game || game.pendingInteraction) return;
    setSelectedHandUid(prev => (prev === card.uid ? null : card.uid));
  };

  const executeHumanCardAction = (card, actionType) => {
    if (!game || game.pendingInteraction || !card) return;
    setSelectedHandUid(null);
    const activeOpps = game.players.filter(o => !o.isHuman && !o.skippedThisRound);

    if (actionType === 'pouch') {
      handleHumanPouchAdd(card);
      return;
    }
    if (actionType === 'instant_chaos' && card.type === 'major') {
      const needsTgt = [1, 3, 6, 17].includes(card.majorId);
      if (needsTgt && activeOpps.length >= 1) {
        setGame(prev => ({ ...prev, pendingInteraction: { type: 'TARGET_CHAOS', card } }));
      } else {
        setGame(prev => resolveChaosEvent(prev, 0, card, null));
      }
      return;
    }
    if (actionType === 'instant_face' && (card.rank === 12 || card.rank === 13)) {
      const needsTgt = card.suit === 'swords' || card.suit === 'wands';
      if (needsTgt && activeOpps.length >= 1) {
        setGame(prev => ({ ...prev, pendingInteraction: { type: 'TARGET_INSTANT_FACE', card } }));
      } else {
        setGame(prev => {
          let s = { ...prev, players: prev.players.map(p => ({ ...p, hand: [...p.hand], pouch: [...p.pouch], mods: { ...p.mods } })), deck: [...prev.deck], grave: [...prev.grave] };
          s.players[0].hand = s.players[0].hand.filter(c => c.uid !== card.uid);
          s.logs = addLog(s.logs, `INSTANT! You cast ${cardShortName(card)}.`, 'emerald', instantCastCode(s.players[0], cardCode(card)));
          applyInstantFaceSuitAction(s, s.players[0], null, card);
          s.grave.unshift(card);
          return s;
        });
      }
      return;
    }
    if (actionType === 'trick' && isHumanTrickTurn) {
      const needsTgt = card.type === 'major'
        ? [1, 3, 6, 17].includes(card.majorId)
        : (card.suit === 'swords' || card.suit === 'wands' || card.rank === 14);
      if (needsTgt && activeOpps.length >= 1) {
        setGame(prev => ({ ...prev, pendingInteraction: { type: 'TARGET_CARD', card } }));
      } else {
        setGame(prev => playTrickCard(prev, 0, card, null));
      }
    }
  };

  const handleHumanAbility = () => {
    if (!game || !human || human.abilityUsed || game.pendingInteraction) return;
    const seqObj = PATHWAYS[human.pathwayId]?.seqs[human.seq];
    const needsTarget = seqObj && TARGETED_ABILITY_TAGS.has(seqObj.tag);
    const activeOpps = game.players.filter(o => !o.isHuman && !o.skippedThisRound);
    const isRecast = !!human.actingDone;
    if (isRecast && human.hand.length > 1) {
      setGame(prev => ({
        ...prev,
        pendingInteraction: {
          type: 'CHOOSE_DISCARD',
          count: 1,
          destination: 'grave',
          selectedUids: [],
          afterAction: needsTarget && activeOpps.length >= 1 ? 'TARGET_ABILITY' : 'CAST_ABILITY',
          needsTarget,
          reason: `Sanity Recast Cost for ${seqObj?.name}: choose 1 Hand card to discard.`
        }
      }));
      return;
    }
    if (needsTarget && activeOpps.length >= 1) {
      setGame(prev => ({ ...prev, pendingInteraction: { type: 'TARGET_ABILITY' } }));
    } else {
      setGame(prev => executeSequenceAbility(prev, 0, null));
    }
  };

  // mode: 'pass' | 'block' | 'major' | 'ability' | 'figurine'
  const handleInterruptDecision = (mode = 'pass', chosen = null) => {
    if (!game?.pendingInteraction || game.pendingInteraction.type !== 'INTERRUPT') return;
    const pi = game.pendingInteraction;
    const { attackerId, card, attackType, source, discardCount, reason } = pi;
    // Back-compat: handleInterruptDecision(true, card) / (false)
    const resolvedMode = mode === true ? 'block' : mode === false ? 'pass' : mode;
    const blockCard = resolvedMode === 'block' ? (chosen || pi.blockCard) : null;
    const majorCard = resolvedMode === 'major' ? chosen : null;
    setGame(prev => {
      let s = {
        ...prev,
        pendingInteraction: null,
        players: prev.players.map(p => ({ ...p, hand: [...p.hand], pouch: [...p.pouch], mods: { ...p.mods } })),
        deck: [...prev.deck],
        grave: [...prev.grave],
        roundMods: { ...prev.roundMods }
      };
      const resumeAttack = (st) => {
        if (source === 'chaos_discard') {
          const cnt = Math.min(discardCount || 1, st.players[0].hand.length);
          if (cnt > 0 && !st.players[0].mods.handImmune && !st.roundMods.cancelSuitActions) {
            st.pendingInteraction = { type: 'CHOOSE_DISCARD', count: cnt, destination: 'grave', selectedUids: [], appendEffect: true, effectPrefix: '#1: ', reason: reason || `Choose ${cnt} card(s) to discard.` };
          }
          return st;
        }
        return playTrickCard(st, attackerId, card, 0, true);
      };

      if (resolvedMode === 'figurine' && s.players[0].mods.clownFigurine) {
        return {
          ...s,
          pendingInteraction: {
            type: 'FIGURINE_SWAP',
            attackerId,
            card,
            attackType,
            source,
            handUid: null,
            bagUid: null
          }
        };
      }

      if (resolvedMode === 'block' && blockCard) {
        const activeOpps = s.players.filter(o => !o.isHuman && !o.skippedThisRound);
        if ((blockCard.suit === 'swords' || blockCard.suit === 'wands') && activeOpps.length >= 1) {
          return {
            ...s,
            pendingInteraction: {
              type: 'TARGET_INTERRUPT_SUIT',
              attackerId,
              card,
              attackType,
              source,
              blockCard
            }
          };
        }
        sfx.shieldBlock();
        s.players[0].hand = s.players[0].hand.filter(c => c.uid !== blockCard.uid);
        if (attackType === 'sword') s.players[0].mods.pouchImmune = true;
        if (attackType === 'wand') s.players[0].mods.handImmune = true;
        s.logs = addLog(s.logs, `INTERRUPT! You played ${cardShortName(blockCard)} to cancel ${s.players[attackerId]?.name}'s ${attackType}!`, 'emerald', instantCastCode(s.players[0], cardCode(blockCard), `block ${pCode(attackerId)}`));
        applyInstantFaceSuitAction(s, s.players[0], s.players[attackerId], blockCard);
        s.grave.unshift(blockCard);
        if (s.players[0].pathwayId === 8 && (s.players[0].seq === 8 || s.players[0].seq === 7)) {
          s.logs = markActed(s.players[0], s.logs, 'Blocked an attack with Knight/Queen');
        }
        return resumeAttack(s);
      }

      if (resolvedMode === 'major' && majorCard) {
        const tgt = s.players.find(o => o.id !== 0 && !o.skippedThisRound);
        s = resolveChaosEvent(s, 0, majorCard, tgt ? tgt.id : null);
        if (s.pendingInteraction) return s;
        return resumeAttack(s);
      }

      if (resolvedMode === 'ability' && !s.players[0].abilityUsed) {
        const tgt = s.players.find(o => o.id !== 0 && !o.skippedThisRound);
        s = executeSequenceAbility(s, 0, tgt ? tgt.id : null, null, 0, { asInstant: true });
        if (s.pendingInteraction) {
          // Stash resume so ability targeting can continue the attack afterward
          s.pendingInteraction = { ...s.pendingInteraction, resumeInterrupt: { attackerId, card, source, discardCount, reason } };
          return s;
        }
        return resumeAttack(s);
      }

      return resumeAttack(s);
    });
  };

  const openAscendModal = () => {
    if (!game || game.phase !== 'ASCEND') return;
    setAscendSelectedUids([]);
    setShowAscendModal(true);
  };

  const toggleAscendCard = (uid) => {
    setAscendSelectedUids(prev => prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid]);
  };

  const confirmHumanAscension = () => {
    setGame(prev => performAscension(prev, 0, ascendSelectedUids));
    setShowAscendModal(false);
    setAscendSelectedUids([]);
  };


  // GLOSSARY_TERMS imported from ./data/glossary.js

  const renderRulebookModal = () => (
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
  // 8. RENDER: SETUP SCREEN
  // ============================================================================
  if (screen === 'setup') {
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
  // 8A2. RENDER: PAST GAME HISTORY & INTERACTIVE NETLIST REPLAY VIEWER
  // ============================================================================
  if (screen === 'replay') {
    return (
      <ReplayScreen
        game={game}
        gameHistory={gameHistory}
        setGameHistory={setGameHistory}
        replayInput={replayInput}
        setReplayInput={setReplayInput}
        replayFrames={replayFrames}
        replayStep={replayStep}
        setReplayStep={setReplayStep}
        replayPlaying={replayPlaying}
        setReplayPlaying={setReplayPlaying}
        replayTitle={replayTitle}
        replaySpeedMs={replaySpeedMs}
        setReplaySpeedMs={setReplaySpeedMs}
        openReplayWithNetlist={openReplayWithNetlist}
        setScreen={setScreen}
      />
    );
  }

  // ============================================================================
  // 8B. RENDER: PLAYABLE BOARD DEMO LAB (MIRRORS MAIN GAME SCREEN)
  // ============================================================================
  if (screen === 'lab' && labState) {
    return (
      <LabScreen
        labState={labState}
        setLabState={setLabState}
        labPathwayId={labPathwayId}
        setLabPathwayId={setLabPathwayId}
        labSeq={labSeq}
        setLabSeq={setLabSeq}
        labChaosId={labChaosId}
        setLabChaosId={setLabChaosId}
        labAudit={labAudit}
        setLabAudit={setLabAudit}
        labAuditTab={labAuditTab}
        setLabAuditTab={setLabAuditTab}
        labAuditSearch={labAuditSearch}
        setLabAuditSearch={setLabAuditSearch}
        setScreen={setScreen}
        setShowCodex={setShowCodex}
        setCodexTab={setCodexTab}
        setCodexPathwayId={setCodexPathwayId}
        buildLabSandbox={buildLabSandbox}
        executeSequenceAbility={executeSequenceAbility}
        resolveChaosEvent={resolveChaosEvent}
        beginRoundDraw={beginRoundDraw}
        startDraftPhase={startDraftPhase}
        startTrickPhase={startTrickPhase}
        advanceToNextRound={advanceToNextRound}
        playTrickCard={playTrickCard}
        addLog={addLog}
        applyInstantFaceSuitAction={applyInstantFaceSuitAction}
        performAscension={performAscension}
        markActed={markActed}
        exportLogsToNetlist={exportLogsToNetlist}
      />
    );
  }

  // ============================================================================
  // 8C. NN TRAINING STUDIO (CHALLENGER vs LOCKED REF + 25-GAME VALIDATION / 100)
  // ============================================================================
  // Fresh crypto seed for every train/val deal (pathways, shuffle, chaos all follow seed RNG).
  const freshGameSeed = () => {
    try {
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const buf = new Uint32Array(2);
        crypto.getRandomValues(buf);
        return ((buf[0] ^ buf[1] ^ (Date.now() >>> 0)) >>> 0) || 1;
      }
    } catch (_) { /* fall through */ }
    return ((Math.floor(Math.random() * 1e9) ^ (Date.now() & 0xffffffff) ^ ((typeof performance !== 'undefined' ? performance.now() * 1000 : 0) | 0)) >>> 0) || 1;
  };

  // N fully random validation games: new seed, random pathways, random dealer, random seat each game.
  const runValSliceAsync = (evalNN, count, _unusedSeed, stageLabel, onDone) => {
    let idx = 0;
    let wins = 0;
    let draws = 0;
    let losses = 0;
    let seq0 = 0;
    let winRounds = 0;
    const tier = nnDifficulty === 'large' ? 'large' : nnDifficulty === 'medium' ? 'medium' : 'small';
    const brain = brainForTier(tier);
    const step = () => {
      const chunk = 40;
      for (let k = 0; k < chunk && idx < count && !stopTrainRef.current; k++, idx++) {
        const nnFirst = Math.random() < 0.5;
        const seats = nnFirst
          ? [{ type: brain, depth: 5 }, { type: 'heuristic', depth: 6 }]
          : [{ type: 'heuristic', depth: 6 }, { type: brain, depth: 5 }];
        const res = runHeadlessGame({
          playerCount: 2,
          handLimitMode,
          seatConfigs: seats,
          nn: evalNN,
          nnSmall: tier === 'small' ? evalNN : nnSmallRef.current,
          nnMedium: tier === 'medium' ? evalNN : nnMediumRef.current,
          nnLarge: tier === 'large' ? evalNN : nnLargeRef.current,
          training: false,
          seed: freshGameSeed(),
          initialDealerIdx: Math.floor(Math.random() * 2),
          maxRounds: Math.max(10, Number(roundLimit) || 75)
        });
        const nnSeat = nnFirst ? 0 : 1;
        if (res.isDraw) draws++;
        else if (res.winnerId === nnSeat) { wins++; winRounds += res.rounds; }
        else losses++;
        if (res.wonBySeq0) seq0++;
      }
      setTrainProgress(prev => ({ ...prev, validating: true, valStage: stageLabel, valDone: idx, valTotal: count }));
      if (idx < count && !stopTrainRef.current) setTimeout(step, 4);
      else onDone({ games: Math.max(1, idx), wins, draws, losses, seq0, winRounds });
    };
    setTimeout(step, 4);
  };

  // Two-stage validation on fully random deals each game (no fixed pathways / paired seeds).
  const runValidation22x22Async = (championNN, valCount, checkpointIdx, onComplete, seedOverride = null, forceOverwriteWinRate = false) => {
    const evalNN = cloneActiveNN(championNN.championSnapshot || championNN.serialize());

    if (forceOverwriteWinRate) {
      const savedEvalNN = cloneActiveNN(championNN.bestValSnapshot || championNN.championSnapshot || championNN.serialize());
      runValSliceAsync(savedEvalNN, 1000, null, 'Fresh-Random Validation (1000g)', (r) => {
        const rate = r.wins / r.games;
        championNN.bestValRate = rate;
        championNN.championWinRate = rate;
        championNN.lastValSeq0Pct = Math.round((r.seq0 / r.games) * 100);
        championNN.lastValDrawPct = Math.round((r.draws / r.games) * 100);
        championNN.lastValLossPct = Math.round((r.losses / r.games) * 100);
        championNN.lastValAvgRounds = r.wins > 0 ? +(r.winRounds / r.wins).toFixed(1) : null;
        championNN.bestValSnapshot = savedEvalNN.serialize();
        championNN.bestValSnapshot.championWinRate = rate;
        championNN.championSnapshot = championNN.bestValSnapshot;
        try { localStorage.setItem(getActiveStorageKey(), JSON.stringify(championNN.bestValSnapshot)); } catch (_) {}
        onComplete(Math.round(rate * 100), championNN.lastValAvgRounds, 'saved');
      });
      return;
    }

    const prevBest = championNN.bestValRate || 0;
    const margin = prevBest > 0 ? 0.015 : 0;
    runValSliceAsync(evalNN, 100, null, 'Stage 1 Random Screen (100g)', (r1) => {
      const rate1 = r1.wins / r1.games;
      if (rate1 > prevBest && !stopTrainRef.current) {
        runValSliceAsync(evalNN, 900, null, 'Stage 2 Random Confirm (+900g = 1000g)', (r2) => {
          const totG = r1.games + r2.games;
          const totW = r1.wins + r2.wins;
          const totS0 = r1.seq0 + r2.seq0;
          const totWR = r1.winRounds + r2.winRounds;
          const avgRate = totW / totG;
          championNN.lastValSeq0Pct = Math.round((totS0 / totG) * 100);
          championNN.lastValDrawPct = Math.round(((r1.draws + r2.draws) / totG) * 100);
          championNN.lastValLossPct = Math.round(((r1.losses + r2.losses) / totG) * 100);
          championNN.lastValAvgRounds = totW > 0 ? +(totWR / totW).toFixed(1) : null;

          let action = 'keep';
          if (avgRate > prevBest + margin) {
            championNN.bestValRate = avgRate;
            championNN.championWinRate = avgRate;
            championNN.bestValSnapshot = championNN.serialize();
            championNN.championSnapshot = championNN.bestValSnapshot;
            action = 'saved';
            try { localStorage.setItem(getActiveStorageKey(), JSON.stringify(championNN.bestValSnapshot)); } catch (_) {}
          } else if (championNN.bestValSnapshot && avgRate < prevBest - 0.10) {
            championNN.loadSnapshot(championNN.bestValSnapshot);
            championNN.championSnapshot = championNN.bestValSnapshot;
            action = 'rollback';
          }
          onComplete(Math.round(avgRate * 100), championNN.lastValAvgRounds, action);
        });
      } else {
        championNN.lastValSeq0Pct = Math.round((r1.seq0 / r1.games) * 100);
        championNN.lastValDrawPct = Math.round((r1.draws / r1.games) * 100);
        championNN.lastValLossPct = Math.round((r1.losses / r1.games) * 100);
        championNN.lastValAvgRounds = r1.wins > 0 ? +(r1.winRounds / r1.wins).toFixed(1) : null;
        let action = 'keep';
        if (championNN.bestValSnapshot && rate1 < prevBest - 0.10) {
          championNN.loadSnapshot(championNN.bestValSnapshot);
          championNN.championSnapshot = championNN.bestValSnapshot;
          action = 'rollback';
        }
        onComplete(Math.round(rate1 * 100), championNN.lastValAvgRounds, action);
      }
    });
  };

  // Fast & Reliable Paired-Seed CEM Elite Search (zero gradient collapse, 3x faster than backprop!)

  const cloneActiveNN = (snap) => {
    const tier = snap?.tier || (nnDifficulty === 'large' || nnDifficulty === 'medium' ? nnDifficulty : 'small');
    return makeBrowserRLNet(tier, snap);
  };

  const storageKeyForTier = (tier) => {
    if (tier === 'large') return 'lotm_nn_rl_large_v1';
    if (tier === 'medium') return 'lotm_nn_rl_medium_v1';
    return 'lotm_nn_rl_small_v1';
  };

  const persistActiveNN = (nn, { quiet = false, tier = null, includeMemory = true } = {}) => {
    if (!nn || typeof nn.serialize !== 'function') return { ok: false, reason: 'no_net' };
    const key = storageKeyForTier(tier || nn.tier || nnDifficulty);
    const memKey = `${key}_mem`;
    // Mid-train: weights-only is cheap. Full memory JSON grows with mem size and freezes the UI.
    if (!includeMemory) {
      try {
        localStorage.setItem(key, JSON.stringify(nn.serializeWeightsOnly()));
        return { ok: true, mode: 'weights', memorySize: nn.memorySize || nn.memory?.size || 0 };
      } catch (_) {
        return { ok: false, reason: 'quota' };
      }
    }
    try {
      const full = nn.serialize({ includeMemory: true });
      localStorage.setItem(key, JSON.stringify(full));
      try { localStorage.removeItem(memKey); } catch (_) {}
      return { ok: true, mode: 'full', memorySize: nn.memorySize || nn.memory?.size || 0 };
    } catch (_) {
      // Quota: save weights + compact memory separately
      try {
        localStorage.setItem(key, JSON.stringify(nn.serializeWeightsOnly()));
        // Quota fallback only: keep highest-visit states for localStorage, RAM memory stays full
        let memOnly = nn._rankedMemoryEntries?.(Infinity) || [];
        try {
          localStorage.setItem(memKey, JSON.stringify(memOnly));
        } catch (_) {
          memOnly = nn._rankedMemoryEntries?.(100000) || [];
          try {
            localStorage.setItem(memKey, JSON.stringify(memOnly));
          } catch (_) {
            memOnly = nn._rankedMemoryEntries?.(40000) || [];
            localStorage.setItem(memKey, JSON.stringify(memOnly));
          }
        }
        return { ok: true, mode: 'split', memorySize: memOnly.length };
      } catch (e2) {
        try {
          localStorage.setItem(key, JSON.stringify(nn.serializeWeightsOnly()));
          return { ok: true, mode: 'weights', memorySize: 0, warn: 'memory_not_saved' };
        } catch (_) {
          return { ok: false, reason: 'quota' };
        }
      }
    }
  };

  const handleSaveWeights = () => {
    try {
      const nn = getActiveNN();
      const snap = nn.serialize({ includeMemory: true });
      const saved = persistActiveNN(nn, { quiet: true });
      const blob = new Blob([JSON.stringify(snap)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lotm_nn_${nnDifficulty}_${snap.gamesTrained || 0}g.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const mem = nn.memorySize || nn.memory?.size || 0;
      setNnBanner({
        tone: saved.ok ? 'emerald' : 'danger',
        text: saved.ok
          ? `Exported ${nnDifficulty} · ${snap.gamesTrained || 0} ep · mem ${mem}` + (saved.mode === 'weights' ? ' (localStorage kept weights only)' : '')
          : 'Export downloaded, but localStorage save failed (quota).'
      });
    } catch (_) {
      setNnBanner({ tone: 'danger', text: 'Failed to export NN weights.' });
    }
  };

  const runOnlineLearn = (totalGames) => {
    if (trainRunning) return;
    const count = Math.max(1, Math.min(100000, Number(totalGames) || 200));
    setTrainRunning(true);
    stopTrainRef.current = false;
    const tier = nnDifficulty === 'large' ? 'large' : nnDifficulty === 'medium' ? 'medium' : 'small';
    const nn = getActiveNN(); // continue same in-memory net (loaded / previously trained)
    const depth = Math.max(1, Math.min(6, Number(trainDepth) || 6));
    const vDepth = Math.max(1, Math.min(6, Number(valOpponentDepth) || 6));
    const everyN = Math.max(0, Math.min(100000, Number(valEveryN) || 0));
    const vGames = Math.max(1, Math.min(5000, Number(valGamesN) || 20));
    const brain = brainForTier(tier);
    const epStart = nn.gamesTrained || 0;
    const memStart = nn.memorySize || nn.memory?.size || 0;
    // Carry lifetime W/L/D + rounds across runs so the chart does not sawtooth-reset
    let done = 0;
    let blockWins = 0, blockLosses = 0, blockDraws = 0;
    let blockRoundSum = 0;
    let wins = nn.lifetimeWins || 0;
    let losses = nn.lifetimeLosses || 0;
    let draws = nn.lifetimeDraws || 0;
    let roundSum = nn.lifetimeRoundSum || 0;
    if (!(roundSum > 0) && (wins + losses + draws) > 0) {
      const priorAvg = [...trainLog].reverse().find(p => p.avgRounds != null)?.avgRounds;
      if (priorAvg != null) roundSum = priorAvg * (wins + losses + draws);
    }
    let lastValPct = nn.bestValRate != null ? Math.round(100 * nn.bestValRate) : null;
    let lastValSample = null;
    let promotions = nn.updatesCount || 0;
    let lastSeed = null;
    // Learning = continuous train (memory + D6 teacher + episode return).
    // Weights promote only from fixed-interval greedy val vs D{vDepth} — never from rolling train WR.
    const promoteMargin = vGames >= 40 ? 0.02 : 0.03; // need clearer beat when sample is smaller
    setNnBanner({
      tone: 'sky',
      text: `Continuing ${tier} from ${epStart} ep · mem ${memStart} · train vs D${depth}` +
        (everyN > 0
          ? ` · greedy val ${vGames}g vs D${vDepth} every ${everyN} train (promote on +${Math.round(promoteMargin * 100)}pp)`
          : ' · no mid-train val (train-only; rolling WR is chart-only)') +
        ' · fresh seed each game'
    });
    setTrainProgress({ done: 0, total: count, promotions, lastValRate: lastValPct, avgRounds: null, memorySize: memStart });

    const runValBlock = () => {
      let vw = 0, vl = 0, vd = 0;
      // Greedy eval on the live net (training:false → exploreRate 0); memory still guides locked bests
      const evalNet = nn;
      const prevExplore = evalNet.epsilon;
      evalNet.epsilon = 0;
      for (let i = 0; i < vGames; i++) {
        const nnFirst = Math.random() < 0.5;
        const seats = nnFirst
          ? [{ type: brain, depth: 5 }, { type: 'heuristic', depth: vDepth }]
          : [{ type: 'heuristic', depth: vDepth }, { type: brain, depth: 5 }];
        const seed = freshGameSeed();
        lastSeed = seed;
        const res = runHeadlessGame({
          playerCount: 2,
          handLimitMode,
          seatConfigs: seats,
          nn: evalNet,
          nnSmall: tier === 'small' ? evalNet : nnSmallRef.current,
          nnMedium: tier === 'medium' ? evalNet : nnMediumRef.current,
          nnLarge: tier === 'large' ? evalNet : nnLargeRef.current,
          training: false,
          maxRounds: Math.max(20, Math.min(75, Number(roundLimit) || 50)),
          seed,
          initialDealerIdx: Math.floor(Math.random() * 2)
        });
        const nnSeat = nnFirst ? 0 : 1;
        if (res.isDraw) vd++;
        else if (res.winnerId === nnSeat) vw++;
        else vl++;
      }
      evalNet.epsilon = prevExplore;
      const played = Math.max(1, vw + vl + vd);
      const rate = vw / played;
      const samplePct = Math.round(100 * rate);
      const prevBest = nn.bestValRate || 0;
      let action = `VAL ${samplePct}% vs D${vDepth} (${vGames}g greedy)`;
      // Promote only on a clear greedy-val improvement — do NOT rollback on a noisy dip
      // (rollback was undoing real memory/weight learning from rolling/sample noise).
      if (rate > prevBest + promoteMargin || (prevBest === 0 && played >= Math.min(20, vGames))) {
        nn.bestValRate = rate;
        nn.bestValSnapshot = nn.serialize({ includeMemory: false });
        nn.promoteChampion?.(1);
        promotions = nn.updatesCount || promotions;
        action = `VAL PROMOTE ${samplePct}% vs D${vDepth} (best was ${Math.round(100 * prevBest)}%)`;
        persistActiveNN(nn, { quiet: true, includeMemory: false });
      } else {
        action = `VAL ${samplePct}% vs D${vDepth} · best held ${Math.round(100 * (nn.bestValRate || prevBest))}% · keep training`;
      }
      lastValPct = Math.round(100 * (nn.bestValRate || rate));
      lastValSample = samplePct;
      const blockPlayed = Math.max(1, blockWins + blockLosses + blockDraws);
      const rolling = Math.round(10000 * (blockWins / blockPlayed)) / 100;
      const blockAvgR = Math.round(10 * blockRoundSum / blockPlayed) / 10;
      setTrainLog(prev => [...prev, {
        ep: epStart + done,
        gamesTrained: nn.gamesTrained || 0,
        ascentScore: rolling,
        rollingWinPct: rolling,
        avgRounds: blockAvgR,
        valWinRate: lastValPct,
        valSample: samplePct,
        isVal: true,
        action
      }].slice(-5000));
    };

    const step = () => {
      if (stopTrainRef.current || done >= count) {
        const lifePlayed = Math.max(1, wins + losses + draws);
        const lifeWr = Math.round(100 * wins / lifePlayed);
        const blockPlayed = Math.max(1, blockWins + blockLosses + blockDraws);
        const blockWr = Math.round(100 * blockWins / blockPlayed);
        const saved = persistActiveNN(nn, { quiet: true, includeMemory: true });
        setNnBanner({
          tone: 'emerald',
          text: `Continued train ${done}g · block ${blockWr}% · lifetime ${lifeWr}% (W${wins}/L${losses}/D${draws}) · mem ${nn.memorySize || 0} · total ep ${nn.gamesTrained || 0}` +
            (lastValPct != null ? ` · best val ${lastValPct}%` : '') +
            (saved.mode === 'weights' ? ' · warn: mem not in localStorage' : '')
        });
        setTrainRunning(false);
        return;
      }
      const chunk = Math.min(tier === 'large' ? 2 : 4, count - done);
      for (let i = 0; i < chunk; i++) {
        // Short warmup vs weaker heuristic, then full train depth (real learning vs D6)
        const frac = done / Math.max(1, count);
        const currDepth = frac < 0.15 ? Math.min(depth, 4) : depth;
        const seed = freshGameSeed();
        lastSeed = seed;
        const nnFirst = Math.random() < 0.5;
        const seats = nnFirst
          ? [{ type: brain, depth: 5 }, { type: 'heuristic', depth: currDepth }]
          : [{ type: 'heuristic', depth: currDepth }, { type: brain, depth: 5 }];
        const res = runHeadlessGame({
          playerCount: 2,
          handLimitMode,
          seatConfigs: seats,
          nn,
          nnSmall: nnSmallRef.current,
          nnMedium: nnMediumRef.current,
          nnLarge: nnLargeRef.current,
          nnEasy: nnSmallRef.current,
          training: true,
          learnFromHeuristic: true,
          maxRounds: Math.max(20, Math.min(75, Number(roundLimit) || 50)),
          seed,
          initialDealerIdx: Math.floor(Math.random() * 2)
        });
        done++;
        const rds = res.rounds || 0;
        roundSum += rds;
        blockRoundSum += rds;
        const nnSeat = nnFirst ? 0 : 1;
        if (res.isDraw) {
          draws++;
          blockDraws++;
          nn.recordMatchOutcome?.({ draw: true, rounds: rds });
        } else if (res.winnerId === nnSeat) {
          wins++;
          blockWins++;
          nn.recordMatchOutcome?.({ win: true, rounds: rds });
        } else {
          losses++;
          blockLosses++;
          nn.recordMatchOutcome?.({ loss: true, rounds: rds });
        }
        // Fixed schedule only — rolling WR never triggers val / promote / rollback
        if (everyN > 0 && done % everyN === 0) runValBlock();
      }
      const blockPlayed = Math.max(1, blockWins + blockLosses + blockDraws);
      const rolling = Math.round(10000 * (blockWins / blockPlayed)) / 100;
      const blockAvgR = Math.round(10 * blockRoundSum / blockPlayed) / 10;
      setTrainProgress({
        done,
        total: count,
        promotions,
        lastValRate: lastValSample != null ? lastValSample : (lastValPct != null ? lastValPct : Math.round(rolling)),
        avgRounds: blockAvgR,
        memorySize: nn.memorySize || nn.memory?.size || 0
      });
      if (done % 10 === 0 || done >= count) {
        setTrainLog(prev => [...prev, {
          ep: epStart + done,
          gamesTrained: nn.gamesTrained || 0,
          ascentScore: rolling,
          rollingWinPct: rolling,
          avgRounds: blockAvgR,
          valWinRate: undefined,
          valSample: lastValSample,
          isVal: false,
          action: `train vs D${depth} · roll ${Math.round(rolling)}% · mem ${nn.memorySize || 0} · ep ${nn.gamesTrained || 0}` +
            (lastSeed != null ? ` · seed ${lastSeed}` : '')
        }].slice(-5000));
      }
      // Weights-only checkpoint; full memory persist only at end (avoids multi-second freezes)
      if (done % 100 === 0) persistActiveNN(nn, { quiet: true, includeMemory: false });
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  };

  const handleLoadWeights = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.target?.result || '{}'));
        if (parsed.kind === 'browser_rl_v1' || parsed.format === 'browser_rl_v1') {
          const tier = parsed.tier === 'large' || parsed.tier === 'medium' ? parsed.tier : 'small';
          const net = makeBrowserRLNet(tier, parsed);
          if (tier === 'large') nnLargeRef.current = net;
          else if (tier === 'medium') nnMediumRef.current = net;
          else nnSmallRef.current = net;
          setNnDifficulty(tier);
          persistActiveNN(net, { quiet: true, tier });
          setNnBanner({
            tone: 'emerald',
            text: `Loaded ${tier} · continuing from ${net.gamesTrained || 0} ep · mem ${net.memorySize || 0} · ${net.inSize}→${net.outSize}`
          });
          // Keep train log so history isn't wiped when resuming
          return;
        }
        if (parsed.format === 'compact_ascent_v1' || parsed.weights) {
          const tier = parsed.tier === 'medium' || (parsed.obsDim || 0) > 300 ? 'medium' : 'small';
          const net = makePolicyNet(tier, parsed);
          if (tier === 'medium') nnMediumRef.current = makeBrowserRLNet('medium');
          else nnSmallRef.current = makeBrowserRLNet('small');
          setNnBanner({ tone: 'amber', text: 'Old PolicyNet JSON ignored — reset to Browser RL. Train in-browser instead.' });
          return;
        }
        setNnBanner({ tone: 'danger', text: 'Need browser_rl_v1 JSON (Save Weights from Train Studio).' });
      } catch (_) {
        setNnBanner({ tone: 'danger', text: 'Could not parse JSON weights file.' });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const randomizeValSeed = () => {
    if (trainRunning) return;
    const next = freshGameSeed();
    setValSeed(next);
    setTrainRunning(true);
    stopTrainRef.current = false;
    setTrainProgress(prev => ({ ...prev, validating: true, valDone: 0, valTotal: 1000 }));
    const champNN = getActiveNN();
    runValidation22x22Async(champNN, 1000, 0, (valPct, valAvgRds) => {
      setTrainLog(prev => [...prev, { ep: champNN.gamesTrained, valWinRate: valPct, valAvgRds, promotions: champNN.updatesCount }].slice(-40));
      setTrainProgress(prev => ({ ...prev, validating: false, lastValRate: valPct }));
      setNnBanner({ tone: 'emerald', text: `Re-validated on fully random deals (fresh seed/pathways/seat each game): ${valPct}% Win Rate!` });
      setTrainRunning(false);
    }, null, true);
  };

  const resetNNWeights = () => {
    const tier = nnDifficulty === 'large' ? 'large' : nnDifficulty === 'medium' ? 'medium' : 'small';
    const fresh = makeBrowserRLNet(tier);
    if (tier === 'large') nnLargeRef.current = fresh;
    else if (tier === 'medium') nnMediumRef.current = fresh;
    else nnSmallRef.current = fresh;
    try {
      localStorage.removeItem(getActiveStorageKey());
      localStorage.removeItem(`${getActiveStorageKey()}_mem`);
    } catch (_) {}
    setTrainLog([]);
    setTrainProgress({ done: 0, total: 0, promotions: 0, lastValRate: null });
    const d = TIER_DIMS[tier];
    setNnBanner({ tone: 'emerald', text: `${tier} Browser RL wiped (${d.inSize}→${d.hidSize}→${d.outSize}) · memory cleared.` });
  };

  if (screen === 'train') {
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
        valOpponentDepth={valOpponentDepth}
        setValOpponentDepth={setValOpponentDepth}
        valEveryN={valEveryN}
        setValEveryN={setValEveryN}
        valGamesN={valGamesN}
        setValGamesN={setValGamesN}
        runOnlineLearn={runOnlineLearn}
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
  // 8D. AI EVALUATION SIMULATOR (0% EXPLORATION • FROZEN WEIGHTS • PURE STATS)
  // ============================================================================
  const runSimBatch = (rawCount) => {
    if (simRunning) return;
    const count = Math.max(1, Math.min(50000, Number(rawCount) || 1000));
    setSimRunning(true);
    stopSimRef.current = false;
    setSimProgress({ done: 0, total: count });
    let done = 0;
    const chunkSize = 20;

    const parseBrainOpt = (val) => {
      if (val === 'nn_large' || val === 'nn_hard' || val === 'nn_ascent') return { type: 'nn_large', depth: 5 };
      if (val === 'nn_medium' || val === 'nn_tabula') return { type: 'nn_medium', depth: 5 };
      if (val === 'nn_small' || val === 'nn_easy') return { type: 'nn_small', depth: 5 };
      const d = Number(val.split('_')[1]) || 5;
      return { type: 'heuristic', depth: d };
    };
    const seatCfgs = simSeatBrains.slice(0, simPlayerCount).map(parseBrainOpt);
    const evalSmall = nnSmallRef.current;
    const evalMedium = nnMediumRef.current;
    const evalLarge = nnLargeRef.current;

    const stepChunk = () => {
      const results = [];
      for (let i = 0; i < chunkSize && done < count && !stopSimRef.current; i++, done++) {
        const res = runHeadlessGame({
          playerCount: simPlayerCount,
          handLimitMode,
          seatConfigs: seatCfgs,
          nnSmall: evalSmall,
          nnEasy: evalSmall,
          nnMedium: evalMedium,
          nnLarge: evalLarge,
          nn: evalSmall,
          lookaheadDepth: ascentLookaheadDepth,
          training: false,
          maxRounds: Math.max(10, Number(roundLimit) || 75)
        });
        results.push(res);
      }

      setSimStats(prev => {
        const next = {
          ...prev,
          suitCounts: { ...prev.suitCounts },
          chaosCounts: { ...prev.chaosCounts },
          pathwayStats: Object.fromEntries(Object.entries(prev.pathwayStats).map(([k, v]) => [k, { ...v }])),
          history: [...prev.history]
        };
        next.records = [...(prev.records || [])];
        for (const r of results) {
          next.records.push({
            winnerId: r.winnerId,
            isDraw: !!r.isDraw,
            wonBySeq0: !!r.wonBySeq0,
            comebackWin: !!r.comebackWin,
            rounds: r.rounds,
            digested: r.digestedAscends || 0,
            undigested: r.undigestedAscends || 0,
            handAvg: r.samples > 0 ? r.avgHandSum / r.samples : 0,
            pouchAvg: r.samples > 0 ? r.avgPouchSum / r.samples : 0,
            graveAvg: r.samples > 0 ? r.avgGraveSum / r.samples : 0,
            players: r.finalSeqs
          });
          next.games++;
          if (r.isDraw) next.draws++;
          else if (r.winnerId === 0) next.nnWins++;
          if (r.wonBySeq0) next.seq0Wins++;
          if (r.comebackWin) next.comebacks++;
          next.totalRounds += r.rounds;
          next.digested += r.digestedAscends;
          next.undigested += r.undigestedAscends;
          next.mentalBreaks += r.mentalBreaks;
          if (r.samples > 0) {
            next.handSum += r.avgHandSum / r.samples;
            next.pouchSum += r.avgPouchSum / r.samples;
            next.graveSum += r.avgGraveSum / r.samples;
            next.deckSum += r.avgDeckSum / r.samples;
          }
          for (const st of SUITS) next.suitCounts[st] += r.suitCounts[st];
          for (const [cid, cnt] of Object.entries(r.chaosTriggered)) {
            next.chaosCounts[cid] = (next.chaosCounts[cid] || 0) + cnt;
          }
          for (const fs of r.finalSeqs) {
            const ps = next.pathwayStats[fs.pathwayId];
            ps.games++;
            ps.seqSum += fs.seq;
            ps.lostTurns += (fs.lostTurns || 0);
            ps.tricksWon += (fs.tricksWon || 0);
            ps.abilitiesUsed += (fs.abilitiesUsed || 0);
            ps.chaosUsed += (fs.chaosUsed || 0);
            ps.handSum += (fs.avgHand || 0);
            ps.K += (fs.faceCounts?.K || 0);
            ps.Q += (fs.faceCounts?.Q || 0);
            ps.N += (fs.faceCounts?.N || 0);
            ps.P += (fs.faceCounts?.P || 0);
            ps.swords += (fs.suitCounts?.swords || 0);
            ps.pentacles += (fs.suitCounts?.pentacles || 0);
            ps.cups += (fs.suitCounts?.cups || 0);
            ps.wands += (fs.suitCounts?.wands || 0);
            if (r.isDraw) {
              ps.draws++;
            } else if (fs.id === r.winnerId) {
              ps.wins++;
              if (r.wonBySeq0) ps.seq0Wins++;
              if (r.comebackWin) ps.comebacks++;
            } else {
              ps.losses++;
            }
          }
        }
        return next;
      });

      setSimProgress({ done, total: count });
      if (done < count && !stopSimRef.current) setTimeout(stepChunk, 10);
      else setSimRunning(false);
    };
    setTimeout(stepChunk, 10);
  };

  const runRoundRobin = (numSeeds) => {
    if (rrRunning) return;
    const seedsN = Math.max(1, Math.min(20, Number(numSeeds) || 1));
    setRrRunning(true);
    stopRrRef.current = false;

    // Build exact 506-game schedule per seed: all 253 pairs (0 <= i <= j < 22) played twice (P1=i vs P2=j, then P1=j vs P2=i) with SAME deck seed!
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

    const parseBrainOpt = (val) => {
      if (val === 'nn_large' || val === 'nn_hard' || val === 'nn_ascent') return { type: 'nn_large', depth: 5 };
      if (val === 'nn_medium' || val === 'nn_tabula') return { type: 'nn_medium', depth: 5 };
      if (val === 'nn_small' || val === 'nn_easy') return { type: 'nn_small', depth: 5 };
      const d = Number(val.split('_')[1]) || 5;
      return { type: 'heuristic', depth: d };
    };
    const p1Cfg = parseBrainOpt(simP1Brain);
    const p2Cfg = parseBrainOpt(simP2Brain);
    const evalSmall = nnSmallRef.current;
    const evalMedium = nnMediumRef.current;
    const evalLarge = nnLargeRef.current;

    const total = schedule.length; // 506 * seedsN
    let cursor = 0;
    const chunkSize = 22;
    setRrProgress({ done: 0, total });

    const stepRR = () => {
      const batchRes = [];
      for (let k = 0; k < chunkSize && cursor < total && !stopRrRef.current; k++, cursor++) {
        const match = schedule[cursor];
        const res = runHeadlessGame({
          playerCount: 2,
          handLimitMode,
          p1Config: p1Cfg,
          p2Config: p2Cfg,
          nnSmall: evalSmall,
          nnEasy: evalSmall,
          nnMedium: evalMedium,
          nnLarge: evalLarge,
          nn: evalSmall,
          lookaheadDepth: ascentLookaheadDepth,
          training: false,
          fixedPathways: [match.p1, match.p2],
          seed: match.seed,
          maxRounds: Math.max(10, Number(roundLimit) || 75)
        });
        batchRes.push(res);
      }

      setRrStats(prev => {
        const nextMatrix = prev.matrix ? prev.matrix.map(row => row.map(cell => ({ ...cell }))) : makeEmptyMatrix();
        const next = {
          ...prev,
          matrix: nextMatrix,
          pathwayStats: Object.fromEntries(Object.entries(prev.pathwayStats).map(([k, v]) => [k, { ...v }]))
        };
        next.records = [...(prev.records || [])];
        for (const r of batchRes) {
          next.records.push({
            winnerId: r.winnerId,
            isDraw: !!r.isDraw,
            wonBySeq0: !!r.wonBySeq0,
            comebackWin: !!r.comebackWin,
            rounds: r.rounds,
            digested: r.digestedAscends || 0,
            undigested: r.undigestedAscends || 0,
            handAvg: r.samples > 0 ? r.avgHandSum / r.samples : 0,
            pouchAvg: r.samples > 0 ? r.avgPouchSum / r.samples : 0,
            graveAvg: r.samples > 0 ? r.avgGraveSum / r.samples : 0,
            players: r.finalSeqs
          });
          next.games++;
          if (r.isDraw) next.draws++;
          else if (r.winnerId === 0) next.p1Wins++;
          else next.p2Wins++;
          const p1Id = r.finalSeqs[0]?.pathwayId;
          const p2Id = r.finalSeqs[1]?.pathwayId;
          if (p1Id != null && p2Id != null) {
            nextMatrix[p1Id][p2Id].g++;
            if (r.winnerId === 0) nextMatrix[p1Id][p2Id].w++;
            if (p1Id !== p2Id) {
              nextMatrix[p2Id][p1Id].g++;
              if (r.winnerId === 1) nextMatrix[p2Id][p1Id].w++;
            }
          }
          if (r.wonBySeq0) next.seq0Wins++;
          if (r.comebackWin) next.comebacks++;
          next.totalRounds += r.rounds;
          for (const fs of r.finalSeqs) {
            const ps = next.pathwayStats[fs.pathwayId];
            ps.games++;
            ps.seqSum += fs.seq;
            ps.lostTurns += (fs.lostTurns || 0);
            ps.tricksWon += (fs.tricksWon || 0);
            ps.abilitiesUsed += (fs.abilitiesUsed || 0);
            ps.chaosUsed += (fs.chaosUsed || 0);
            ps.handSum += (fs.avgHand || 0);
            ps.K += (fs.faceCounts?.K || 0);
            ps.Q += (fs.faceCounts?.Q || 0);
            ps.N += (fs.faceCounts?.N || 0);
            ps.P += (fs.faceCounts?.P || 0);
            ps.swords += (fs.suitCounts?.swords || 0);
            ps.pentacles += (fs.suitCounts?.pentacles || 0);
            ps.cups += (fs.suitCounts?.cups || 0);
            ps.wands += (fs.suitCounts?.wands || 0);
            if (r.isDraw) {
              ps.draws++;
            } else if (fs.id === r.winnerId) {
              ps.wins++;
              if (r.wonBySeq0) ps.seq0Wins++;
              if (r.comebackWin) ps.comebacks++;
            } else {
              ps.losses++;
            }
          }
        }
        next.seedsDone = Math.floor(next.games / 506);
        return next;
      });

      setRrProgress({ done: cursor, total });
      if (cursor < total && !stopRrRef.current) setTimeout(stepRR, 10);
      else setRrRunning(false);
    };
    setTimeout(stepRR, 10);
  };

  const resetRrStats = () => {
    setRrStats({
      seedsDone: 0, games: 0, p1Wins: 0, p2Wins: 0, draws: 0, seq0Wins: 0, totalRounds: 0, comebacks: 0, records: [],
      matrix: makeEmptyMatrix(),
      pathwayStats: makeEmptyPathwayStats()
    });
    setRrProgress({ done: 0, total: 0 });
  };

  const resetSimStatsOnly = () => {
    setSimStats({
      games: 0, nnWins: 0, draws: 0, seq0Wins: 0, comebacks: 0, totalRounds: 0, digested: 0, undigested: 0, records: [],
      mentalBreaks: 0, handSum: 0, pouchSum: 0, graveSum: 0, deckSum: 0,
      suitCounts: { swords: 0, wands: 0, pentacles: 0, cups: 0 },
      chaosCounts: {},
      pathwayStats: makeEmptyPathwayStats(),
      history: []
    });
  };

  if (screen === 'sim') {
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
        tableSortKey={tableSortKey}
        setTableSortKey={setTableSortKey}
        tableSortDir={tableSortDir}
        setTableSortDir={setTableSortDir}
        simBatchSize={simBatchSize}
        setSimBatchSize={setSimBatchSize}
        rrSeedsCount={rrSeedsCount}
        setRrSeedsCount={setRrSeedsCount}
        showPathwayFilter={showPathwayFilter}
        setShowPathwayFilter={setShowPathwayFilter}
        startWatchMatch={startWatchMatch}
      />
    );
  }

  // ============================================================================
  // 9. RENDER: GAME OVER SCREEN
  // ============================================================================
  if (screen === 'gameover' && game) {
    const netlist = exportLogsToNetlist(game.logs);
    return (
      <GameOverScreen
        game={game}
        onPlayAgain={() => {
          if (game.spectatorMode) {
            setGame(null);
            setScreen('sim');
          } else {
            setGame(null);
            rollDraftOptions();
            setScreen('setup');
          }
        }}
        onOpenReplay={() => openReplayWithNetlist(netlist, `Spectate R${game.round} — ${game.players.map(p => PATHWAYS[p.pathwayId].arcana).join(' vs ')}`)}
        onCopyNetlist={() => {
          try {
            navigator.clipboard.writeText(netlist);
            setNetlistCopied(true);
            setTimeout(() => setNetlistCopied(false), 1500);
          } catch (_) {}
        }}
        netlistCopied={netlistCopied}
      />
    );
  }

  // ============================================================================
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
      showGrave={showGrave}
      setShowGrave={setShowGrave}
      handleHumanDraft={handleHumanDraft}
      handleHumanCardClick={handleHumanCardClick}
      handleHumanPouchDiscard={handleHumanPouchDiscard}
      handleInterruptDecision={handleInterruptDecision}
      toggleAscendCard={toggleAscendCard}
      logViewMode={logViewMode}
      setLogViewMode={setLogViewMode}
      netlistCopied={netlistCopied}
      setNetlistCopied={setNetlistCopied}
      rollDraftOptions={rollDraftOptions}
      startDraftPhase={startDraftPhase}
      advanceToNextRound={advanceToNextRound}
      leadSuit={leadSuit}
      openAscendModal={openAscendModal}
      handleHumanAbility={handleHumanAbility}
      historySavedToast={historySavedToast}
      handLimitMode={handLimitMode}
    />
  );
}

