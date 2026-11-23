import { useMemo, useState } from 'react';
import {
  Sparkles, BookOpen, Volume2, VolumeX, Zap, X, History, ScrollText, Crown, Layers,
  CheckCircle2, AlertTriangle, Skull, RotateCcw, Lock, Eye, Shield, ChevronRight
} from 'lucide-react';
import { PATHWAYS, SUITS, SUIT_META, ROMAN, TARGETED_ABILITY_TAGS, getCardSuit } from '../data/constants.js';
import { cardCode, cardShortName, isNumberCard } from '../utils/cards.js';
import { instantCastCode, abilityCastCode, pCode, fogNetlistAction, boardState, roundKeyFromHeader } from '../utils/netlist.js';
import { checkAscensionMath, findValidAscensionSubset, getHandLimit, evaluateTrickWinner } from '../utils/rules.js';
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
  showGrave,
  setShowGrave,
  handleHumanDraft,
  handleHumanCardClick,
  handleHumanPouchDiscard,
  handleInterruptDecision,
  toggleAscendCard,
  logViewMode,
  setLogViewMode,
  netlistCopied,
  setNetlistCopied,
  rollDraftOptions,
  startDraftPhase,
  advanceToNextRound,
  leadSuit,
  openAscendModal,
  handleHumanAbility,
  historySavedToast,
  handLimitMode
}) {
  // Chronicle pagination: one page per round (0 = Setup / G=)
  const [chronicleRound, setChronicleRound] = useState('latest');

  const opponents = game.players.filter(p => p.id !== human.id);

  const logsWithRounds = useMemo(() => {
    // logs are newest-first; walk oldest→newest to assign round, then keep newest-first order
    const chrono = [...game.logs].reverse();
    let cur = 0;
    const tagged = chrono.map(e => {
      const key = roundKeyFromHeader(e.headerCode ?? e.code);
      if (key !== null) cur = key;
      return { ...e, roundKey: cur };
    });
    return tagged.reverse();
  }, [game.logs]);

  const roundPages = useMemo(() => {
    const keys = [...new Set(logsWithRounds.map(e => e.roundKey))].sort((a, b) => a - b);
    return keys;
  }, [logsWithRounds]);

  const activeChronicleRound = chronicleRound === 'latest'
    ? (roundPages.length ? roundPages[roundPages.length - 1] : 0)
    : chronicleRound;

  const visibleLogs = useMemo(() => {
    return logsWithRounds.filter(e => {
      if (e.roundKey !== activeChronicleRound) return false;
      if (logViewMode === 'netlist' && !e.code && e.headerCode === undefined) return false;
      return true;
    });
  }, [logsWithRounds, activeChronicleRound, logViewMode]);
  const ascendPool = human.mods.handAscend ? [...human.pouch, ...human.hand] : human.pouch;
  const ascendSelectionCards = ascendPool.filter(c => ascendSelectedUids.includes(c.uid));
  const ascendCheck = checkAscensionMath(ascendSelectionCards, human.seq, human.mods);
  const canAscendNow = !human.mods.ascendLocked && !human.ascendedThisRound && findValidAscensionSubset(ascendPool, human.seq, human.mods) !== null;

  const phaseLabel =
    game.phase === 'POUCH_ADD' ? 'Phase 1: Tuck 1 Card into Pouch' :
    game.phase === 'DRAFT' ? (isHumanDraftTurn ? 'Phase 2: Your Turn to Draft' : 'Phase 2: Center Draft') :
    game.phase === 'TRICK' ? (isHumanTrickTurn ? 'Phase 3: Your Turn — Play a Minor Arcana' : 'Phase 3: Trick in Progress') :
    game.phase === 'TRICK_REWARD' ? (isHumanRewardTurn ? 'Phase 4: Claim Your Trick Reward!' : 'Phase 4: Winner Claiming Reward') :
    'Phase 5: Ascension & Next Round';

  return (
    <div className="min-h-screen bg-[#09080f] text-slate-100 font-sans flex flex-col">
      {/* TOP BAR */}
      <header className="sticky top-0 z-30 bg-[#12101c]/95 backdrop-blur border-b border-amber-500/25 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-5 h-5 text-amber-400 shrink-0" />
          <div>
            <div className="text-sm font-serif font-bold text-amber-100 leading-none">
              LoTM Tarot{game.spectatorMode ? ' · Spectating' : ''}
            </div>
            <div className="text-[11px] text-amber-400/80 font-medium">
              Round {game.round} • {phaseLabel}
              {game.spectatorMode ? ' • AI vs AI (netlist auto-logged)' : ''}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowGrave(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-sky-300"
          >
            <Skull className="w-3.5 h-3.5" /> Grave ({game.grave.length})
          </button>
          <button
            onClick={() => setShowCodex(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-amber-500/30 text-xs font-semibold text-amber-200"
          >
            <BookOpen className="w-3.5 h-3.5" /> Rules & 22 Pathways
          </button>
          <button
            onClick={openAbilityLab}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-950/80 hover:bg-violet-900/80 border border-violet-500/40 text-xs font-semibold text-violet-200"
          >
            <Zap className="w-3.5 h-3.5" /> Demo Lab
          </button>
          <button
            onClick={() => openReplayWithNetlist(exportLogsToNetlist(game.logs), `Live Match Snapshot (Round ${game.round})`)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-950/80 hover:bg-indigo-900/80 border border-indigo-500/40 text-xs font-semibold text-indigo-200"
            title="Open current match or past game history in Netlist Replay Viewer"
          >
            <History className="w-3.5 h-3.5" /> Replay
          </button>
          <button
            onClick={() => setScreen('train')}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-950/80 hover:bg-sky-900/80 border border-sky-500/40 text-xs font-semibold text-sky-200"
          >
            <Zap className="w-3.5 h-3.5" /> Train NN
          </button>
          <button
            onClick={() => setScreen('sim')}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900/80 border border-emerald-500/40 text-xs font-semibold text-emerald-200"
          >
            <Sparkles className="w-3.5 h-3.5" /> AI Sim
          </button>
          <button
            onClick={toggleMute}
            className="p-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-slate-700 text-slate-300"
            title={muted ? 'Unmute Audio' : 'Mute Audio'}
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <button
            onClick={() => { rollDraftOptions(); setScreen('setup'); }}
            className="p-1.5 rounded-lg bg-slate-800/90 hover:bg-rose-900/60 border border-slate-700 text-slate-300"
            title="New Game"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* MAIN CONTENT GRID */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 md:p-4 grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* LEFT + CENTER PLAYFIELD (9 cols on lg) */}
        <div className="lg:col-span-9 flex flex-col gap-3">
          {/* OPPONENTS ROW */}
          <div className={`grid gap-2.5 ${opponents.length === 1 ? 'grid-cols-1' : opponents.length === 2 ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-3'}`}>
            {opponents.map(opp => {
              const op = PATHWAYS[opp.pathwayId];
              const isActive = (game.phase === 'DRAFT' && game.draftOrder[game.draftTurnIdx] === opp.id) ||
                               (game.phase === 'TRICK' && game.trickOrder[game.trickTurnIdx] === opp.id);
              return (
                <div
                  key={opp.id}
                  onClick={() => setBoardInspect(prev => (prev?.type === 'opp' && prev.oppId === opp.id) ? null : { type: 'opp', oppId: opp.id })}
                  title="Click to inspect opponent's active Sequence Ability & Acting Condition"
                  className={`rounded-xl border p-2.5 transition-all bg-[#141220] cursor-pointer hover:border-amber-300/60 ${
                    boardInspect?.type === 'opp' && boardInspect.oppId === opp.id
                      ? 'border-sky-400 ring-1 ring-sky-400/60'
                      : isActive ? 'border-amber-400 ring-1 ring-amber-400/50' : 'border-white/10'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-sm text-slate-100 truncate">{opp.name}</span>
                        {opp.skipNextTurn && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-900/80 text-rose-200 font-bold">SKIP</span>
                        )}
                      </div>
                      <div className="text-[11px] text-amber-300/90 truncate">
                        {ROMAN[op.id]}. {op.arcana} • {op.seqs[opp.seq]?.name || 'God'}
                      </div>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <span className="px-2 py-0.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 font-serif font-bold text-xs">
                        Seq {opp.seq}
                      </span>
                      <span className={`text-[10px] mt-0.5 font-semibold ${opp.actingDone ? 'text-emerald-400' : 'text-slate-500'}`}>
                        {opp.actingDone ? 'Digested ✓' : 'Undigested'}
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 flex items-center justify-between text-xs text-slate-300 bg-slate-950/60 rounded-lg px-2.5 py-1.5">
                    <span className={`flex items-center gap-1 font-medium ${opp.hand.length <= 1 ? 'text-rose-400 font-bold' : ''}`}>
                      <Layers className="w-3.5 h-3.5 text-violet-400" /> Hand: {opp.hand.length}
                    </span>
                    <span className="flex items-center gap-1 font-medium">
                      <Lock className="w-3.5 h-3.5 text-amber-400" /> Pouch: {opp.pouch.length}/3
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* LIVE BOARD INSPECTOR (Selected Opponent Ability/Acting OR Board Card Description) */}
          {boardInspect && (
            <div className="rounded-xl border border-sky-400/50 bg-[#121626] px-3.5 py-2.5 flex items-start justify-between gap-3 text-xs shadow-lg">
              {boardInspect.type === 'opp' && (() => {
                const o = game.players[boardInspect.oppId];
                const op = o ? PATHWAYS[o.pathwayId] : null;
                const oSeq = op && o.seq > 0 ? op.seqs[o.seq] : null;
                if (!o || !op) return null;
                return (
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sky-200">{o.name} — {ROMAN[op.id]}. {op.arcana} (Seq {o.seq}: {oSeq?.name || 'God'})</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${o.actingDone ? 'bg-emerald-900/70 text-emerald-300' : 'bg-slate-800 text-slate-300'}`}>
                        {o.actingDone ? 'Digested ✓ (-1 Sanity Toll)' : 'Undigested (Free Cast)'}
                      </span>
                    </div>
                    {oSeq && (
                      <>
                        <div className="text-slate-200"><strong className="text-amber-300">Active Ability:</strong> {oSeq.ability}</div>
                        <div className="text-slate-300"><strong className="text-emerald-300">Acting Condition:</strong> {oSeq.acting}</div>
                      </>
                    )}
                  </div>
                );
              })()}
              {boardInspect.type === 'card' && boardInspect.card && (
                <div className="space-y-0.5">
                  <div className="font-bold text-amber-200">{boardInspect.label}: {cardShortName(boardInspect.card)}</div>
                  <div className="text-slate-200">{getCardDescription(boardInspect.card)}</div>
                </div>
              )}
              <button onClick={() => setBoardInspect(null)} className="text-slate-400 hover:text-white shrink-0"><X className="w-4 h-4" /></button>
            </div>
          )}

          {/* CENTER TABLE ARENA */}
          <div className="rounded-2xl border border-amber-500/25 bg-gradient-to-b from-[#161324] to-[#0f0d1a] p-4 shadow-xl space-y-3">
            {/* Table Status Strip */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/10">
              <div className="flex items-center gap-3 text-xs">
                <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-white/10 text-slate-300 font-semibold">
                  Deck: <span className="text-amber-300">{game.deck.length}</span>
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-white/10 text-slate-300 font-semibold">
                  Grave: <span className="text-sky-300">{game.grave.length}</span>
                </span>
                {leadSuit && game.phase === 'TRICK' && (
                  <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 border border-amber-500/30 text-slate-200 font-semibold">
                    Lead: <SuitIcon suit={leadSuit} className="w-3.5 h-3.5" /> {SUIT_META[leadSuit]?.name || 'Major Arcana'}
                  </span>
                )}
              </div>

              {/* Active Round Modifiers */}
              <div className="flex flex-wrap gap-1.5">
                {game.roundMods.invertTrick && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">INVERTED (Low Wins)</span>}
                {game.roundMods.abolishTrump && <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold">TRUMP ABOLISHED</span>}
                {game.roundMods.warDeclared && <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-600/30 text-rose-200 border border-rose-400 font-bold">WAR ACTIVE</span>}
                {game.roundMods.globalImmunity && <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">STRENGTH SHIELD</span>}
                {game.roundMods.spatialLock && <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/40 font-bold">BLOCKS LOCKED</span>}
                {game.roundMods.weatherSwords && <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold">SWORDS TRUMP</span>}
              </div>
            </div>

            {/* DYNAMIC CENTER CONTENT BY PHASE */}
            {game.phase === 'POUCH_ADD' && (
              <div className="py-5 text-center space-y-2.5">
                <div className="text-amber-300 font-serif text-lg font-bold">Start of Round {game.round} (No Start Draw)</div>
                <p className="text-sm text-slate-300 max-w-xl mx-auto">
                  Optionally click 1 card in your <span className="text-amber-300 font-semibold">Hand below</span> to tuck it face-down into your Pouch (numbers for Ascension or a Page Trap), or skip to save your Hand.
                </p>
                <button
                  onClick={() => setGame(prev => startDraftPhase(prev))}
                  className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/15 text-xs font-bold text-slate-200 transition"
                >
                  Done Tucking → Go to Draft
                </button>
              </div>
            )}

            {game.phase === 'DRAFT' && (
              <div className="space-y-3">
                <div className="text-center text-xs uppercase tracking-wider text-amber-300 font-bold">
                  {isHumanDraftTurn ? 'Your Turn — Click 1 Card to Draft into Your Hand' : `Waiting for ${game.players[game.draftOrder[game.draftTurnIdx]]?.name} to draft...`}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3 py-2">
                  {game.centerDraft.map(card => (
                    <TarotCard
                      key={card.uid}
                      card={card}
                      highlight={isHumanDraftTurn}
                      disabled={!isHumanDraftTurn}
                      onClick={() => handleHumanDraft(card)}
                    />
                  ))}
                </div>
                <div className="text-center text-[11px] text-slate-400">
                  The last card remaining becomes the <span className="text-amber-300 font-semibold">Trump Card</span> for this trick.
                </div>
              </div>
            )}

            {(game.phase === 'TRICK' || game.phase === 'TRICK_REWARD' || game.phase === 'ASCEND') && (
              <div className="flex flex-col md:flex-row items-center justify-between gap-4 py-1">
                {/* Trump Card Slot */}
                <div className="flex flex-col items-center gap-1.5 shrink-0">
                  <span className="text-[10px] uppercase tracking-widest text-amber-400 font-bold">Trump Card</span>
                  {game.trumpCard ? (
                    <div title={getCardDescription(game.trumpCard)}><TarotCard card={game.trumpCard} small highlight onClick={() => setBoardInspect({ type: 'card', card: game.trumpCard, label: 'Center Trump Card' })} /></div>
                  ) : (
                    <div className="w-20 h-28 rounded-xl border border-dashed border-slate-700 flex items-center justify-center text-[10px] text-slate-500">
                      Claimed
                    </div>
                  )}
                </div>

                {/* Played Trick Cards */}
                <div className="flex-1 flex flex-wrap items-center justify-center gap-3 min-h-[120px]">
                  {game.trickPlays.length === 0 ? (
                    <div className="text-center text-sm text-slate-400">
                      {game.phase === 'TRICK'
                        ? (isHumanTrickTurn ? 'You lead the trick! Play a Minor Arcana card from your Hand.' : 'Trick starting...')
                        : game.phase === 'ASCEND'
                        ? 'Trick resolved. Spend Pouch ingredients to Ascend, or start the next round.'
                        : 'Trick complete!'}
                    </div>
                  ) : (
                    game.trickPlays.map(play => (
                      <div key={play.playerId} className="flex flex-col items-center gap-1">
                        <span className="text-[11px] font-semibold text-slate-300">
                          {game.players[play.playerId].name}
                          {play.effValue > 0 && <span className="ml-1 text-amber-300">({play.effValue})</span>}
                        </span>
                        <TarotCard
                          card={play.card}
                          onClick={() => setBoardInspect({ type: 'card', card: play.card, label: `Played by ${game.players[play.playerId]?.name}` })}
                          small
                          badge={play.countsAsTrump ? 'TRUMP' : play.isTenOverride ? '10!' : null}
                        />
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* INLINE ACTION BARS FOR REWARD / ASCEND / TARGETING */}
            {isHumanRewardTurn && (
              <div className="rounded-xl bg-amber-950/50 border border-amber-400/60 p-3.5 space-y-2.5">
                <div className="text-sm font-serif font-bold text-amber-200 flex items-center gap-2">
                  <Crown className="w-4 h-4 text-amber-400" /> You Won the Trick! Choose Your Reward:
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setGame(prev => resolveTrickReward(prev, 'take_trump'))}
                    className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition"
                  >
                    Option 1: Take Trump Card ({cardShortName(game.trumpCard)})
                  </button>
                  <button
                    onClick={() => setGame(prev => ({ ...prev, pendingInteraction: { type: 'GAMBLE_SUIT', selected: [] } }))}
                    className="px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs transition"
                  >
                    Option 2: Seer's Suit-Guess Gamble (Scoop All Revealed + Trump!)
                  </button>
                </div>
              </div>
            )}

            {game.phase === 'ASCEND' && (
              <div className="rounded-xl bg-emerald-950/35 border border-emerald-500/40 p-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-slate-200">
                  <span className="font-bold text-emerald-300">Ascension Window:</span> Spend Pouch cards adding up to <span className="font-bold text-amber-300">{human.seq}</span> to reach Sequence {human.seq - 1}.
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={openAscendModal}
                    disabled={!canAscendNow}
                    className={`px-3.5 py-2 rounded-lg font-bold text-xs transition flex items-center gap-1.5 ${
                      canAscendNow
                        ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20'
                        : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" /> {human.ascendedThisRound ? 'Already Ascended' : canAscendNow ? `Ascend to Seq ${human.seq - 1}!` : `Need Sum = ${human.seq}`}
                  </button>
                  <button
                    onClick={() => setGame(prev => advanceToNextRound(prev))}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition flex items-center gap-1"
                  >
                    Next Round <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* HUMAN PLAYER DASHBOARD (PATHWAY + POUCH + HAND) */}
          <div className="rounded-2xl border border-amber-500/30 bg-[#13111f] p-3.5 space-y-3">
            {/* Pathway Header & Ability Button */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 pb-2.5 border-b border-white/10">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2 py-0.5 rounded-lg bg-amber-500 text-slate-950 font-serif font-bold text-xs">
                    Seq {human.seq}
                  </span>
                  <span className="font-serif font-bold text-base text-amber-100">
                    {ROMAN[humanPathway.id]}. {humanPathway.arcana} — {humanSeqData?.name}
                  </span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold flex items-center gap-1 ${
                    human.actingDone
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}>
                    {human.actingDone ? <><CheckCircle2 className="w-3 h-3" /> Potion Digested (+1 Draw)</> : 'Undigested (-3 Hand Penalty)'}
                  </span>
                </div>
                <div className="text-xs text-slate-300">
                  <span className="text-emerald-400 font-semibold">Acting Condition:</span> {humanSeqData?.acting}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleHumanAbility}
                  disabled={human.abilityUsed || !!game.pendingInteraction}
                  title={humanSeqData?.ability}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                    !human.abilityUsed
                      ? 'bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 shadow-lg shadow-amber-500/20'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <Zap className="w-3.5 h-3.5" />
                  {human.abilityUsed
                    ? 'Ability Used'
                    : `${humanSeqData?.name} ${human.actingDone ? '(-1 Sanity Toll)' : '(Free — Undigested)'}`}
                </button>
              </div>
            </div>

            <div className="text-[11px] text-amber-200/90 bg-amber-950/30 border border-amber-500/20 rounded-lg px-2.5 py-1.5">
              <span className="font-bold text-amber-400">Seq {human.seq} Ability (1/turn):</span> {humanSeqData?.ability}
            </div>

            {/* POUCH + HAND */}
            <div className="flex flex-col md:flex-row gap-4">
              {/* Ingredient Pouch */}
              <div className="md:w-56 shrink-0 bg-slate-950/60 rounded-xl p-2.5 border border-amber-500/20 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-300 flex items-center gap-1">
                    <Lock className="w-3.5 h-3.5" /> Your Pouch ({human.pouch.length}/{human.mods.maxPouch || 3})
                  </span>
                  {canAscendNow && game.phase === 'ASCEND' && (
                    <button
                      onClick={openAscendModal}
                      className="text-[10px] px-2 py-0.5 rounded bg-amber-500 text-slate-950 font-bold hover:bg-amber-400"
                    >
                      Ascend!
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 min-h-[76px] items-center">
                  {human.pouch.length === 0 ? (
                    <span className="text-[11px] text-slate-500 italic">Empty — tuck cards here for Ascension or Page Traps.</span>
                  ) : (
                    human.pouch.map(c => {
                      const canDiscardPouch = game.phase === 'POUCH_ADD';
                      return (
                        <button
                          key={c.uid}
                          type="button"
                          disabled={!canDiscardPouch}
                          onClick={() => handleHumanPouchDiscard(c)}
                          title={canDiscardPouch ? `Click to discard ${cardShortName(c)} from Pouch to Grave` : cardShortName(c)}
                          className={`px-2 py-1.5 rounded-lg bg-[#1b172b] border text-xs flex items-center gap-1.5 transition ${
                            canDiscardPouch
                              ? 'border-amber-500/40 hover:border-rose-400 hover:bg-rose-950/50 cursor-pointer'
                              : 'border-amber-500/20 cursor-default'
                          }`}
                        >
                          <SuitIcon suit={c.suit} className="w-3.5 h-3.5" />
                          <span className="font-bold text-slate-100">{c.label || c.roman}</span>
                          {c.rank === 11 && <span className="text-[9px] text-rose-300 font-bold">TRAP</span>}
                          {canDiscardPouch && <X className="w-3 h-3 text-rose-400/80 ml-0.5" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Player Hand */}
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-200">
                    Your Hand ({human.hand.length} / {getHandLimit(human.seq, handLimitMode)} Cap)
                    {human.hand.length <= 1 && <span className="ml-2 text-rose-400 font-bold">⚠ Low Sanity!</span>}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400">
                      Click any card to inspect &amp; choose an action (no forced follow-suit — play any Minor or Major Arcana!)
                    </span>
                    {isHumanTrickTurn && !human.hand.some(c => c.type === 'minor') && (
                      <button
                        onClick={() => setGame(prev => {
                          let s = { ...prev, players: prev.players.map(p => ({ ...p, hand: [...p.hand] })) };
                          const r = drawCardsFromDeck(s, 1);
                          s.deck = r.deck; s.grave = r.grave;
                          if (r.drawn[0]) s.players[0].hand.push(r.drawn[0]);
                          else {
                            s.trickTurnIdx++;
                            if (s.trickTurnIdx >= s.trickOrder.length) {
                              const wp = evaluateTrickWinner(s.trickPlays, s.trumpCard, s.roundMods);
                              s.trickWinnerId = wp ? wp.playerId : 0;
                              s.phase = 'TRICK_REWARD';
                            }
                          }
                          return s;
                        })}
                        className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 font-bold text-[11px]"
                      >
                        No Minor Cards — Draw 1
                      </button>
                    )}
                  </div>
                </div>

                {/* SELECTED CARD INSPECTOR & ACTION BAR */}
                {(() => {
                  const selCard = human.hand.find(c => c.uid === selectedHandUid);
                  if (!selCard) return null;
                  const canPouch = game.phase === 'POUCH_ADD' && selCard.type === 'minor' && human.pouch.length < (human.mods.maxPouch || 3);
                  const canTrick = isHumanTrickTurn;
                  const canInstantChaos = selCard.type === 'major';
                  return (
                    <div className="mb-2.5 p-2.5 rounded-xl bg-slate-900/95 border border-amber-400/50 flex flex-wrap items-center justify-between gap-2 shadow-lg">
                      <div className="flex-1 min-w-[200px]">
                        <div className="text-xs font-bold text-amber-200">{cardShortName(selCard)}</div>
                        <div className="text-[11px] text-slate-300 leading-snug">{getCardDescription(selCard)}</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {canPouch && (
                          <button onClick={() => executeHumanCardAction(selCard, 'pouch')} className="px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-bold">
                            Move to Pouch
                          </button>
                        )}
                        {canTrick && (
                          <button onClick={() => executeHumanCardAction(selCard, 'trick')} className="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-extrabold">
                            Play into Trick
                          </button>
                        )}
                        {canInstantChaos && (
                          <button onClick={() => executeHumanCardAction(selCard, 'instant_chaos')} className="px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-bold">
                            Play Chaos Event
                          </button>
                        )}
                        <button onClick={() => setSelectedHandUid(null)} className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold">
                          Cancel
                        </button>
                      </div>
                    </div>
                  );
                })()}

                <div className="flex flex-wrap gap-2">
                  {human.hand.map(card => {
                    const isSel = selectedHandUid === card.uid;
                    return (
                      <div key={card.uid} title={getCardDescription(card)} className="flex flex-col items-center gap-1">
                        <TarotCard
                          card={card}
                          small
                          selected={isSel}
                          highlight={isSel || isHumanTrickTurn || game.phase === 'POUCH_ADD' || card.type === 'major'}
                          onClick={() => handleHumanCardClick(card)}
                        />
                        <button
                          type="button"
                          onClick={() => handleHumanCardClick(card)}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold transition ${
                            isSel ? 'bg-amber-500 text-slate-950' : 'bg-slate-800/90 hover:bg-slate-700 text-slate-300'
                          }`}
                        >
                          {isSel ? 'Selected' : 'Select'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT SIDEBAR: EVENT CHRONICLE & SHORTHAND NETLIST (3 cols on lg) */}
        <aside className="lg:col-span-3 rounded-2xl border border-white/10 bg-[#12101c] p-3 flex flex-col max-h-[680px]">
          <div className="flex items-center justify-between gap-1.5 pb-2 border-b border-white/10">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-300">
              <ScrollText className="w-4 h-4" /> Chronicle
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => saveGameToHistory(game)}
                className="px-2 py-0.5 rounded bg-indigo-500/20 hover:bg-indigo-500/35 border border-indigo-400/40 text-[10px] font-bold text-indigo-200 transition"
                title="Save this match to Past Game History"
              >
                {historySavedToast ? 'Saved ✓' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => {
                  const copyText = exportLogsToNetlist(game.logs, { fog: true, viewerSeat: 1 })
                    || [...game.logs].reverse().map(e => e.text).join('\n');
                try {
                  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(copyText);
                  else {
                    const ta = document.createElement('textarea');
                    ta.value = copyText;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                  }
                } catch (_) {}
                setNetlistCopied(true);
                setTimeout(() => setNetlistCopied(false), 1800);
              }}
              className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/35 border border-amber-400/40 text-[10px] font-bold text-amber-200 transition"
              title="Copy chronological Shorthand Netlist of this entire match"
            >
              {netlistCopied ? 'Copied ✓' : 'Copy Netlist'}
            </button>
            </div>
          </div>
          <div className="flex items-center gap-1 py-1.5 border-b border-white/5">
            {[['both', 'Both'], ['netlist', 'Netlist'], ['detailed', 'Detailed']].map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setLogViewMode(k)}
                className={`flex-1 py-1 rounded text-[10px] font-bold transition ${
                  logViewMode === k ? 'bg-amber-500 text-slate-950' : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
          {/* Round pages */}
          <div className="flex items-center gap-1 py-1.5 border-b border-white/5 overflow-x-auto">
            <button
              type="button"
              onClick={() => setChronicleRound('latest')}
              className={`shrink-0 px-2 py-1 rounded text-[10px] font-bold transition ${
                chronicleRound === 'latest' ? 'bg-sky-500 text-slate-950' : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              Latest
            </button>
            {roundPages.map(rk => (
              <button
                key={rk}
                type="button"
                onClick={() => setChronicleRound(rk)}
                className={`shrink-0 px-2 py-1 rounded text-[10px] font-bold transition ${
                  chronicleRound === rk ? 'bg-amber-500 text-slate-950' : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                {rk === 0 ? 'Setup' : `R${rk}`}
              </button>
            ))}
          </div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 pt-2 px-0.5">
            {activeChronicleRound === 0 ? 'Setup Page' : `Round ${activeChronicleRound} Page`}
          </div>
          <div className="flex-1 overflow-y-auto space-y-2.5 pt-1.5 pr-1 text-xs">
            {visibleLogs.map(entry => {
                const detailLines = entry.details && entry.details.length > 0 ? entry.details : [{ text: entry.text, tone: entry.tone }];
                const hasPhaseNetlist = entry.headerCode !== undefined;
                return (
                  <div
                    key={entry.id}
                    className={`p-2.5 rounded-lg leading-relaxed border space-y-2 ${
                      entry.tone === 'gold' ? 'bg-amber-950/40 border-amber-500/30 text-amber-200' :
                      entry.tone === 'chaos' ? 'bg-violet-950/50 border-violet-500/40 text-violet-200' :
                      entry.tone === 'danger' ? 'bg-rose-950/40 border-rose-500/30 text-rose-200' :
                      entry.tone === 'emerald' ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-200' :
                      entry.tone === 'info' ? 'bg-sky-950/30 border-sky-500/20 text-sky-200' :
                      'bg-slate-900/60 border-white/5 text-slate-300'
                    }`}
                  >
                    {logViewMode !== 'detailed' && (hasPhaseNetlist || entry.code) && (
                      <div className="font-mono text-[11px] font-bold text-amber-100 bg-black/45 px-2 py-1.5 rounded tracking-wide space-y-1 break-words">
                        {hasPhaseNetlist ? (
                          <>
                            <div className="text-amber-300">{entry.headerCode}</div>
                            {entry.actions && entry.actions.length > 0 && (
                              <div className="text-slate-100 leading-snug whitespace-pre-wrap">
                                {entry.actions.map(a => fogNetlistAction(a, 1)).join(',\n')}
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="whitespace-pre-wrap">{fogNetlistAction(entry.code, 1)}</div>
                        )}
                      </div>
                    )}
                    {logViewMode !== 'netlist' && (
                      <div className="space-y-1 border-t border-white/10 pt-1.5">
                        {detailLines.map((dl, di) => (
                          <div
                            key={di}
                            className={`text-[11px] leading-snug ${
                              dl.tone === 'gold' ? 'text-amber-200' :
                              dl.tone === 'chaos' ? 'text-violet-200' :
                              dl.tone === 'danger' ? 'text-rose-200' :
                              dl.tone === 'emerald' ? 'text-emerald-200' :
                              dl.tone === 'info' ? 'text-sky-200' :
                              'text-slate-300'
                            }`}
                          >
                            • {dl.text}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            {visibleLogs.length === 0 && (
              <div className="text-[11px] text-slate-500 py-4 text-center">No entries on this round page yet.</div>
            )}
          </div>
        </aside>
      </main>

      {/* ==================================================================== */}
      {/* INTERACTION MODALS (TARGETING, INTERRUPT, GAMBLE, ASCEND, CODEX)    */}
      {/* ==================================================================== */}

      {/* 1. TARGET ACTIVE OPPONENT MODAL */}
      {game.pendingInteraction && ['TARGET_CARD', 'TARGET_ABILITY', 'TARGET_CHAOS', 'TARGET_COPIED_ABILITY', 'TARGET_INTERRUPT_SUIT', 'TARGET_INSTANT_FACE'].includes(game.pendingInteraction.type) && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-2xl border border-amber-400/60 bg-[#171425] p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-serif font-bold text-lg text-amber-200">Choose Active Target Opponent</h3>
              <button onClick={() => setGame(prev => ({ ...prev, pendingInteraction: null }))} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-[11px] text-slate-400">Only active opponents this round can be targeted (players who lost their turn are untargetable).</p>
            <div className="space-y-2">
              {opponents.map(opp => {
                const inactive = !!opp.skippedThisRound;
                return (
                  <button
                    key={opp.id}
                    disabled={inactive}
                    onClick={() => {
                      const pi = game.pendingInteraction;
                      setGame(prev => {
                        const clean = { ...prev, pendingInteraction: null };
                        if (pi.type === 'TARGET_CARD') return playTrickCard(clean, 0, pi.card, opp.id);
                        if (pi.type === 'TARGET_CHAOS') return resolveChaosEvent(clean, 0, pi.card, opp.id);
                        if (pi.type === 'TARGET_INSTANT_FACE') {
                          let s = { ...clean, players: clean.players.map(p => ({ ...p, hand: [...p.hand], pouch: [...p.pouch], mods: { ...p.mods } })), deck: [...clean.deck], grave: [...clean.grave], roundMods: { ...clean.roundMods } };
                          s.players[0].hand = s.players[0].hand.filter(c => c.uid !== pi.card.uid);
                          s.logs = addLog(s.logs, `INSTANT! You cast ${cardShortName(pi.card)}.`, 'emerald', instantCastCode(s.players[0], cardCode(pi.card)));
                          applyInstantFaceSuitAction(s, s.players[0], s.players[opp.id], pi.card);
                          s.grave.unshift(pi.card);
                          return s;
                        }
                        if (pi.type === 'TARGET_COPIED_ABILITY') {
                          return executeSequenceAbility(clean, 0, opp.id, pi.copiedTag, 1);
                        }
                        if (pi.type === 'TARGET_INTERRUPT_SUIT') {
                          sfx.shieldBlock();
                          let s = { ...clean, players: clean.players.map(p => ({ ...p, hand: [...p.hand], pouch: [...p.pouch], mods: { ...p.mods } })), deck: [...clean.deck], grave: [...clean.grave], roundMods: { ...clean.roundMods } };
                          s.players[0].hand = s.players[0].hand.filter(c => c.uid !== pi.blockCard.uid);
                          if (pi.attackType === 'sword') s.players[0].mods.pouchImmune = true;
                          if (pi.attackType === 'wand') s.players[0].mods.handImmune = true;
                          s.logs = addLog(s.logs, `INTERRUPT! You played ${cardShortName(pi.blockCard)} to cancel ${s.players[pi.attackerId]?.name}'s ${pi.attackType}!`, 'emerald', instantCastCode(s.players[0], cardCode(pi.blockCard), `block ${pCode(pi.attackerId)}`));
                          applyInstantFaceSuitAction(s, s.players[0], s.players[opp.id], pi.blockCard);
                          s.grave.unshift(pi.blockCard);
                          if (s.players[0].pathwayId === 8 && (s.players[0].seq === 8 || s.players[0].seq === 7)) {
                            s.logs = markActed(s.players[0], s.logs, 'Blocked an attack with Knight/Queen');
                          }
                          if (pi.source === 'chaos_discard') return s;
                          return playTrickCard(s, pi.attackerId, pi.card, 0, true);
                        }
                        return executeSequenceAbility(clean, 0, opp.id);
                      });
                    }}
                    className={`w-full p-3 rounded-xl border flex items-center justify-between transition ${
                      inactive
                        ? 'bg-slate-900/40 border-white/5 opacity-45 cursor-not-allowed'
                        : 'bg-slate-900/90 hover:bg-amber-950/50 border-white/10 hover:border-amber-400'
                    }`}
                  >
                    <div className="text-left">
                      <div className="font-bold text-sm text-slate-100">
                        {opp.name} ({PATHWAYS[opp.pathwayId].arcana}) {inactive && <span className="text-rose-400 text-[11px] ml-1">(Lost Turn — Inactive)</span>}
                      </div>
                      <div className="text-xs text-slate-400">Seq {opp.seq} • Hand: {opp.hand.length} • Pouch: {opp.pouch.length}/{opp.mods?.maxPouch || 3}</div>
                    </div>
                    {!inactive && <ChevronRight className="w-4 h-4 text-amber-400" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 1B. DECK PEEK & REORDER MODAL (SEER / HIGH PRIESTESS) */}
      {game.pendingInteraction?.type === 'DECK_REORDER' && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-2xl border-2 border-amber-400/70 bg-[#171425] p-5 space-y-4 shadow-2xl">
            <h3 className="font-serif font-bold text-lg text-amber-200 flex items-center gap-2">
              <Eye className="w-5 h-5 text-amber-400" /> {game.pendingInteraction.title}
            </h3>
            <p className="text-xs text-slate-300">
              Click any card to move it to the <strong className="text-amber-300">#1 Top of Deck</strong> position, then confirm.
            </p>
            <div className="flex items-center justify-center gap-3 py-2">
              {game.pendingInteraction.cards.map((c, idx) => (
                <div key={c.uid} className="flex flex-col items-center gap-1">
                  <span className="text-[10px] font-bold uppercase text-amber-300">{idx === 0 ? '#1 TOP' : `#${idx + 1}`}</span>
                  <TarotCard
                    card={c}
                    small
                    highlight={idx === 0}
                    onClick={() => {
                      const arr = [...game.pendingInteraction.cards];
                      const [picked] = arr.splice(idx, 1);
                      arr.unshift(picked);
                      setGame(prev => ({ ...prev, pendingInteraction: { ...prev.pendingInteraction, cards: arr } }));
                    }}
                  />
                </div>
              ))}
            </div>
            <button
              onClick={() => {
                const { cards, count } = game.pendingInteraction;
                setGame(prev => {
                  const rest = prev.deck.slice(count);
                  return {
                    ...prev,
                    deck: [...cards, ...rest],
                    pendingInteraction: null,
                    logs: (() => {
                      const beforeCodes = prev.deck.slice(0, count).map(cardCode).join(',');
                      const afterCodes = cards.map(cardCode).join(',');
                      const code = beforeCodes !== afterCodes ? `k^${boardState(`${beforeCodes}>${afterCodes}`)}` : `k^: V(${afterCodes})`;
                      return addLog(prev.logs, `Reordered top ${count} Deck cards to: ${cards.map(cardShortName).join(', ')}.`, 'emerald', code, { appendEffect: true });
                    })()
                  };
                });
              }}
              className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm"
            >
              Confirm Deck Order
            </button>
          </div>
        </div>
      )}

      {/* 1B-2. CHOOSE FROM REVEALED CARDS (ARCHAEOLOGIST EXCAVATE) */}
      {game.pendingInteraction?.type === 'CHOOSE_FROM_CARDS' && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-2xl border-2 border-amber-400/70 bg-[#141425] p-5 space-y-4 shadow-2xl text-center">
            <h3 className="font-serif font-bold text-lg text-amber-200">{game.pendingInteraction.title}</h3>
            <p className="text-xs text-slate-300">Click 1 card to draw into your Hand. The rest return to the bottom of the Deck.</p>
            <div className="flex flex-wrap justify-center gap-3">
              {game.pendingInteraction.cards.map(c => (
                <TarotCard
                  key={c.uid}
                  card={c}
                  small
                  highlight
                  onClick={() => {
                    const { cards, remainderZone } = game.pendingInteraction;
                    setGame(prev => {
                      const rest = cards.filter(x => x.uid !== c.uid);
                      const players = prev.players.map(p => ({ ...p, hand: [...p.hand] }));
                      players[0].hand.push(c);
                      let deck = [...prev.deck];
                      // Remove excavated cards from wherever they currently sit (bottom slice already removed when pending was created)
                      if (remainderZone === 'deck_bottom') deck = [...deck, ...rest];
                      else deck = [...rest, ...deck];
                      return {
                        ...prev,
                        players,
                        deck,
                        pendingInteraction: null,
                        logs: addLog(
                          markActed(players[0], prev.logs, 'Excavated a card from the Deck'),
                          `Archaeologist excavated ${cardShortName(c)}.`,
                          'emerald',
                          `+${cardCode(c)}`,
                          { appendEffect: true }
                        )
                      };
                    });
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 1C. DECK TOP OR BOTTOM MODAL (ASTROLOGER) */}
      {game.pendingInteraction?.type === 'DECK_TOP_OR_BOTTOM' && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-sm w-full rounded-2xl border-2 border-sky-400/70 bg-[#141425] p-5 space-y-4 shadow-2xl text-center">
            <h3 className="font-serif font-bold text-lg text-sky-200">{game.pendingInteraction.title}</h3>
            <div className="flex justify-center"><TarotCard card={game.pendingInteraction.card} highlight /></div>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => setGame(prev => ({
                  ...prev, pendingInteraction: null,
                  logs: addLog(prev.logs, `Kept ${cardShortName(prev.pendingInteraction.card)} on top of Deck.`, 'info', `k^: V(${cardCode(prev.pendingInteraction.card)})`, { appendEffect: true })
                }))}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs"
              >
                Keep on Top
              </button>
              <button
                onClick={() => setGame(prev => {
                  const deck = [...prev.deck];
                  const top = deck.shift();
                  if (top) deck.push(top);
                  return {
                    ...prev, deck, pendingInteraction: null,
                    logs: addLog(prev.logs, `Moved ${cardShortName(top)} to the bottom of the Deck.`, 'info', `k^: V(${cardCode(top)}>k_)`, { appendEffect: true })
                  };
                })}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs"
              >
                Send to Bottom
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 1C-2. STUDENT OF RATIOCINATION CARD SPLIT MODAL */}
      {game.pendingInteraction?.type === 'STUDENT_PICK' && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-2xl border-2 border-amber-400/70 bg-[#141425] p-5 space-y-4 shadow-2xl text-center">
            <h3 className="font-serif font-bold text-lg text-amber-200">Deduce — Pick 1 Card (Opponent Gets the Other)</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col items-center gap-2">
                <span className="text-[11px] font-bold text-rose-300">{game.pendingInteraction.oppName}&apos;s Hand</span>
                <TarotCard card={game.pendingInteraction.oppCard} highlight onClick={() => {
                  const { oppId, oppCard, topCard } = game.pendingInteraction;
                  setGame(prev => {
                    const players = prev.players.map(pl => ({ ...pl, hand: [...pl.hand] }));
                    players[0].hand.push(oppCard);
                    players[oppId].hand.push(topCard);
                    return { ...prev, players, pendingInteraction: null, logs: addLog(prev.logs, `Deduce: You took ${cardShortName(oppCard)}; ${players[oppId].name} took ${cardShortName(topCard)}.`, 'emerald') };
                  });
                }} />
              </div>
              <div className="flex flex-col items-center gap-2">
                <span className="text-[11px] font-bold text-sky-300">Top of Deck</span>
                <TarotCard card={game.pendingInteraction.topCard} highlight onClick={() => {
                  const { oppId, oppCard, topCard } = game.pendingInteraction;
                  setGame(prev => {
                    const players = prev.players.map(pl => ({ ...pl, hand: [...pl.hand] }));
                    players[0].hand.push(topCard);
                    players[oppId].hand.push(oppCard);
                    return { ...prev, players, pendingInteraction: null, logs: addLog(prev.logs, `Deduce: You took ${cardShortName(topCard)}; ${players[oppId].name} took ${cardShortName(oppCard)}.`, 'emerald') };
                  });
                }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 1C-3. WORM OF TIME CHOICE MODAL */}
      {game.pendingInteraction?.type === 'WORM_CHOICE' && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-sm w-full rounded-2xl border-2 border-violet-400/70 bg-[#141425] p-5 space-y-4 shadow-2xl text-center">
            <h3 className="font-serif font-bold text-lg text-violet-200">Worm of Time — Steal Time</h3>
            <p className="text-xs text-slate-300">Choose one penalty for {game.players[game.pendingInteraction.targetId]?.name}:</p>
            <div className="flex gap-2 justify-center">
              <button onClick={() => {
                const tId = game.pendingInteraction.targetId;
                setGame(prev => {
                  const players = prev.players.map(pl => ({ ...pl, hand: [...pl.hand] }));
                  const grave = [...prev.grave];
                  if (players[tId].hand.length > 0) grave.unshift(players[tId].hand.pop());
                  players[0].actingDone = true;
                  return { ...prev, players, grave, pendingInteraction: null, logs: addLog(prev.logs, `Worm of Time forced ${players[tId].name} to discard 1 card!`, 'danger') };
                });
              }} className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs">Force Discard 1</button>
              <button onClick={() => {
                const tId = game.pendingInteraction.targetId;
                setGame(prev => {
                  const players = prev.players.map(pl => ({ ...pl }));
                  players[tId].skipNextTurn = true;
                  players[0].actingDone = true;
                  return { ...prev, players, pendingInteraction: null, logs: addLog(prev.logs, `Worm of Time stole ${players[tId].name}'s next turn!`, 'danger') };
                });
              }} className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs">Skip Next Turn</button>
            </div>
          </div>
        </div>
      )}

      {/* 1D. GRAVE PICK MODAL (MYSTERY PRYER / CORPSE COLLECTOR / DETECTIVE) */}
      {game.pendingInteraction?.type === 'GRAVE_PICK' && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-2xl border-2 border-sky-400/70 bg-[#131424] p-5 space-y-4 shadow-2xl text-center">
            <h3 className="font-serif font-bold text-lg text-sky-200">{game.pendingInteraction.title}</h3>
            <div className="flex flex-wrap justify-center gap-3">
              {game.pendingInteraction.cards.map(c => (
                <TarotCard
                  key={c.uid}
                  card={c}
                  small
                  highlight
                  onClick={() => {
                    setGame(prev => {
                      let s = {
                        ...prev,
                        players: prev.players.map(p => ({ ...p, hand: [...p.hand] })),
                        grave: prev.grave.filter(x => x.uid !== c.uid),
                        pendingInteraction: null
                      };
                      s.players[0].hand.push(c);
                      s.logs = addLog(s.logs, `Retrieved ${cardShortName(c)} from the Grave!`, 'emerald');
                      s.logs = markActed(s.players[0], s.logs, 'Retrieved a card from the Grave');
                      return s;
                    });
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 1E. HAND SWAP WITH TRUMP MODAL (FOOL CHAOS / APPRENTICE) */}
      {game.pendingInteraction?.type === 'HAND_SWAP_TRUMP' && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-lg w-full rounded-2xl border-2 border-amber-400/70 bg-[#171425] p-5 space-y-4 shadow-2xl text-center">
            <h3 className="font-serif font-bold text-lg text-amber-200">{game.pendingInteraction.title}</h3>
            <p className="text-xs text-slate-300">Current Trump Card: <strong className="text-amber-300">{cardShortName(game.trumpCard)}</strong> (moves to your Hand).</p>
            <div className="flex flex-wrap justify-center gap-2">
              {game.pendingInteraction.cards.map(c => (
                <TarotCard
                  key={c.uid}
                  card={c}
                  small
                  highlight
                  onClick={() => {
                    const markAct = game.pendingInteraction.markAct;
                    setGame(prev => {
                      let s = {
                        ...prev,
                        players: prev.players.map(p => ({ ...p, hand: [...p.hand] })),
                        roundMods: { ...prev.roundMods, trumpChanged: true },
                        pendingInteraction: null
                      };
                      s.players[0].hand = s.players[0].hand.filter(x => x.uid !== c.uid);
                      if (s.trumpCard) s.players[0].hand.push(s.trumpCard);
                      s.trumpCard = c;
                      s.logs = addLog(s.logs, `Swapped Trump Card to ${cardShortName(c)}!`, 'gold');
                      if (markAct) s.logs = markActed(s.players[0], s.logs, 'Swapped with the Trump Card');
                      return s;
                    });
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 1F. JUDGE FORBID SUIT MODAL */}
      {game.pendingInteraction?.type === 'FORBID_SUIT' && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-sm w-full rounded-2xl border-2 border-amber-400/70 bg-[#171425] p-5 space-y-4 shadow-2xl text-center">
            <h3 className="font-serif font-bold text-lg text-amber-200">{game.pendingInteraction.title}</h3>
            <div className="grid grid-cols-2 gap-2">
              {SUITS.map(suit => (
                <button
                  key={suit}
                  onClick={() => setGame(prev => {
                    let s = { ...prev, roundMods: { ...prev.roundMods, forbidSuit: suit, forbidOwner: 0 }, pendingInteraction: null };
                    s.logs = addLog(s.logs, `PROHIBITION! You forbade ${SUIT_META[suit].name} for this trick!`, 'gold');
                    s.logs = markActed(s.players[0], s.logs, `Prohibited ${SUIT_META[suit].name}`);
                    return s;
                  })}
                  className={`p-3 rounded-xl border flex items-center justify-center gap-2 font-bold text-xs ${SUIT_META[suit].bg} ${SUIT_META[suit].border} hover:border-amber-300`}
                >
                  <SuitIcon suit={suit} className="w-4 h-4" /> {SUIT_META[suit].name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 2. INTERRUPT REACTION MODAL — Knight (swords) / Queen (wands) only when you hold that face */}
      {game.pendingInteraction?.type === 'INTERRUPT' && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-lg w-full rounded-2xl border-2 border-rose-500/70 bg-[#1a1220] p-5 space-y-4 shadow-2xl text-center">
            <Shield className="w-12 h-12 text-amber-400 mx-auto" />
            <h3 className="font-serif font-bold text-xl text-amber-100">Incoming Attack — Interrupt? ({interruptSecLeft}s)</h3>
            <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full bg-amber-400 transition-all duration-1000" style={{ width: `${Math.max(0, (interruptSecLeft / 5) * 100)}%` }} />
            </div>
            <p className="text-sm text-slate-300">
              <span className="font-bold text-rose-300">{game.players[game.pendingInteraction.attackerId].name}</span> played{' '}
              <span className="font-bold text-amber-200">{cardShortName(game.pendingInteraction.card)}</span> targeting you!
              {game.pendingInteraction.attackType === 'sword'
                ? ' Knight blocks only on Swords; Paper Figurine is optional if charged.'
                : ' Queen blocks only on Wands.'}
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {(game.pendingInteraction.blockCards || []).filter(Boolean).map(bc => (
                <button
                  key={bc.uid}
                  onClick={() => handleInterruptDecision('block', bc)}
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition"
                >
                  Block with {cardShortName(bc)}
                </button>
              ))}
              {game.pendingInteraction.canFigurine && (
                <button
                  onClick={() => handleInterruptDecision('figurine')}
                  className="px-4 py-2.5 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-bold text-xs transition"
                >
                  Paper Figurine (Hand ↔ Bag)
                </button>
              )}
              {(game.pendingInteraction.instantMajors || []).map(mc => (
                <button
                  key={mc.uid}
                  onClick={() => handleInterruptDecision('major', mc)}
                  className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs transition"
                >
                  Instant {cardShortName(mc)}
                </button>
              ))}
              {game.pendingInteraction.canAbility && (
                <button
                  onClick={() => handleInterruptDecision('ability')}
                  className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition"
                >
                  Instant Seq Ability
                </button>
              )}
              <button
                onClick={() => handleInterruptDecision('pass')}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition"
              >
                Pass & Take Hit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2A. PAPER FIGURINE — choose Hand card + Bag card to swap */}
      {game.pendingInteraction?.type === 'FIGURINE_SWAP' && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-2xl w-full rounded-2xl border-2 border-fuchsia-500/70 bg-[#1a1220] p-5 space-y-4 shadow-2xl">
            <h3 className="font-serif font-bold text-lg text-fuchsia-200 text-center">Paper Figurine — Swap 1 Hand ↔ 1 Bag</h3>
            <p className="text-xs text-slate-300 text-center">Select one card from each zone to block the Sword. Figurine charge is spent.</p>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-amber-300 font-bold mb-2">Hand</div>
                <div className="flex flex-wrap gap-2">
                  {human.hand.map(c => {
                    const sel = game.pendingInteraction.handUid === c.uid;
                    return (
                      <TarotCard
                        key={c.uid}
                        card={c}
                        small
                        selected={sel}
                        highlight={sel}
                        onClick={() => setGame(prev => ({
                          ...prev,
                          pendingInteraction: { ...prev.pendingInteraction, handUid: c.uid }
                        }))}
                      />
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-sky-300 font-bold mb-2">Bag</div>
                <div className="flex flex-wrap gap-2">
                  {human.pouch.map(c => {
                    const sel = game.pendingInteraction.bagUid === c.uid;
                    return (
                      <TarotCard
                        key={c.uid}
                        card={c}
                        small
                        selected={sel}
                        highlight={sel}
                        onClick={() => setGame(prev => ({
                          ...prev,
                          pendingInteraction: { ...prev.pendingInteraction, bagUid: c.uid }
                        }))}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-center">
              <button
                disabled={!game.pendingInteraction.handUid || !game.pendingInteraction.bagUid}
                onClick={() => {
                  const { attackerId, card, handUid, bagUid } = game.pendingInteraction;
                  setGame(prev => {
                    let s = {
                      ...prev,
                      pendingInteraction: null,
                      players: prev.players.map(p => ({ ...p, hand: [...p.hand], pouch: [...p.pouch], mods: { ...p.mods } })),
                      grave: [...prev.grave],
                      deck: [...prev.deck],
                      roundMods: { ...prev.roundMods }
                    };
                    const me = s.players[0];
                    const hIdx = me.hand.findIndex(c => c.uid === handUid);
                    const bIdx = me.pouch.findIndex(c => c.uid === bagUid);
                    if (hIdx === -1 || bIdx === -1 || !me.mods.clownFigurine) {
                      return playTrickCard(s, attackerId, card, 0, true);
                    }
                    const fromH = me.hand[hIdx];
                    const fromB = me.pouch[bIdx];
                    me.hand[hIdx] = fromB;
                    me.pouch[bIdx] = fromH;
                    me.mods.clownFigurine = false;
                    sfx.shieldBlock();
                    s.logs = addLog(
                      s.logs,
                      `Paper Figurine! You swapped ${cardShortName(fromB)} (Bag) with ${cardShortName(fromH)} (Hand).`,
                      'emerald',
                      instantCastCode(me, 'figurine', `/B↔H(${cardCode(fromB)}↔${cardCode(fromH)})`)
                    );
                    if (me.pathwayId === 0 && me.seq === 8) s.logs = markActed(me, s.logs, 'Survived a Sword with Paper Figurine');
                    // Temporarily immune so resumed Sword does not destroy Bag after the swap-block
                    me.mods.pouchImmune = true;
                    s = playTrickCard(s, attackerId, card, 0, true);
                    if (s.players?.[0]) s.players[0].mods = { ...s.players[0].mods, pouchImmune: false };
                    return s;
                  });
                }}
                className="px-4 py-2.5 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 disabled:bg-slate-800 text-white font-bold text-xs"
              >
                Confirm Swap & Block
              </button>
              <button
                onClick={() => {
                  const { attackerId, card } = game.pendingInteraction;
                  setGame(prev => playTrickCard({ ...prev, pendingInteraction: null }, attackerId, card, 0, true));
                }}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs"
              >
                Cancel — Take Hit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2B. INTERACTIVE HUMAN CHOOSE-DISCARD MODAL */}
      {game.pendingInteraction?.type === 'CHOOSE_DISCARD' && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-2xl w-full rounded-2xl border-2 border-amber-400/70 bg-[#171425] p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-serif font-bold text-lg text-amber-200">
                Choose {game.pendingInteraction.count} Card{game.pendingInteraction.count > 1 ? 's' : ''} to Discard
              </h3>
              <span className="text-xs font-bold text-amber-300">
                Selected: {(game.pendingInteraction.selectedUids || []).length} / {game.pendingInteraction.count}
              </span>
            </div>
            <p className="text-xs text-slate-300">{game.pendingInteraction.reason}</p>
            <div className="flex flex-wrap gap-2 justify-center py-2 max-h-64 overflow-y-auto">
              {human.hand.map(c => {
                const sel = (game.pendingInteraction.selectedUids || []).includes(c.uid);
                return (
                  <TarotCard
                    key={c.uid}
                    card={c}
                    small
                    selected={sel}
                    highlight={sel}
                    onClick={() => {
                      setGame(prev => {
                        const pi = prev.pendingInteraction;
                        if (!pi || pi.type !== 'CHOOSE_DISCARD') return prev;
                        const cur = pi.selectedUids || [];
                        const next = cur.includes(c.uid)
                          ? cur.filter(u => u !== c.uid)
                          : (cur.length < pi.count ? [...cur, c.uid] : [...cur.slice(1), c.uid]);
                        return { ...prev, pendingInteraction: { ...pi, selectedUids: next } };
                      });
                    }}
                  />
                );
              })}
            </div>
            <button
              disabled={(game.pendingInteraction.selectedUids || []).length !== game.pendingInteraction.count}
              onClick={() => {
                const pi = game.pendingInteraction;
                setGame(prev => {
                  const chosenSet = new Set(pi.selectedUids || []);
                  const discarded = prev.players[0].hand.filter(c => chosenSet.has(c.uid));
                  let s = {
                    ...prev,
                    pendingInteraction: null,
                    players: prev.players.map((p, idx) => idx === 0 ? { ...p, hand: p.hand.filter(c => !chosenSet.has(c.uid)), lostCardThisRound: true } : { ...p }),
                    grave: [...discarded, ...prev.grave],
                    logs: addLog(
                      prev.logs,
                      `You discarded ${discarded.map(cardShortName).join(', ')} to the Grave.`,
                      'muted',
                      pi.appendEffect
                        ? `${pi.effectPrefix ?? ''}${discarded.map(c => '-' + cardCode(c)).join(',')}`
                        : `#1: (${discarded.map(c => '-' + cardCode(c)).join(',')})`,
                      pi.appendEffect ? { appendEffect: true } : {}
                    )
                  };
                  if (pi.afterAction === 'NEXT_ROUND') return advanceToNextRound(s);
                  if (pi.afterAction === 'TARGET_ABILITY') {
                    // Already paid recast discard; temporarily set abilityCastsThisSeq = 0 so executeSequenceAbility doesn't double-charge!
                    s.players[0] = { ...s.players[0], _recastPrepaid: true };
                    return { ...s, pendingInteraction: { type: 'TARGET_ABILITY' } };
                  }
                  if (pi.afterAction === 'CAST_ABILITY') {
                    s.players[0] = { ...s.players[0], _recastPrepaid: true };
                    return executeSequenceAbility(s, 0, pi.needsTarget ? 1 : null);
                  }
                  return s;
                });
              }}
              className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold text-sm transition"
            >
              Confirm Discard ({(game.pendingInteraction.selectedUids || []).length}/{game.pendingInteraction.count})
            </button>
          </div>
        </div>
      )}

      {/* 3. SEER'S SUIT-GUESS GAMBLE MODAL */}
      {game.pendingInteraction?.type === 'GAMBLE_SUIT' && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-2xl border border-violet-400/70 bg-[#161326] p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-serif font-bold text-lg text-violet-200">Seer's Suit-Guess Gamble</h3>
              <button onClick={() => setGame(prev => ({ ...prev, pendingInteraction: null }))} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-300">
              Guess the Suit of the next Minor Arcana on top of the Deck. If right, you keep <span className="text-emerald-300 font-bold">all revealed cards (including Major Arcana!) + the Trump Card</span>. If wrong, they all go to the Grave.
              {human.mods.luckyTwoSuits && <span className="block mt-1 text-amber-300 font-bold">Lucky One Active: Pick up to 2 Suits!</span>}
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              {SUITS.map(suit => {
                const maxPick = human.mods.luckyTwoSuits ? 2 : 1;
                const sel = game.pendingInteraction.selected || [];
                const isSel = sel.includes(suit);
                return (
                  <button
                    key={suit}
                    onClick={() => {
                      if (maxPick === 1) {
                        setGame(prev => resolveTrickReward({ ...prev, pendingInteraction: null }, 'gamble', [suit]));
                      } else {
                        const next = isSel ? sel.filter(x => x !== suit) : [...sel, suit].slice(-2);
                        setGame(prev => ({ ...prev, pendingInteraction: { type: 'GAMBLE_SUIT', selected: next } }));
                      }
                    }}
                    className={`p-3 rounded-xl border flex items-center justify-center gap-2 font-bold text-sm transition ${
                      isSel ? 'border-amber-400 bg-amber-500/20 text-amber-200' : `${SUIT_META[suit].bg} ${SUIT_META[suit].border} text-slate-100 hover:border-amber-300`
                    }`}
                  >
                    <SuitIcon suit={suit} className="w-5 h-5" /> {SUIT_META[suit].name}
                  </button>
                );
              })}
            </div>
            {human.mods.luckyTwoSuits && (
              <button
                disabled={(game.pendingInteraction.selected || []).length === 0}
                onClick={() => {
                  const chosen = game.pendingInteraction.selected;
                  setGame(prev => resolveTrickReward({ ...prev, pendingInteraction: null }, 'gamble', chosen));
                }}
                className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 text-slate-950 font-bold text-sm"
              >
                Confirm Gamble
              </button>
            )}
          </div>
        </div>
      )}

      {/* 4. ASCENSION POTION BREWING MODAL */}
      {showAscendModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-lg w-full rounded-2xl border-2 border-amber-400/70 bg-[#171324] p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-serif font-bold text-xl text-amber-200">
                Brew Sequence {human.seq - 1} Potion
              </h3>
              <button onClick={() => setShowAscendModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-xs text-slate-300 space-y-1">
              <div>Select numbered cards from your {human.mods.handAscend ? 'Pouch or Hand' : 'Pouch'} adding up to <span className="text-amber-300 font-bold text-sm">{human.seq}</span>.</div>
              <div className={human.actingDone ? 'text-emerald-300 font-semibold' : 'text-rose-300 font-semibold'}>
                {human.actingDone
                  ? '✓ Potion Digested: Safe Ascension (+1 Bonus Draw)!'
                  : '⚠ Potion Undigested: Reckless Ascension will force you to discard 3 Hand cards!'}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 justify-center py-2">
              {ascendPool.map(card => (
                <TarotCard
                  key={card.uid}
                  card={card}
                  small
                  selected={ascendSelectedUids.includes(card.uid)}
                  disabled={!isNumberCard(card)}
                  onClick={() => toggleAscendCard(card.uid)}
                />
              ))}
            </div>

            <div className="flex items-center justify-between bg-slate-950/70 rounded-xl px-3.5 py-2.5 border border-white/10 text-xs">
              <span>Selected Sum: <strong className="text-amber-300 text-sm">{ascendCheck.sum}</strong> / Target: <strong className="text-amber-300 text-sm">{human.seq}</strong></span>
              <span className={ascendCheck.valid ? 'text-emerald-400 font-bold' : 'text-slate-400'}>
                {ascendCheck.valid ? 'Recipe Valid ✓' : 'Select cards matching target'}
              </span>
            </div>

            <button
              onClick={confirmHumanAscension}
              disabled={!ascendCheck.valid}
              className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold text-sm transition"
            >
              Drink Potion & Ascend to Sequence {human.seq - 1}
            </button>
          </div>
        </div>
      )}

      {/* 5. GRAVE INSPECTOR MODAL */}
      {showGrave && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-2xl w-full max-h-[80vh] flex flex-col rounded-2xl border border-sky-500/40 bg-[#12111d] p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h3 className="font-serif font-bold text-lg text-sky-200 flex items-center gap-2">
                <Skull className="w-5 h-5 text-sky-400" /> The Grave ({game.grave.length} cards — Top First)
              </h3>
              <button onClick={() => setShowGrave(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto pt-3 flex flex-wrap gap-2 justify-center">
              {game.grave.length === 0 ? (
                <div className="text-slate-500 text-sm py-8">The Grave is currently empty.</div>
              ) : (
                game.grave.map((c, idx) => (
                  <TarotCard key={`${c.uid}_${idx}`} card={c} small badge={idx === 0 ? 'TOP' : null} />
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 6. COMPREHENSIVE 5-TAB RULEBOOK & GLOSSARY MODAL */}
      {renderRulebookModal()}
    </div>
  );
}
