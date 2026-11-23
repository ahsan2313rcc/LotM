import {
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
      <div className="min-h-screen bg-[#09080f] text-slate-100 font-sans p-4 md:p-8 flex flex-col items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(212,175,55,0.12),_transparent_55%)] pointer-events-none" />

        <div className="max-w-5xl w-full relative z-10 space-y-6">
          {/* Title Banner */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold tracking-widest uppercase">
              <Sparkles className="w-3.5 h-3.5" /> Above the Gray Fog — 78-Card Tarot Engine
            </div>
            <h1 className="text-3xl md:text-5xl font-serif font-bold tracking-tight text-amber-100">
              Lord of the Mysteries
            </h1>
            <p className="text-sm md:text-base text-slate-400 max-w-2xl mx-auto">
              Ascend from <span className="text-amber-300 font-semibold">Sequence 9 to Sequence 0</span>. Outsmart rivals in trick-taking clashes, guard your 3-card Ingredient Pouch, digest your Acting Method, and survive 22 Major Arcana Chaos Events.
            </p>
          </div>

          {/* Controls Row */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <div className="flex items-center gap-2 bg-[#14121f] border border-amber-500/25 rounded-xl px-3 py-2">
              <Users className="w-4 h-4 text-amber-400" />
              <span className="text-xs text-slate-300 font-medium">Players:</span>
              {[2, 3, 4].map(cnt => (
                <button
                  key={cnt}
                  onClick={() => onPlayerCount(cnt)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                    playerCount === cnt ? 'bg-amber-500 text-slate-950' : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {cnt}P
                </button>
              ))}
            </div>

            <button
              onClick={() => onTogglePickAny()}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#14121f] border border-amber-500/25 hover:border-amber-400/60 text-xs font-semibold text-amber-200 transition"
            >
              <BookOpen className="w-4 h-4 text-amber-400" />
              {pickAnyMode ? 'Switch to 3 Random Draft' : 'Browse All 22 Pathways'}
            </button>
            <div className="flex items-center gap-1.5 bg-[#14121f] border border-amber-500/25 rounded-xl px-3 py-2">
              <span className="text-xs text-slate-300 font-medium">Max Rds:</span>
              <input
                type="number"
                min="10"
                max="500"
                value={roundLimit}
                onChange={e => onRoundLimit(e.target.value)}
                className="w-16 bg-slate-900 border border-amber-500/40 rounded-lg px-2 py-1 text-xs font-bold text-amber-300 outline-none focus:border-amber-300"
                title="Round limit for Simulator, Round Robin & NN Training"
              />
            </div>

            <div className="flex items-center gap-1.5 bg-[#14121f] border border-amber-500/25 rounded-xl px-3 py-2">
              <span className="text-xs text-slate-300 font-medium">Hand Cap:</span>
              {['10-7', '7-5'].map(m => (
                <button
                  key={m}
                  onClick={() => onHandLimitMode(m)}
                  className={`px-2 py-1 rounded-lg text-xs font-bold transition ${
                    handLimitMode === m ? 'bg-amber-500 text-slate-950' : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {m === '10-7' ? '10→7' : '7→5'}
                </button>
              ))}
            </div>

            <button
              onClick={onOpenLab}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-violet-950/70 border border-violet-400/50 hover:border-violet-300 text-xs font-bold text-violet-200 transition"
            >
              <Zap className="w-4 h-4 text-violet-400" /> Demo Board Lab
            </button>
            <button
              onClick={() => onOpenReplay()}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-indigo-950/70 border border-indigo-400/50 hover:border-indigo-300 text-xs font-bold text-indigo-200 transition"
            >
              <History className="w-4 h-4 text-indigo-400" /> History & Replay {gameHistoryLength > 0 ? `(${gameHistoryLength})` : ''}
            </button>

            <div className="flex items-center gap-2 bg-[#14121f] border border-emerald-500/30 rounded-xl px-3 py-1.5">
              <span className="text-xs text-slate-300 font-medium">Opponents:</span>
              <select
                value={aiBrainMode}
                onChange={e => onAiBrainMode(e.target.value)}
                className="bg-slate-900 border border-emerald-500/40 rounded-lg px-2 py-1 text-xs font-bold text-emerald-300 outline-none focus:border-emerald-300"
                title="Choose which AI or Neural Network brain controls opponents during live play"
              >
                <option value="heuristic_6">Heuristic AI — Depth 6</option>
                <option value="heuristic_5">Heuristic AI — Depth 5</option>
                <option value="heuristic_4">Heuristic AI — Depth 4</option>
                <option value="heuristic_3">Heuristic AI — Depth 3</option>
                <option value="heuristic_2">Heuristic AI — Depth 2</option>
                <option value="heuristic_1">Heuristic AI — Depth 1</option>
                <option value="nn_small">NN Small (16→8)</option>
                <option value="nn_medium">NN Medium (40→20)</option>
                <option value="nn_large">NN Large (100→40)</option>
              </select>
            </div>

            <button
              onClick={() => onOpenTrain()}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-sky-950/70 border border-sky-400/50 hover:border-sky-300 text-xs font-bold text-sky-200 transition"
            >
              <Zap className="w-4 h-4 text-sky-400" /> Train NN (RL)
            </button>

            <button
              onClick={() => onOpenSim()}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-950/70 border border-emerald-400/50 hover:border-emerald-300 text-xs font-bold text-emerald-200 transition"
            >
              <Sparkles className="w-4 h-4 text-emerald-400" /> AI Simulator
            </button>
            <button
              onClick={() => onOpenCodex()}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-950/70 border border-amber-400/50 hover:border-amber-300 text-xs font-bold text-amber-200 transition"
            >
              <BookOpen className="w-4 h-4 text-amber-400" /> Rulebook & Glossary
            </button>

            {!pickAnyMode && (
              <button
                onClick={onRerollDraft}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#14121f] border border-slate-700 hover:border-amber-400/50 text-xs font-semibold text-slate-300 transition"
              >
                <Shuffle className="w-4 h-4 text-amber-400" /> Reroll 3 Fate Cards
              </button>
            )}
          </div>

          {/* Pathway Draft Grid */}
          <div className="space-y-2">
            <h2 className="text-center text-sm uppercase tracking-widest text-amber-400/80 font-semibold">
              {pickAnyMode ? 'Select Any of the 22 Pathways to Begin' : 'Choose Your Major Arcana Pathway (3 Random Options)'}
            </h2>

            <div className={`grid gap-4 ${pickAnyMode ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 max-h-[58vh] overflow-y-auto pr-1' : 'grid-cols-1 md:grid-cols-3'}`}>
              {displayedPathways.map(p => (
                <div
                  key={p.id}
                  className="rounded-2xl border border-amber-500/30 bg-gradient-to-b from-[#181526] to-[#100e1a] hover:border-amber-400/70 p-4 transition-all shadow-xl flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-serif font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        {ROMAN[p.id]}
                      </span>
                      <span className="text-[11px] text-slate-400 font-medium">{p.lever}</span>
                    </div>
                    <h3 className="text-lg font-serif font-bold text-amber-100">
                      {p.arcana}
                    </h3>
                    <div className="text-xs text-amber-400/80 font-semibold mb-2">
                      {p.lotm} Pathway
                    </div>
                    <p className="text-xs text-slate-300/90 leading-relaxed mb-3">
                      {p.playstyle}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-white/10 space-y-2">
                    <div className="text-[11px] text-slate-200">
                      <span className="text-amber-400 font-bold">Seq 9 ({p.seqs[9].name}):</span> {p.seqs[9].ability}
                    </div>
                    <div className="text-[10px] text-emerald-300/90">
                      <span className="font-semibold">Acting:</span> {p.seqs[9].acting}
                    </div>
                    <div className="pt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onInspectPathway(p.id)}
                        className="flex-1 py-2 px-2.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-white/10 text-xs font-semibold text-amber-200 flex items-center justify-center gap-1 transition"
                      >
                        <Eye className="w-3.5 h-3.5" /> View Seq 9–1
                      </button>
                      <button
                        type="button"
                        onClick={() => onStartGame(p.id)}
                        className="flex-1 py-2 px-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center justify-center gap-1 transition"
                      >
                        Play <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <RulebookModal
          open={showCodex}
          tab={codexTab}
          search={codexSearch}
          pathwayId={codexPathwayId}
          onClose={onCloseCodex}
          onTabChange={onCodexTab}
          onSearchChange={onCodexSearch}
          onPathwayChange={onCodexPathway}
        />

        {/* PATHWAY FULL SEQUENCE INSPECTOR MODAL (SEQ 9 TO 1 + CHAOS EVENT) */}
        {inspectPathwayId !== null && (() => {
          const ip = PATHWAYS[inspectPathwayId];
          return (
            <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="max-w-3xl w-full max-h-[85vh] flex flex-col rounded-2xl border-2 border-amber-400/70 bg-[#13111f] p-5 shadow-2xl">
                <div className="flex items-start justify-between gap-3 pb-3 border-b border-white/10">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-widest text-amber-400">
                      {ROMAN[ip.id]}. {ip.arcana} — {ip.lotm} Pathway
                    </div>
                    <p className="text-xs text-slate-300 mt-1">{ip.playstyle}</p>
                    <p className="text-[11px] text-violet-300 mt-1">
                      <strong>Chaos Event (Recycles {ip.id} from Grave):</strong> {ip.chaosDesc}
                    </p>
                  </div>
                  <button onClick={() => onCloseInspect()} className="text-slate-400 hover:text-white p-1">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto pt-3 space-y-2 pr-1">
                  {[9, 8, 7, 6, 5, 4, 3, 2, 1].map(sq => (
                    <div key={sq} className="p-2.5 rounded-xl bg-slate-900/80 border border-white/10 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-amber-300">Sequence {sq}: {ip.seqs[sq].name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                          {TARGETED_ABILITY_TAGS.has(ip.seqs[sq].tag) ? 'Targeted' : 'Self / Table'}
                        </span>
                      </div>
                      <div className="text-slate-200 mt-1">{ip.seqs[sq].ability}</div>
                      <div className="text-emerald-400 text-[11px] mt-0.5">
                        <strong>Acting Condition:</strong> {ip.seqs[sq].acting}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-3 mt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
                  <button
                    onClick={() => {
                      onCloseInspect();
                      onOpenLabForPathway(ip.id);
                    }}
                    className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold flex items-center gap-1.5"
                  >
                    <Zap className="w-3.5 h-3.5" /> Test in Demo Lab
                  </button>
                  <button
                    onClick={() => { onCloseInspect(); onStartGame(ip.id); }}
                    className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center gap-1"
                  >
                    Start Match as {ip.arcana} <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
  );
}
