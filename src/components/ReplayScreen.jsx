import { useMemo } from 'react';
import {
  History, ChevronLeft, ChevronRight, Trash2, Play, Pause, SkipBack, SkipForward
} from 'lucide-react';
import { PATHWAYS } from '../data/constants.js';
import { cardCode } from '../utils/cards.js';
import { parseNetlistToFrames, SAMPLE_REPLAY_NETLIST } from '../utils/netlist.js';
import { TarotCard } from './TarotCard.jsx';

export function ReplayScreen({
  game,
  gameHistory,
  setGameHistory,
  replayInput,
  setReplayInput,
  replayFrames,
  replayStep,
  setReplayStep,
  replayPlaying,
  setReplayPlaying,
  replayTitle,
  replaySpeedMs,
  setReplaySpeedMs,
  openReplayWithNetlist,
  setScreen
}) {
  const curFrame = replayFrames[replayStep] || replayFrames[0] || null;
  const rState = curFrame?.state || null;

  // Group timeline steps into round paragraphs (Setup, Round 1, Round 2, …)
  const roundParagraphs = useMemo(() => {
    const groups = [];
    let cur = null;
    replayFrames.forEach((fr, idx) => {
      const key = fr.roundKey ?? fr.state?.round ?? 0;
      const label = fr.roundLabel || (key === 0 ? 'Setup' : `Round ${key}`);
      if (!cur || cur.key !== key) {
        cur = { key, label, frames: [] };
        groups.push(cur);
      }
      cur.frames.push({ fr, idx });
    });
    return groups;
  }, [replayFrames]);

  return (
    <div className="min-h-screen bg-[#0b0a12] text-slate-100 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <History className="w-5 h-5 text-indigo-400" />
            <div>
              <h1 className="font-serif font-bold text-lg text-amber-200">Past Game History & Netlist Replay Studio</h1>
              <p className="text-xs text-slate-400">Step through any saved match or paste a Shorthand Netlist to reconstruct every phase and card movement.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {game && (
              <button onClick={() => setScreen('playing')} className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold">
                Resume Live Match
              </button>
            )}
            <button onClick={() => setScreen('setup')} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-xs font-bold text-slate-200">
              ← Back to Setup
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* LEFT: PAST GAME HISTORY + CUSTOM NETLIST IMPORTER (4 cols) */}
          <div className="lg:col-span-4 space-y-4">
            <div className="rounded-2xl border border-indigo-500/30 bg-[#12101c] p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5" /> Past Game History ({gameHistory.length})
                </div>
                <button
                  type="button"
                  onClick={() => openReplayWithNetlist(SAMPLE_REPLAY_NETLIST, 'Sample Verified Match (Fool vs Magician vs Empress)')}
                  className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/35 border border-amber-400/40 text-[10px] font-bold text-amber-200"
                >
                  Load Sample
                </button>
              </div>
              {gameHistory.length === 0 ? (
                <p className="text-xs text-slate-400 py-2">No saved matches yet. Finish a game (auto-saved) or click <strong>Save</strong> in the Chronicle sidebar during any match.</p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {gameHistory.map(h => (
                    <div key={h.id} className="p-2.5 rounded-xl bg-slate-900/80 border border-white/10 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-xs font-bold text-amber-200 leading-tight">{h.title}</div>
                        <button
                          type="button"
                          onClick={() => {
                            setGameHistory(prev => {
                              const next = prev.filter(x => x.id !== h.id);
                              try { localStorage.setItem('lotm_game_history_v1', JSON.stringify(next)); } catch (_) {}
                              return next;
                            });
                          }}
                          className="text-slate-500 hover:text-rose-400 p-0.5"
                          title="Delete from history"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="text-[10px] text-slate-400">{h.players}</div>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[10px] text-slate-500">{h.date}</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openReplayWithNetlist(h.netlist, h.title)}
                            className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold"
                          >
                            Replay
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#12101c] p-3.5 space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-amber-300">Paste Any Netlist to Replay</div>
              <textarea
                value={replayInput}
                onChange={e => setReplayInput(e.target.value)}
                rows={10}
                placeholder={"G= #1: z0, #2: z1;\n\n#1: +S7,+W3,+C2\n#2: +C8,+S4,+W5\n\nR1=\n#1: +/S7\nD1= W9, P7\n...\nA1&\n\nR2=\n..."}
                className="w-full rounded-xl bg-black/50 border border-white/15 p-2.5 font-mono text-[11px] text-amber-100 outline-none focus:border-amber-400 whitespace-pre leading-relaxed"
              />
              <p className="text-[10px] text-slate-500">Blank lines separate round paragraphs (Setup → Round 1 → Round 2…).</p>
              <button
                type="button"
                onClick={() => openReplayWithNetlist(replayInput, 'Custom Imported Netlist')}
                className="w-full py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition"
              >
                Parse & Load Netlist ({parseNetlistToFrames(replayInput).length} Steps)
              </button>
            </div>
          </div>

          {/* RIGHT: VISUAL BOARD RECONSTRUCTION + VCR CONTROLS (8 cols) */}
          <div className="lg:col-span-8 space-y-3">
            <div className="rounded-2xl border border-amber-500/30 bg-[#141222] p-3.5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-amber-200">{replayTitle}</div>
                  <div className="text-[11px] text-slate-400">
                    Step <span className="text-amber-300 font-bold">{replayFrames.length > 0 ? replayStep + 1 : 0}</span> / {replayFrames.length}
                    {curFrame && (
                      <> · <span className="text-sky-300 font-bold">{curFrame.roundLabel || (rState?.round === 0 ? 'Setup' : `Round ${rState?.round}`)}</span>
                      {' '}· Phase <span className="text-emerald-300 font-bold">{curFrame.phase || rState?.phase}</span></>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => { setReplayPlaying(false); setReplayStep(0); }} className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10" title="Start"><SkipBack className="w-3.5 h-3.5" /></button>
                  <button onClick={() => { setReplayPlaying(false); setReplayStep(s => Math.max(0, s - 1)); }} className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10" title="Previous Step"><ChevronLeft className="w-3.5 h-3.5" /></button>
                  <button
                    onClick={() => {
                      if (replayStep >= replayFrames.length - 1) setReplayStep(0);
                      setReplayPlaying(p => !p);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1"
                  >
                    {replayPlaying ? <><Pause className="w-3.5 h-3.5" /> Pause</> : <><Play className="w-3.5 h-3.5" /> Play</>}
                  </button>
                  <button onClick={() => { setReplayPlaying(false); setReplayStep(s => Math.min(replayFrames.length - 1, s + 1)); }} className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10" title="Next Step"><ChevronRight className="w-3.5 h-3.5" /></button>
                  <button onClick={() => { setReplayPlaying(false); setReplayStep(Math.max(0, replayFrames.length - 1)); }} className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10" title="End"><SkipForward className="w-3.5 h-3.5" /></button>
                  <select
                    value={replaySpeedMs}
                    onChange={e => setReplaySpeedMs(Number(e.target.value))}
                    className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-slate-200 font-bold"
                  >
                    <option value={1500}>0.5x</option>
                    <option value={950}>1x</option>
                    <option value={450}>2x</option>
                  </select>
                </div>
              </div>
              {replayFrames.length > 1 && (
                <input
                  type="range"
                  min={0}
                  max={replayFrames.length - 1}
                  value={replayStep}
                  onChange={e => { setReplayPlaying(false); setReplayStep(Number(e.target.value)); }}
                  className="w-full accent-amber-400 cursor-pointer"
                />
              )}
              {curFrame && (
                <div className="p-2 rounded-xl bg-black/45 border border-amber-500/25 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold text-amber-200">{curFrame.token}</span>
                  <span className="text-xs text-slate-300">{curFrame.desc}</span>
                </div>
              )}
            </div>

            {rState && (
              <div className="rounded-2xl border border-white/10 bg-[#12101c] p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {rState.players.map(pl => {
                    const pw = PATHWAYS[pl.pathwayId] || PATHWAYS[0];
                    return (
                      <div key={pl.id} className={`p-3 rounded-xl border space-y-2 ${rState.winnerId === pl.id ? 'bg-amber-950/40 border-amber-400' : pl.inactive ? 'bg-rose-950/20 border-rose-500/40 opacity-75' : 'bg-slate-900/70 border-white/10'}`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-xs font-bold text-amber-200">{pl.name} · {pw.arcana} (z{pl.pathwayId})</div>
                            <div className="text-[11px] text-slate-400">Seq {pl.seq} {pw.seqs[pl.seq]?.name || 'God'}</div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            {pl.digested && <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/50 text-[10px] font-bold text-emerald-300">q{pl.seq}$</span>}
                            {pl.inactive && <span className="px-1.5 py-0.5 rounded bg-rose-500/20 border border-rose-400/50 text-[10px] font-bold text-rose-300">#{pl.id + 1}x</span>}
                            {rState.winnerId === pl.id && <span className="px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 text-[10px] font-bold">WIN</span>}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Tracked Pouch ({pl.pouch.length})</div>
                          <div className="flex flex-wrap gap-1">
                            {pl.pouch.length === 0 ? <span className="text-[10px] text-slate-600">Empty</span> : pl.pouch.map(c => (
                              <span key={c.uid} className="px-1.5 py-0.5 rounded bg-violet-950/70 border border-violet-400/40 font-mono text-[10px] font-bold text-violet-200">{cardCode(c)}</span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Tracked Hand ({pl.hand.length})</div>
                          <div className="flex flex-wrap gap-1">
                            {pl.hand.length === 0 ? <span className="text-[10px] text-slate-600">—</span> : pl.hand.map(c => (
                              <span key={c.uid} className="px-1.5 py-0.5 rounded bg-slate-800 border border-white/10 font-mono text-[10px] font-bold text-slate-200">{cardCode(c)}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-2 border-t border-white/10">
                  <div className="md:col-span-3 p-3 rounded-xl bg-amber-950/20 border border-amber-500/30 flex flex-col items-center justify-center gap-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Trump Card</div>
                    {rState.trumpCard ? <TarotCard card={rState.trumpCard} small highlight /> : <div className="text-xs text-slate-500 py-6">None</div>}
                  </div>
                  <div className="md:col-span-6 p-3 rounded-xl bg-slate-900/60 border border-white/10 space-y-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-sky-300">
                      {rState.centerDraft.length > 0 ? `Center Draft Pool (${rState.centerDraft.length})` : `Trick Table (${rState.trickPlays.length} played)`}
                    </div>
                    <div className="flex flex-wrap justify-center gap-2.5 min-h-[108px] items-center">
                      {rState.centerDraft.length > 0 ? (
                        rState.centerDraft.map(c => <TarotCard key={c.uid} card={c} small />)
                      ) : rState.trickPlays.length > 0 ? (
                        rState.trickPlays.map((tp, idx) => (
                          <div key={idx} className="flex flex-col items-center gap-1">
                            <span className="text-[10px] font-bold text-amber-300">#{tp.playerId + 1} {tp.tvTag}</span>
                            <TarotCard card={tp.card} small highlight />
                          </div>
                        ))
                      ) : (
                        <span className="text-xs text-slate-500">{rState.banner}</span>
                      )}
                    </div>
                  </div>
                  <div className="md:col-span-3 p-3 rounded-xl bg-slate-900/60 border border-white/10 space-y-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Grave ({rState.grave.length})</div>
                    <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
                      {rState.grave.slice(0, 14).map((c, i) => (
                        <span key={c.uid + i} className="px-1.5 py-0.5 rounded bg-black/50 border border-white/10 font-mono text-[10px] text-slate-300">{cardCode(c)}</span>
                      ))}
                      {rState.grave.length === 0 && <span className="text-[10px] text-slate-600">Empty</span>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-white/10 bg-[#12101c] p-3 space-y-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Clickable Netlist Timeline — one paragraph per round
              </div>
              <div className="max-h-56 overflow-y-auto space-y-3 pr-1">
                {roundParagraphs.map(para => (
                  <div key={para.key} className="space-y-1.5 pb-2 border-b border-white/5 last:border-0 last:pb-0">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300/90">
                      {para.label}
                      <span className="ml-2 text-slate-500 font-semibold normal-case tracking-normal">
                        ({para.frames.length} step{para.frames.length === 1 ? '' : 's'})
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {para.frames.map(({ fr, idx }) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => { setReplayPlaying(false); setReplayStep(idx); }}
                          className={`px-2 py-1 rounded font-mono text-[10px] font-bold border transition max-w-full truncate ${
                            idx === replayStep
                              ? 'bg-amber-500 text-slate-950 border-amber-300'
                              : idx < replayStep
                                ? 'bg-slate-800/90 text-slate-200 border-white/10 hover:border-amber-400/50'
                                : 'bg-slate-950 text-slate-500 border-white/5 hover:text-slate-300'
                          }`}
                          title={fr.desc || fr.token}
                        >
                          {fr.token.length > 42 ? `${fr.token.slice(0, 40)}…` : fr.token}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {roundParagraphs.length === 0 && (
                  <div className="text-[11px] text-slate-500 py-2">Load or paste a netlist to build the timeline.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
