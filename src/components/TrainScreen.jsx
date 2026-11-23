import { Play, X } from 'lucide-react';
import { TIER_DIMS } from '../ai/browserRL/featuresRL.js';

function MetricsChart({ trainLog }) {
  if (!trainLog?.length) return null;
  const W = 560, H = 220;
  const pad = { L: 42, R: 16, T: 28, B: 36 };
  const plotL = pad.L, plotR = W - pad.R, plotT = pad.T, plotB = H - pad.B;
  const plotW = plotR - plotL, plotH = plotB - plotT;
  const n = trainLog.length;

  // Fixed Y 0–100 so rolling win / avg rds / val% share one readable scale
  const yOf = (v) => plotB - (Math.max(0, Math.min(100, Number(v) || 0)) / 100) * plotH;
  const xOf = (i) => (n <= 1 ? (plotL + plotR) / 2 : plotL + (i / (n - 1)) * plotW);

  // Green = rolling win% over the current Train-N block
  const rolling = trainLog.map(p => {
    const v = p.rollingWinPct != null ? p.rollingWinPct : p.ascentScore;
    return Number.isFinite(Number(v)) ? Number(v) : null;
  });
  const rounds = trainLog.map(p => (p.avgRounds != null ? Number(p.avgRounds) : null));

  // Solid blue = best val %; dashed cyan = latest validation sample %
  let carryBest = null;
  let carrySample = null;
  const bestValSeries = trainLog.map((p) => {
    if (p.valWinRate != null && Number.isFinite(Number(p.valWinRate))) carryBest = Number(p.valWinRate);
    return carryBest;
  });
  const sampleValSeries = trainLog.map((p) => {
    if (p.valSample != null && Number.isFinite(Number(p.valSample))) carrySample = Number(p.valSample);
    return carrySample;
  });
  const valDots = trainLog
    .map((p, i) => (p.isVal && p.valSample != null ? { i, v: Number(p.valSample) } : null))
    .filter(Boolean);

  const poly = (vals, stroke, width = 1.8, dash = null) => {
    if (n < 2) return null;
    const pts = vals
      .map((v, i) => (v == null || !Number.isFinite(v) ? null : `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`))
      .filter(Boolean);
    if (pts.length < 2) return null;
    return (
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth={width}
        strokeDasharray={dash || undefined}
        points={pts.join(' ')}
      />
    );
  };

  const yTicks = [0, 25, 50, 75, 100];
  const xTickCount = Math.min(6, Math.max(2, n));
  const xTicks = Array.from({ length: xTickCount }, (_, t) => {
    const i = xTickCount === 1 ? 0 : Math.round((t / (xTickCount - 1)) * (n - 1));
    const ep = trainLog[i]?.gamesTrained ?? trainLog[i]?.ep ?? i;
    return { i, ep };
  });

  const last = trainLog[n - 1];
  const lastBest = [...trainLog].reverse().find(p => p.valWinRate != null);
  const lastSample = [...trainLog].reverse().find(p => p.valSample != null);
  const lastRoll = last.rollingWinPct != null ? last.rollingWinPct : last.ascentScore;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-56 bg-slate-950/60 rounded-lg border border-white/5">
      {yTicks.map((t) => (
        <g key={`y-${t}`}>
          <line
            x1={plotL} y1={yOf(t)} x2={plotR} y2={yOf(t)}
            stroke={t === 50 ? '#475569' : '#1e293b'}
            strokeDasharray={t === 50 ? '4,4' : '2,6'}
            strokeWidth="1"
          />
          <text x={plotL - 6} y={yOf(t) + 3} textAnchor="end" fill="#94a3b8" fontSize="9">{t}</text>
        </g>
      ))}
      <line x1={plotL} y1={plotT} x2={plotL} y2={plotB} stroke="#64748b" strokeWidth="1.25" />
      <line x1={plotL} y1={plotB} x2={plotR} y2={plotB} stroke="#64748b" strokeWidth="1.25" />
      {xTicks.map(({ i, ep }) => (
        <text key={`x-${i}`} x={xOf(i)} y={plotB + 14} textAnchor="middle" fill="#94a3b8" fontSize="9">
          {ep}
        </text>
      ))}
      <text x={(plotL + plotR) / 2} y={H - 4} textAnchor="middle" fill="#64748b" fontSize="9">episodes</text>
      <text
        x={12} y={(plotT + plotB) / 2} textAnchor="middle" fill="#64748b" fontSize="9"
        transform={`rotate(-90 12 ${(plotT + plotB) / 2})`}
      >
        0–100
      </text>

      {poly(rolling, '#34d399', 1.8)}
      {poly(rounds, '#fbbf24', 1.8)}
      {poly(bestValSeries, '#38bdf8', 2)}
      {poly(sampleValSeries, '#7dd3fc', 2, '6,4')}
      {valDots.map(p => (
        <circle key={`v-${p.i}`} cx={xOf(p.i)} cy={yOf(p.v)} r="3.5" fill="#7dd3fc" stroke="#0c4a6e" strokeWidth="1" />
      ))}

      <text x={plotL} y={16} fill="#34d399" fontSize="11" fontWeight="700">
        roll {lastRoll != null ? `${Number(lastRoll).toFixed(1)}%` : '—'}
      </text>
      <text x={plotL + 110} y={16} fill="#fbbf24" fontSize="11" fontWeight="700">
        avg rds {last.avgRounds != null ? Number(last.avgRounds).toFixed(1) : '—'}
      </text>
      <text x={plotR - 100} y={16} textAnchor="end" fill="#38bdf8" fontSize="11" fontWeight="700">
        best {lastBest?.valWinRate != null ? `${lastBest.valWinRate}%` : '—'}
      </text>
      <text x={plotR} y={16} textAnchor="end" fill="#7dd3fc" fontSize="11" fontWeight="700">
        val {lastSample?.valSample != null ? `${lastSample.valSample}%` : '—'}
      </text>
    </svg>
  );
}

export function TrainScreen({
  getActiveNN,
  loadWeightsInputRef,
  handleLoadWeights,
  handleSaveWeights,
  resetNNWeights,
  trainRunning,
  setScreen,
  game,
  nnDifficulty,
  setNnDifficulty,
  setTrainLog,
  trainMode: _trainMode,
  setTrainMode: _setTrainMode,
  trainDepth,
  setTrainDepth,
  valOpponentDepth,
  setValOpponentDepth,
  valEveryN,
  setValEveryN,
  valGamesN,
  setValGamesN,
  stopTrainRef,
  nnBanner,
  setNnBanner,
  trainProgress,
  roundLimit,
  trainLog,
  handLimitMode,
  runOnlineLearn
}) {
  void _trainMode; void _setTrainMode; void setTrainLog;
  const nn = getActiveNN();
  const winPct = Math.round(((nn.championWinRate) || 0) * 100);
  const dims = TIER_DIMS[nnDifficulty] || TIER_DIMS.small;
  const tierLabel = `${nnDifficulty} ${dims.inSize}→${dims.hidSize}→${dims.outSize}`;
  const mem = nn.memorySize || nn.memory?.size || 0;
  const lastLog = trainLog?.length ? trainLog[trainLog.length - 1] : null;
  const avgRdsShown = trainProgress?.avgRounds != null
    ? trainProgress.avgRounds
    : (lastLog?.avgRounds != null
      ? lastLog.avgRounds
      : (typeof nn.lifetimeAvgRounds === 'function' ? nn.lifetimeAvgRounds() : null));
  const rollingShown = lastLog?.rollingWinPct != null
    ? lastLog.rollingWinPct
    : lastLog?.ascentScore;

  return (
    <div className="min-h-screen bg-[#09080f] text-slate-100 p-4 md:p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-sky-500/30">
          <div>
            <div className="text-xs uppercase tracking-widest text-sky-400 font-bold">
              Browser RL · resumes last save · unbounded state memory
            </div>
            <h1 className="text-2xl font-serif font-bold text-amber-100">NN Train Studio</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={loadWeightsInputRef} type="file" accept=".json" onChange={handleLoadWeights} className="hidden" />
            <button onClick={handleSaveWeights} disabled={trainRunning} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-emerald-950/70 border border-emerald-500/30 text-xs font-bold text-emerald-300">
              Save Weights
            </button>
            <button onClick={() => loadWeightsInputRef.current?.click()} disabled={trainRunning} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-sky-950/70 border border-sky-500/30 text-xs font-bold text-sky-300">
              Load Weights
            </button>
            <button onClick={resetNNWeights} disabled={trainRunning} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-rose-950/70 text-xs font-bold text-slate-200">
              Reset NN
            </button>
            <button onClick={() => setScreen('sim')} disabled={trainRunning} className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 text-white text-xs font-bold">
              AI Simulator →
            </button>
            <button onClick={() => setScreen(game ? 'playing' : 'setup')} className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold">
              {game ? 'Return to Match' : 'Back to Setup'}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-amber-500/25 bg-amber-950/20 px-3.5 py-2.5 text-xs text-amber-100/90 leading-relaxed">
          Train always <span className="text-emerald-300">continues</span> (ep {nn.gamesTrained || 0}, mem {mem}).
          Learning = state memory + D6 teacher + episode returns every train game.
          Champion weights promote only from <span className="text-sky-300">fixed greedy val vs D6</span> — not from rolling train WR.
          Only <span className="text-rose-300">Reset NN</span> wipes progress.
        </div>

        <div className="rounded-2xl border border-sky-500/30 bg-[#13111f] p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5">
              <span className="text-slate-400 font-semibold">NN Tier:</span>
              <select
                value={nnDifficulty}
                onChange={e => { setNnDifficulty(e.target.value); }}
                disabled={trainRunning}
                className="bg-slate-900 border border-violet-500/50 rounded-lg px-2 py-1.5 text-violet-200 font-bold"
              >
                <option value="small">Small · 16→8</option>
                <option value="medium">Medium · 40→20</option>
                <option value="large">Large · 100→40</option>
              </select>
            </label>
            <div className="px-2.5 py-1.5 rounded-lg bg-violet-950/50 border border-violet-500/40 text-violet-200 font-bold">
              {tierLabel}
            </div>
            <label className="flex items-center gap-1.5">
              <span className="text-slate-400 font-semibold">Train vs:</span>
              <select value={trainDepth} onChange={e => setTrainDepth(Number(e.target.value))} disabled={trainRunning} className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-100 font-bold">
                {[1, 2, 3, 4, 5, 6].map(d => (
                  <option key={d} value={d}>Heuristic D{d}</option>
                ))}
              </select>
            </label>
            <span className="text-slate-500">Hand {handLimitMode} · Cap {roundLimit} rds</span>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs border-t border-white/5 pt-3">
            <span className="text-sky-300 font-bold uppercase tracking-wide text-[10px]">Validation</span>
            <label className="flex items-center gap-1.5">
              <span className="text-slate-400 font-semibold">Val opponent:</span>
              <select
                value={valOpponentDepth}
                onChange={e => setValOpponentDepth(Number(e.target.value))}
                disabled={trainRunning}
                className="bg-slate-900 border border-sky-500/40 rounded-lg px-2 py-1.5 text-sky-100 font-bold"
              >
                {[1, 2, 3, 4, 5, 6].map(d => (
                  <option key={d} value={d}>Heuristic D{d}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-slate-400 font-semibold">Val every N train:</span>
              <select
                value={valEveryN}
                onChange={e => setValEveryN(Number(e.target.value))}
                disabled={trainRunning}
                className="bg-slate-900 border border-sky-500/40 rounded-lg px-2 py-1.5 text-sky-100 font-bold"
              >
                <option value={0}>Off (train only)</option>
                {[50, 100, 200, 500].map(n => (
                  <option key={n} value={n}>{n} games</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-slate-400 font-semibold">N validation:</span>
              <select
                value={valGamesN}
                onChange={e => setValGamesN(Number(e.target.value))}
                disabled={trainRunning || !valEveryN}
                className="bg-slate-900 border border-sky-500/40 rounded-lg px-2 py-1.5 text-sky-100 font-bold"
              >
                {[20, 40, 50, 100, 200].map(n => (
                  <option key={n} value={n}>{n} games</option>
                ))}
              </select>
            </label>
            <span className="text-slate-500">
              {valEveryN > 0
                ? `→ greedy ${valGamesN}g vs D${valOpponentDepth} every ${valEveryN} train · promote on clear gain · rolling WR is chart-only`
                : 'Mid-train val off · learning = memory + D6 teacher each train game'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {[50, 200, 1000, 5000].map(n => (
              <button
                key={n}
                disabled={trainRunning || typeof runOnlineLearn !== 'function'}
                onClick={() => runOnlineLearn(n)}
                className="px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 text-white font-bold text-xs flex items-center gap-1"
              >
                <Play className="w-3.5 h-3.5" /> Train {n}
              </button>
            ))}
            {trainRunning && (
              <button onClick={() => { stopTrainRef.current = true; }} className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs">
                Stop
              </button>
            )}
          </div>
        </div>

        {nnBanner && (
          <div className={`rounded-xl px-3.5 py-2 text-xs font-semibold flex items-center justify-between border ${
            nnBanner.tone === 'emerald' ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200' :
            nnBanner.tone === 'danger' ? 'bg-rose-950/50 border-rose-500/40 text-rose-200' :
            'bg-sky-950/50 border-sky-500/40 text-sky-200'
          }`}>
            <span>{nnBanner.text}</span>
            <button onClick={() => setNnBanner(null)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
        )}

        {trainRunning && trainProgress.total > 0 && (
          <div className="rounded-xl bg-sky-950/40 border border-sky-500/40 p-3 space-y-1.5">
            <div className="flex justify-between text-xs font-bold text-sky-200 gap-2 flex-wrap">
              <span>Training: {trainProgress.done} / {trainProgress.total} games</span>
              <span>
                Roll/Val {trainProgress.lastValRate ?? '—'}% · avg rds {trainProgress.avgRounds ?? '—'}
                {trainProgress.memorySize != null ? ` · mem ${trainProgress.memorySize}` : ''}
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-900 overflow-hidden">
              <div className="h-full bg-sky-400 transition-all" style={{ width: `${Math.min(100, (trainProgress.done / Math.max(1, trainProgress.total)) * 100)}%` }} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="p-3.5 rounded-xl bg-[#141220] border border-white/10">
            <div className="text-[10px] uppercase text-slate-400 font-bold">Episodes</div>
            <div className="text-2xl font-serif font-bold text-sky-300">{nn.gamesTrained || 0}</div>
          </div>
          <div className="p-3.5 rounded-xl bg-[#141220] border border-emerald-500/30">
            <div className="text-[10px] uppercase text-slate-400 font-bold">Rolling Win %</div>
            <div className="text-2xl font-serif font-bold text-emerald-300">
              {rollingShown != null ? `${Math.round(Number(rollingShown))}%` : `${winPct}%`}
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-[#141220] border border-sky-500/30">
            <div className="text-[10px] uppercase text-sky-300 font-bold">Best Val %</div>
            <div className="text-2xl font-serif font-bold text-sky-200">{Math.round(100 * (nn.bestValRate || 0))}%</div>
          </div>
          <div className="p-3.5 rounded-xl bg-[#141220] border border-amber-500/30">
            <div className="text-[10px] uppercase text-amber-300 font-bold">Avg Rounds</div>
            <div className="text-2xl font-serif font-bold text-amber-200">
              {avgRdsShown != null ? Number(avgRdsShown).toFixed(1) : '—'}
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-[#141220] border border-violet-500/30">
            <div className="text-[10px] uppercase text-violet-300 font-bold">State Memory</div>
            <div className="text-2xl font-serif font-bold text-violet-200">{mem}</div>
          </div>
        </div>

        {trainLog?.length > 0 && (
          <div className="rounded-2xl border border-white/10 bg-[#13111f] p-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-400 font-bold mb-2">
              Y 0–100 · green rolling train WR · yellow avg rds · blue best val · dashed current val
            </div>
            <MetricsChart trainLog={trainLog} />
          </div>
        )}
      </div>
    </div>
  );
}
