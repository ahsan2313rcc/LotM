import { Trophy, RotateCcw, History, ScrollText } from 'lucide-react';
import { PATHWAYS } from '../data/constants.js';

export function GameOverScreen({ game, onPlayAgain, onOpenReplay, onCopyNetlist, netlistCopied }) {
  const victor = game.winnerId != null ? game.players[game.winnerId] : null;
  const vp = victor ? PATHWAYS[victor.pathwayId] : null;
  const isSpec = !!game.spectatorMode;
  return (
    <div className="min-h-screen bg-[#09080f] text-slate-100 flex items-center justify-center p-6">
      <div className="max-w-lg w-full rounded-2xl border-2 border-amber-400/70 bg-gradient-to-b from-[#1e1828] to-[#0f0d17] p-8 text-center shadow-2xl space-y-5">
        <Trophy className="w-16 h-16 text-amber-400 mx-auto" />
        <div className="text-xs uppercase tracking-widest text-amber-300 font-bold">
          {isSpec ? 'Spectated Match Complete' : 'Sequence 0 Apotheosis'}
        </div>
        <h1 className="text-3xl font-serif font-bold text-amber-100">
          {!victor ? 'Draw — No Apotheosis' :
            victor.isHuman ? 'You Ascended to True Godhood!' : `${victor.name} Ascended to Sequence 0!`}
        </h1>
        <p className="text-sm text-slate-300">
          {victor && vp ? (
            <>
              <span className="text-amber-300 font-semibold">{victor.name}</span> completed the <span className="text-amber-200">{vp.arcana} ({vp.lotm})</span> Pathway in <span className="font-bold">{game.round} rounds</span>.
            </>
          ) : (
            <>Match ended after <span className="font-bold">{game.round} rounds</span>.</>
          )}
        </p>

        <div className="bg-slate-950/60 rounded-xl p-3 border border-white/10 text-left space-y-1.5">
          <div className="text-xs font-semibold text-slate-400 uppercase mb-1">Final Standings</div>
          {[...game.players].sort((a, b) => a.seq - b.seq).map(p => (
            <div key={p.id} className="flex items-center justify-between text-xs py-1 border-b border-white/5 last:border-0">
              <span className="font-semibold text-slate-200">{p.name} — {PATHWAYS[p.pathwayId].arcana}{p.brain ? ` [${p.brain}]` : ''}</span>
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold">Seq {p.seq}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          {onOpenReplay && (
            <button
              onClick={onOpenReplay}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm transition flex items-center justify-center gap-2"
            >
              <History className="w-4 h-4" /> Replay This Match (Netlist)
            </button>
          )}
          {onCopyNetlist && (
            <button
              onClick={onCopyNetlist}
              className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold text-xs transition flex items-center justify-center gap-2"
            >
              <ScrollText className="w-4 h-4" /> {netlistCopied ? 'Netlist Copied ✓' : 'Copy Netlist'}
            </button>
          )}
          <button
            onClick={onPlayAgain}
            className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm transition flex items-center justify-center gap-2"
          >
            <RotateCcw className="w-4 h-4" /> {isSpec ? 'Back to Simulator' : 'Play Another Ritual'}
          </button>
        </div>
      </div>
    </div>
  );
}
