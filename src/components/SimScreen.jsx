import { Sparkles, Play, X, Shuffle, Trophy, RotateCcw, Eye } from 'lucide-react';
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
    nnDifficulty,
    tableSortKey,
    setTableSortKey,
    tableSortDir,
    setTableSortDir,
    simBatchSize,
    setSimBatchSize,
    rrSeedsCount,
    setRrSeedsCount,
    showPathwayFilter,
    setShowPathwayFilter,
    startWatchMatch
  } = props;

const nn = getActiveNN();
const isRR = simSubTab === 'rr';
const rawStats = isRR ? rrStats : simStats;
const isFiltered = selectedPathwayFilter.size < 22;

// Recompute ALL page stats strictly from games where EVERY participating Pathway is included in the filter!
let activeStats = rawStats;
if (isFiltered && rawStats.records) {
  const fPs = makeEmptyPathwayStats();
  const fMat = isRR ? makeEmptyMatrix() : null;
  let games = 0, nnWins = 0, p1Wins = 0, p2Wins = 0, draws = 0, seq0Wins = 0, totalRounds = 0, comebacks = 0;
  let digested = 0, undigested = 0, handSum = 0, pouchSum = 0, graveSum = 0;

  for (const rec of rawStats.records) {
    if (!rec.players.every(pl => selectedPathwayFilter.has(pl.pathwayId))) continue;
    games++;
    totalRounds += rec.rounds;
    digested += rec.digested;
    undigested += rec.undigested;
    handSum += rec.handAvg;
    pouchSum += rec.pouchAvg;
    graveSum += rec.graveAvg;
    if (rec.wonBySeq0) seq0Wins++;
    if (rec.comebackWin) comebacks++;
    if (rec.isDraw) draws++;
    else if (rec.winnerId === 0) { nnWins++; p1Wins++; }
    else p2Wins++;

    if (fMat && rec.players.length >= 2) {
      const a = rec.players[0].pathwayId, b = rec.players[1].pathwayId;
      fMat[a][b].g++;
      if (rec.winnerId === 0) fMat[a][b].w++;
      if (a !== b) {
        fMat[b][a].g++;
        if (rec.winnerId === 1) fMat[b][a].w++;
      }
    }
    for (const fs of rec.players) {
      const ps = fPs[fs.pathwayId];
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
      if (rec.isDraw) ps.draws++;
      else if (fs.id === rec.winnerId) {
        ps.wins++;
        if (rec.wonBySeq0) ps.seq0Wins++;
        if (rec.comebackWin) ps.comebacks++;
      } else ps.losses++;
    }
  }
  activeStats = {
    seedsDone: rawStats.seedsDone, games, nnWins, p1Wins, p2Wins, draws, seq0Wins,
    totalRounds, comebacks, digested, undigested, handSum, pouchSum, graveSum,
    pathwayStats: fPs, matrix: fMat
  };
}

const g = Math.max(1, activeStats.games);
const avgRounds = (activeStats.totalRounds / g).toFixed(1);
const comebackPct = ((activeStats.comebacks / g) * 100).toFixed(1);
const seq0Pct = ((activeStats.seq0Wins / g) * 100).toFixed(1);
const nnWinPct = ((activeStats.nnWins / g) * 100).toFixed(1);
const totalAsc = (activeStats.digested || 0) + (activeStats.undigested || 0);
const digestPct = totalAsc > 0 ? (((activeStats.digested || 0) / totalAsc) * 100).toFixed(0) : '0';

const toggleSort = (key) => {
  if (tableSortKey === key) setTableSortDir(d => d === 'desc' ? 'asc' : 'desc');
  else { setTableSortKey(key); setTableSortDir('desc'); }
};

const toggleFilterPathway = (pid) => {
  setSelectedPathwayFilter(prev => {
    const next = new Set(prev);
    if (next.has(pid)) next.delete(pid);
    else next.add(pid);
    return next;
  });
};

const rows = PATHWAYS.filter(p => selectedPathwayFilter.has(p.id)).map(p => {
  const ps = activeStats.pathwayStats[p.id];
  const pg = Math.max(1, ps.games);
  return {
    ...p,
    games: ps.games,
    wr: ps.games > 0 ? (ps.wins / pg) * 100 : 0,
    drawPct: ps.games > 0 ? ((ps.draws || 0) / pg) * 100 : 0,
    lossPct: ps.games > 0 ? ((ps.losses || 0) / pg) * 100 : 0,
    seq0Wr: ps.games > 0 ? (ps.seq0Wins / pg) * 100 : 0,
    comebacks: ps.comebacks,
    avgSeq: ps.games > 0 ? ps.seqSum / pg : 9,
    lostTurns: ps.games > 0 ? ps.lostTurns / pg : 0,
    tricksWon: ps.games > 0 ? ps.tricksWon / pg : 0,
    abilitiesUsed: ps.games > 0 ? ps.abilitiesUsed / pg : 0,
    chaosUsed: ps.games > 0 ? ps.chaosUsed / pg : 0,
    avgHand: ps.games > 0 ? ps.handSum / pg : 0,
    K: ps.K, Q: ps.Q, N: ps.N, P: ps.P,
    swords: ps.swords, pentacles: ps.pentacles, cups: ps.cups, wands: ps.wands
  };
}).sort((a, b) => {
  const diff = (a[tableSortKey] ?? 0) - (b[tableSortKey] ?? 0);
  return tableSortDir === 'desc' ? -diff : diff;
});

const sortArrow = (k) => tableSortKey === k ? (tableSortDir === 'desc' ? ' ↓' : ' ↑') : '';


  return (
      <div className="min-h-screen bg-[#09080f] text-slate-100 p-4 md:p-6">
        <div className="max-w-7xl mx-auto space-y-4">
          {/* Header & Mode Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-emerald-500/30">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <div className="text-xs uppercase tracking-widest text-emerald-400 font-bold">0% Exploration • Frozen Weights • {roundLimit}-Round Cap</div>
                <h1 className="text-2xl font-serif font-bold text-amber-100">AI Balance Simulator & 22×22 Round Robin</h1>
              </div>
              <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-white/10">
                <button onClick={() => setSimSubTab('sim')} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${!isRR ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>
                  Matchup Simulator
                </button>
                <button onClick={() => setSimSubTab('rr')} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${isRR ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'}`}>
                  22×22 Round Robin (506g/seed)
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={isRR ? resetRrStats : resetSimStatsOnly} disabled={simRunning || rrRunning} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200">
                Clear Stats
              </button>
              <button onClick={() => setScreen('train')} className="px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold">
                NN Training Studio
              </button>
              <button onClick={() => setScreen(game ? 'playing' : 'setup')} className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold">
                {game ? 'Return to Match' : 'Back to Setup'}
              </button>
            </div>
          </div>

          {/* CONTROLS BAR */}
          {!isRR ? (
            <div className="rounded-2xl border border-emerald-500/30 bg-[#13111f] p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5 text-xs">
                <label className="flex items-center gap-1.5">
                  <span className="text-slate-400 font-semibold">Players:</span>
                  <select value={simPlayerCount} onChange={e => setSimPlayerCount(Number(e.target.value))} disabled={simRunning} className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-100 font-bold">
                    {[2, 3, 4].map(n => <option key={n} value={n}>{n}P</option>)}
                  </select>
                </label>
                {Array.from({ length: simPlayerCount }, (_, sIdx) => (
                  <label key={sIdx} className="flex items-center gap-1">
                    <span className={`font-bold ${sIdx === 0 ? 'text-emerald-400' : 'text-violet-300'}`}>P{sIdx + 1}:</span>
                    <select
                      value={simSeatBrains[sIdx]}
                      onChange={e => {
                        const val = e.target.value;
                        setSimSeatBrains(prev => prev.map((x, idx) => idx === sIdx ? val : x));
                      }}
                      disabled={simRunning}
                      className={`bg-slate-900 border rounded-lg px-2 py-1.5 font-bold ${sIdx === 0 ? 'border-emerald-500/40 text-emerald-200' : 'border-violet-500/35 text-violet-200'}`}
                    >
                      <option value="nn_small">NN Small (16→8)</option>
                      <option value="nn_medium">NN Medium (40→20)</option>
                      <option value="nn_large">NN Large (100→40)</option>
                      <option value="heuristic_6">Heuristic Depth 6</option>
                      <option value="heuristic_5">Heuristic Depth 5</option>
                      <option value="heuristic_4">Heuristic Depth 4</option>
                      <option value="heuristic_3">Heuristic Depth 3</option>
                      <option value="heuristic_2">Heuristic Depth 2</option>
                      <option value="heuristic_1">Heuristic Depth 1</option>
                    </select>
                  </label>
                ))}
                <label className="flex items-center gap-1.5">
                  <span className="text-slate-400 font-semibold">Cap:</span>
                  <select value={handLimitMode} onChange={e => setHandLimitMode(e.target.value)} className="bg-slate-900 border border-amber-500/40 rounded-lg px-2 py-1.5 text-amber-300 font-bold">
                    <option value="10-7">10→7</option>
                    <option value="7-5">7→5</option>
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <label className="flex items-center gap-1.5">
                  <span className="text-slate-400 font-semibold">Games:</span>
                  <input
                    type="number"
                    min="1"
                    max="50000"
                    value={simBatchSize}
                    onChange={e => setSimBatchSize(e.target.value)}
                    disabled={simRunning}
                    className="w-24 bg-slate-900 border border-emerald-500/40 rounded-lg px-2 py-1.5 text-emerald-300 font-bold outline-none focus:border-emerald-300"
                  />
                </label>
                <button
                  disabled={simRunning}
                  onClick={() => runSimBatch(simBatchSize)}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 text-white font-bold text-xs flex items-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5" /> Run {Math.max(1, Number(simBatchSize) || 1000)} Games
                </button>
                <button
                  disabled={simRunning || typeof startWatchMatch !== 'function'}
                  onClick={() => startWatchMatch(simSeatBrains[0], simSeatBrains[1])}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white font-bold text-xs flex items-center gap-1.5"
                  title="Live-spectate one game; save netlist for Replay when it ends"
                >
                  <Eye className="w-3.5 h-3.5" /> Watch 1 Match
                </button>
                {simRunning && (
                  <button
                    onClick={() => { stopSimRef.current = true; }}
                    className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs"
                  >
                    Stop
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-amber-500/40 bg-[#13111f] p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <label className="flex items-center gap-1.5">
                  <span className="text-slate-400 font-semibold">Random Seeds (×506 games):</span>
                  <input type="number" min="1" max="20" value={rrSeedsCount} onChange={e => setRrSeedsCount(e.target.value)} disabled={rrRunning} className="w-16 bg-slate-900 border border-amber-500/40 rounded-lg px-2 py-1.5 text-amber-300 font-bold" />
                </label>
                <label className="flex items-center gap-1.5">
                  <span className="text-emerald-400 font-bold">P1:</span>
                  <select value={simP1Brain} onChange={e => setSimP1Brain(e.target.value)} disabled={rrRunning} className="bg-slate-900 border border-emerald-500/40 rounded-lg px-2 py-1.5 text-emerald-200 font-bold">
                    <option value="nn_small">NN Small (16→8)</option>
                    <option value="nn_medium">NN Medium (40→20)</option>
                    <option value="nn_large">NN Large (100→40)</option>
                    <option value="heuristic_6">Heuristic Depth 6</option>
                    <option value="heuristic_5">Heuristic Depth 5</option>
                    <option value="heuristic_4">Heuristic Depth 4</option>
                    <option value="heuristic_3">Heuristic Depth 3</option>
                    <option value="heuristic_2">Heuristic Depth 2</option>
                    <option value="heuristic_1">Heuristic Depth 1</option>
                  </select>
                </label>
                <span className="text-slate-500 font-bold">vs</span>
                <label className="flex items-center gap-1.5">
                  <span className="text-violet-400 font-bold">P2:</span>
                  <select value={simP2Brain} onChange={e => setSimP2Brain(e.target.value)} disabled={rrRunning} className="bg-slate-900 border border-violet-500/40 rounded-lg px-2 py-1.5 text-violet-200 font-bold">
                    <option value="nn_small">NN Small (16→8)</option>
                    <option value="nn_medium">NN Medium (40→20)</option>
                    <option value="nn_large">NN Large (100→40)</option>
                    <option value="heuristic_6">Heuristic Depth 6</option>
                    <option value="heuristic_5">Heuristic Depth 5</option>
                    <option value="heuristic_4">Heuristic Depth 4</option>
                    <option value="heuristic_3">Heuristic Depth 3</option>
                    <option value="heuristic_2">Heuristic Depth 2</option>
                    <option value="heuristic_1">Heuristic Depth 1</option>
                  </select>
                </label>
                <label className="flex items-center gap-1.5">
                  <span className="text-slate-400 font-semibold">Hand Cap:</span>
                  <select value={handLimitMode} onChange={e => setHandLimitMode(e.target.value)} disabled={rrRunning} className="bg-slate-900 border border-amber-500/40 rounded-lg px-2 py-1.5 text-amber-300 font-bold">
                    <option value="10-7">10→7</option>
                    <option value="7-5">7→5</option>
                  </select>
                </label>
              </div>
              <div className="flex items-center gap-2">
                <button disabled={rrRunning} onClick={() => runRoundRobin(rrSeedsCount)} className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 text-slate-950 font-bold text-xs flex items-center gap-1.5">
                  <Play className="w-3.5 h-3.5" /> Run {Math.max(1, Number(rrSeedsCount) || 1)} Seed(s) ({(Math.max(1, Number(rrSeedsCount) || 1)) * 506} Games)
                </button>
                {rrRunning && (
                  <button onClick={() => { stopRrRef.current = true; }} className="px-3 py-2 rounded-xl bg-rose-600 text-white font-bold text-xs">Stop</button>
                )}
              </div>
            </div>
          )}

          {simRunning && !isRR && simProgress.total > 0 && (
            <div className="rounded-xl bg-emerald-950/40 border border-emerald-500/40 p-3 space-y-1.5">
              <div className="flex justify-between text-xs font-bold text-emerald-200">
                <span>Simulation Progress: {simProgress.done} / {simProgress.total} games</span>
                <span>{Math.round((simProgress.done / simProgress.total) * 100)}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-900 overflow-hidden">
                <div className="h-full bg-emerald-400 transition-all" style={{ width: `${(simProgress.done / simProgress.total) * 100}%` }} />
              </div>
            </div>
          )}

          {rrRunning && rrProgress.total > 0 && (
            <div className="rounded-xl bg-amber-950/40 border border-amber-500/40 p-3 space-y-1.5">
              <div className="flex justify-between text-xs font-bold text-amber-200">
                <span>22×22 Round Robin Progress: {rrProgress.done} / {rrProgress.total} games (Paired Same-Seed Decks)</span>
                <span>{Math.round((rrProgress.done / rrProgress.total) * 100)}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-900 overflow-hidden">
                <div className="h-full bg-amber-400 transition-all" style={{ width: `${(rrProgress.done / rrProgress.total) * 100}%` }} />
              </div>
            </div>
          )}

          {/* KPI STRIP */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            <div className="p-3 rounded-xl bg-[#141220] border border-white/10">
              <div className="text-[10px] uppercase text-slate-400 font-bold">Games Evaluated</div>
              <div className="text-xl font-serif font-bold text-amber-300">{activeStats.games}</div>
              <div className="text-[10px] text-slate-400">{isFiltered ? `Filtered from ${rawStats.games} total games` : (isRR ? `${rrStats.seedsDone} full seed(s) done` : `NN Trained: ${nn.gamesTrained} eps`)}</div>
            </div>
            {isRR ? (
              <div className="p-3 rounded-xl bg-[#141220] border border-sky-500/40">
                <div className="text-[10px] uppercase text-sky-300 font-bold">P1 vs P2 Advantage</div>
                <div className="text-sm font-serif font-bold text-slate-100 mt-0.5">
                  P1 <span className="text-emerald-400">{activeStats.games > 0 ? `${((activeStats.p1Wins / g) * 100).toFixed(1)}%` : '—'}</span> • D <span className="text-slate-400">{activeStats.games > 0 ? `${((activeStats.draws / g) * 100).toFixed(1)}%` : '—'}</span> • P2 <span className="text-violet-400">{activeStats.games > 0 ? `${((activeStats.p2Wins / g) * 100).toFixed(1)}%` : '—'}</span>
                </div>
                <div className="text-[10px] text-slate-400">{simP1Brain} vs {simP2Brain}</div>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-[#141220] border border-emerald-500/30">
                <div className="text-[10px] uppercase text-emerald-300 font-bold">Seat 1 (W / D / L)</div>
                <div className="text-sm font-serif font-bold mt-1">
                  <span className="text-emerald-300">{activeStats.games > 0 ? `${nnWinPct}%` : '—'}</span> / <span className="text-slate-400">{activeStats.games > 0 ? `${((activeStats.draws / g) * 100).toFixed(1)}%` : '—'}</span> / <span className="text-rose-300">{activeStats.games > 0 ? `${(((activeStats.games - activeStats.nnWins - activeStats.draws) / g) * 100).toFixed(1)}%` : '—'}</span>
                </div>
                <div className="text-[10px] text-slate-400">{simP1Brain} vs {simP2Brain}</div>
              </div>
            )}
            <div className="p-3 rounded-xl bg-[#141220] border border-amber-500/40">
              <div className="text-[10px] uppercase text-amber-300 font-bold">Seq 0 Win %</div>
              <div className="text-xl font-serif font-bold text-amber-300">{activeStats.games > 0 ? `${seq0Pct}%` : '—'}</div>
              <div className="text-[10px] text-slate-400">{activeStats.seq0Wins}/{activeStats.games} Apotheosis</div>
            </div>
            <div className="p-3 rounded-xl bg-[#141220] border border-white/10">
              <div className="text-[10px] uppercase text-slate-400 font-bold">Avg Game Length</div>
              <div className="text-xl font-serif font-bold text-sky-300">{activeStats.games > 0 ? `${avgRounds} rds` : '—'}</div>
              <div className="text-[10px] text-slate-400">{roundLimit}-round cap</div>
            </div>
            <div className="p-3 rounded-xl bg-[#141220] border border-white/10">
              <div className="text-[10px] uppercase text-slate-400 font-bold">Comeback Rate</div>
              <div className="text-xl font-serif font-bold text-violet-300">{activeStats.games > 0 ? `${comebackPct}%` : '—'}</div>
              <div className="text-[10px] text-slate-400">Won from ≥2 Seq behind</div>
            </div>
            <div className="p-3 rounded-xl bg-[#141220] border border-white/10">
              <div className="text-[10px] uppercase text-slate-400 font-bold">Digested / Zones</div>
              <div className="text-sm font-bold text-amber-200 mt-0.5">{isRR ? `22×22 Paired` : `${digestPct}% Digested`}</div>
              <div className="text-[10px] text-slate-400">{isRR ? `506 games/seed` : `H ${((activeStats.handSum || 0) / g).toFixed(1)} • P ${((activeStats.pouchSum || 0) / g).toFixed(1)} • G ${((activeStats.graveSum || 0) / g).toFixed(1)}`}</div>
            </div>
          </div>

          {/* FULL SORTABLE & FILTERABLE 22-PATHWAY STATS TABLE */}
          <div className="rounded-2xl border border-white/10 bg-[#12101c] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/10 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-bold text-amber-300 uppercase">Comprehensive Pathway Telemetry ({rows.length}/22 Shown)</span>
                <button onClick={() => setShowPathwayFilter(!showPathwayFilter)} className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-200 font-bold text-[11px]">
                  {showPathwayFilter ? 'Hide Pathway Filter' : 'Filter Arcana Pathways'}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Sort by:</span>
                <select value={tableSortKey} onChange={e => setTableSortKey(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100 font-bold">
                  <option value="wr">Win %</option>
                  <option value="drawPct">Draw %</option>
                  <option value="lossPct">Lose %</option>
                  <option value="seq0Wr">Seq 0 %</option>
                  <option value="avgSeq">Avg End Seq</option>
                  <option value="comebacks">Comebacks</option>
                  <option value="tricksWon">Tricks Won / g</option>
                  <option value="lostTurns">Lost Turns / g</option>
                  <option value="abilitiesUsed">Abilities / g</option>
                  <option value="chaosUsed">Chaos / g</option>
                  <option value="avgHand">Avg Hand</option>
                </select>
                <button onClick={() => setTableSortDir(d => d === 'desc' ? 'asc' : 'desc')} className="px-2 py-1 rounded bg-slate-800 text-amber-300 font-bold">
                  {tableSortDir === 'desc' ? '↓ Desc' : '↑ Asc'}
                </button>
              </div>
            </div>

            {showPathwayFilter && (
              <div className="p-3 rounded-xl bg-slate-950/70 border border-white/10 space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <button onClick={() => setSelectedPathwayFilter(new Set(PATHWAYS.map(p => p.id)))} className="px-2 py-1 rounded bg-amber-500 text-slate-950 font-bold text-[11px]">Select All 22</button>
                  <button onClick={() => setSelectedPathwayFilter(new Set())} className="px-2 py-1 rounded bg-slate-800 text-slate-300 font-bold text-[11px]">Clear All</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {PATHWAYS.map(p => {
                    const on = selectedPathwayFilter.has(p.id);
                    return (
                      <button key={p.id} onClick={() => toggleFilterPathway(p.id)} className={`px-2 py-1 rounded-lg border text-[11px] font-semibold transition ${on ? 'bg-amber-500/20 border-amber-400 text-amber-200' : 'bg-slate-900 border-white/10 text-slate-500'}`}>
                        {ROMAN[p.id]}. {p.arcana}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="overflow-x-auto max-h-[440px]">
              <table className="w-full text-left text-[11px] whitespace-nowrap">
                <thead className="sticky top-0 bg-[#12101c] text-[10px] uppercase text-slate-400 border-b border-white/10">
                  <tr>
                    <th className="py-2 pr-2">Pathway</th>
                    <th className="py-2 px-1.5 text-right cursor-pointer hover:text-white" onClick={() => toggleSort('games')}>G{sortArrow('games')}</th>
                    <th className="py-2 px-1.5 text-right cursor-pointer hover:text-white" onClick={() => toggleSort('wr')}>Win%{sortArrow('wr')}</th>
                    <th className="py-2 px-1.5 text-right cursor-pointer hover:text-white" onClick={() => toggleSort('drawPct')}>Draw%{sortArrow('drawPct')}</th>
                    <th className="py-2 px-1.5 text-right cursor-pointer hover:text-white" onClick={() => toggleSort('lossPct')}>Lose%{sortArrow('lossPct')}</th>
                    <th className="py-2 px-1.5 text-right cursor-pointer hover:text-white" onClick={() => toggleSort('seq0Wr')}>Seq0%{sortArrow('seq0Wr')}</th>
                    <th className="py-2 px-1.5 text-right cursor-pointer hover:text-white" onClick={() => toggleSort('avgSeq')}>Seq{sortArrow('avgSeq')}</th>
                    <th className="py-2 px-1.5 text-right cursor-pointer hover:text-white" onClick={() => toggleSort('comebacks')}>Cmbk{sortArrow('comebacks')}</th>
                    <th className="py-2 px-1.5 text-right cursor-pointer hover:text-white" onClick={() => toggleSort('lostTurns')}>LostT/g{sortArrow('lostTurns')}</th>
                    <th className="py-2 px-1.5 text-right cursor-pointer hover:text-white" onClick={() => toggleSort('tricksWon')}>Trk/g{sortArrow('tricksWon')}</th>
                    <th className="py-2 px-1.5 text-right cursor-pointer hover:text-white" onClick={() => toggleSort('abilitiesUsed')}>Abil/g{sortArrow('abilitiesUsed')}</th>
                    <th className="py-2 px-1.5 text-right cursor-pointer hover:text-white" onClick={() => toggleSort('chaosUsed')}>Chs/g{sortArrow('chaosUsed')}</th>
                    <th className="py-2 px-1.5 text-right cursor-pointer hover:text-white" onClick={() => toggleSort('avgHand')}>Hand{sortArrow('avgHand')}</th>
                    <th className="py-2 px-2 text-right">K / Q / N / P</th>
                    <th className="py-2 pl-2 text-right">Swd / Pnt / Cup / Wnd</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {rows.map(r => (
                    <tr key={r.id} className="hover:bg-white/5">
                      <td className="py-1.5 pr-2 font-semibold text-slate-200">{ROMAN[r.id]}. {r.arcana}</td>
                      <td className="py-1.5 px-1.5 text-right text-slate-400">{r.games}</td>
                      <td className="py-1.5 px-1.5 text-right font-bold text-emerald-300">{r.games > 0 ? `${r.wr.toFixed(1)}%` : '—'}</td>
                      <td className="py-1.5 px-1.5 text-right text-slate-400">{r.games > 0 ? `${r.drawPct.toFixed(1)}%` : '—'}</td>
                      <td className="py-1.5 px-1.5 text-right text-rose-300">{r.games > 0 ? `${r.lossPct.toFixed(1)}%` : '—'}</td>
                      <td className="py-1.5 px-1.5 text-right font-bold text-amber-300">{r.games > 0 ? `${r.seq0Wr.toFixed(1)}%` : '—'}</td>
                      <td className="py-1.5 px-1.5 text-right text-sky-300">{r.avgSeq.toFixed(1)}</td>
                      <td className="py-1.5 px-1.5 text-right text-violet-300">{r.comebacks}</td>
                      <td className="py-1.5 px-1.5 text-right text-rose-300">{r.lostTurns.toFixed(2)}</td>
                      <td className="py-1.5 px-1.5 text-right text-slate-200">{r.tricksWon.toFixed(1)}</td>
                      <td className="py-1.5 px-1.5 text-right text-amber-200">{r.abilitiesUsed.toFixed(1)}</td>
                      <td className="py-1.5 px-1.5 text-right text-violet-200">{r.chaosUsed.toFixed(1)}</td>
                      <td className="py-1.5 px-1.5 text-right text-slate-300">{r.avgHand.toFixed(1)}</td>
                      <td className="py-1.5 px-2 text-right text-slate-400 font-mono">{r.K}/{r.Q}/{r.N}/{r.P}</td>
                      <td className="py-1.5 pl-2 text-right text-slate-400 font-mono">{r.swords}/{r.pentacles}/{r.cups}/{r.wands}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 22x22 HEAD-TO-HEAD MATCHUP HEATMAP MATRIX (ROUND ROBIN) */}
          {isRR && (
            <div className="rounded-2xl border border-amber-500/30 bg-[#12101c] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/10 text-xs">
                <div>
                  <span className="font-bold text-amber-300 uppercase">22×22 Head-to-Head Matchup Matrix (Row Win % vs Column)</span>
                  <span className="ml-2 text-[11px] text-slate-400">Hover any cell for exact W/L record • Respects Pathway Filter</span>
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <span className="px-1.5 py-0.5 rounded bg-emerald-600/40 text-emerald-200 border border-emerald-500/40">≥65% Strong</span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-white/10">45–54% Even</span>
                  <span className="px-1.5 py-0.5 rounded bg-rose-600/40 text-rose-200 border border-rose-500/40">&lt;35% Countered</span>
                </div>
              </div>

              <div className="overflow-x-auto max-h-[540px]">
                <table className="border-collapse text-[10px] font-mono">
                  <thead>
                    <tr>
                      <th className="sticky left-0 top-0 z-20 bg-[#12101c] p-1.5 text-left text-amber-300 border-b border-r border-white/15">
                        Row \ Col
                      </th>
                      {PATHWAYS.filter(p => selectedPathwayFilter.has(p.id)).map(colP => (
                        <th
                          key={colP.id}
                          title={`${ROMAN[colP.id]}. ${colP.arcana} (${colP.lotm})`}
                          className="sticky top-0 z-10 bg-[#12101c] px-1 py-1.5 text-center text-slate-300 border-b border-white/15 min-w-[34px]"
                        >
                          {ROMAN[colP.id]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {PATHWAYS.filter(p => selectedPathwayFilter.has(p.id)).map(rowP => (
                      <tr key={rowP.id}>
                        <td
                          title={`${ROMAN[rowP.id]}. ${rowP.arcana} (${rowP.lotm})`}
                          className="sticky left-0 z-10 bg-[#12101c] px-1.5 py-1 font-sans font-semibold text-slate-200 border-r border-b border-white/10 whitespace-nowrap"
                        >
                          {ROMAN[rowP.id]}. {rowP.arcana.replace('The ', '')}
                        </td>
                        {PATHWAYS.filter(p => selectedPathwayFilter.has(p.id)).map(colP => {
                          const cell = activeStats.matrix?.[rowP.id]?.[colP.id] || { w: 0, g: 0 };
                          const pct = cell.g > 0 ? Math.round((cell.w / cell.g) * 100) : null;
                          const isMirror = rowP.id === colP.id;
                          const bgCls = pct === null
                            ? 'bg-slate-950/60 text-slate-600'
                            : pct >= 65 ? 'bg-emerald-600/45 text-emerald-100 font-bold'
                            : pct >= 55 ? 'bg-teal-700/35 text-teal-200'
                            : pct >= 45 ? 'bg-slate-800/70 text-slate-200'
                            : pct >= 35 ? 'bg-amber-700/35 text-amber-200'
                            : 'bg-rose-600/45 text-rose-100 font-bold';
                          return (
                            <td
                              key={colP.id}
                              title={`${ROMAN[rowP.id]}. ${rowP.arcana} vs ${ROMAN[colP.id]}. ${colP.arcana}: ${cell.w}/${cell.g} wins (${pct !== null ? pct + '%' : 'no games'})`}
                              className={`px-1 py-1 text-center border border-white/5 ${bgCls} ${isMirror ? 'ring-1 ring-inset ring-amber-400/50' : ''}`}
                            >
                              {pct !== null ? pct : '·'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
  );
}
