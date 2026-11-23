import { Sparkles } from 'lucide-react';
import { SUIT_META } from '../data/constants.js';
import { SuitIcon } from './SuitIcon.jsx';

export function TarotCard({ card, onClick, selected, disabled, small, faceDown, badge, highlight }) {
  if (faceDown) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`relative rounded-xl border border-amber-500/40 bg-gradient-to-br from-[#1b1629] via-[#131020] to-[#0d0a16] flex flex-col items-center justify-center shadow-lg transition-all ${
          small ? 'w-14 h-20' : 'w-24 h-36'
        } ${onClick && !disabled ? 'hover:-translate-y-1 hover:border-amber-400 cursor-pointer' : 'cursor-default'}`}
      >
        <div className="absolute inset-1.5 rounded-lg border border-amber-500/20 flex items-center justify-center">
          <Sparkles className={`${small ? 'w-4 h-4' : 'w-6 h-6'} text-amber-500/50`} />
        </div>
        {badge && (
          <span className="absolute -top-2 -right-2 px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-amber-500 text-slate-950 shadow">
            {badge}
          </span>
        )}
      </button>
    );
  }

  if (!card) return null;

  if (card.type === 'major') {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={`${card.roman}. ${card.name} — Chaos Event (Recycles ${card.majorId} from Grave): ${card.chaosDesc}`}
        className={`relative text-left rounded-xl border-2 transition-all flex flex-col justify-between p-2 shadow-lg select-none ${
          small ? 'w-20 h-28' : 'w-28 h-40'
        } bg-gradient-to-b from-amber-950/90 via-[#221810] to-[#120e0a] ${
          selected ? 'border-amber-300 ring-2 ring-amber-400/70 -translate-y-2' :
          highlight ? 'border-amber-400 shadow-amber-500/25' : 'border-amber-500/60'
        } ${onClick && !disabled ? 'hover:-translate-y-1.5 hover:border-amber-300 cursor-pointer' : 'opacity-90 cursor-default'}`}
      >
        <div className="flex items-center justify-between w-full">
          <span className="text-[11px] font-serif font-bold text-amber-300">{card.roman}</span>
          <span className="text-[9px] px-1 rounded bg-amber-500/20 text-amber-200 border border-amber-500/30">
            X={card.majorId}
          </span>
        </div>
        <div className="my-auto text-center">
          <Sparkles className={`${small ? 'w-4 h-4' : 'w-5 h-5'} text-amber-400 mx-auto mb-1`} />
          <div className={`${small ? 'text-[10px]' : 'text-xs'} font-serif font-bold text-amber-100 leading-tight`}>
            {card.name}
          </div>
          {!small && (
            <div className="text-[9px] text-amber-300/80 mt-0.5 line-clamp-2 leading-tight">
              Chaos Event
            </div>
          )}
        </div>
        <div className="text-[9px] text-center uppercase tracking-wider text-amber-400/70 border-t border-amber-500/20 pt-0.5">
          Major Arcana
        </div>
      </button>
    );
  }

  const meta = SUIT_META[card.suit];
  const isSpecial = card.rank === 1 || card.rank >= 10;
  const specialTag =
    card.rank === 1 ? 'Beats 10' :
    card.rank === 10 ? 'Wild/10' :
    card.rank === 11 ? 'Trap' :
    card.rank === 12 ? 'vs Swd' :
    card.rank === 13 ? 'vs Wnd' :
    card.rank === 14 ? 'Steal' : null;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={`${card.label} of ${meta.name} — ${meta.desc}${specialTag ? ` (${specialTag})` : ''}`}
      className={`relative text-left rounded-xl border transition-all flex flex-col justify-between p-2 shadow-md select-none ${
        small ? 'w-20 h-28' : 'w-28 h-40'
      } ${meta.bg} ${
        selected ? 'border-amber-300 ring-2 ring-amber-400 -translate-y-2' :
        highlight ? 'border-amber-400/90 shadow-amber-500/20' : meta.border
      } ${onClick && !disabled ? 'hover:-translate-y-1.5 hover:border-amber-300 cursor-pointer' : 'opacity-75 cursor-not-allowed'}`}
    >
      <div className="flex items-center justify-between w-full">
        <span className={`font-serif font-bold ${small ? 'text-xs' : 'text-sm'} text-slate-100`}>
          {card.label}
        </span>
        <SuitIcon suit={card.suit} className={small ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
      </div>

      <div className="my-auto flex flex-col items-center justify-center text-center">
        <SuitIcon suit={card.suit} className={small ? 'w-6 h-6 opacity-90' : 'w-8 h-8 opacity-90'} />
        {specialTag && (
          <span className="mt-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-slate-950/75 text-amber-300 border border-amber-500/30">
            {specialTag}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between text-[9px] text-slate-300/90 border-t border-white/10 pt-0.5">
        <span className={`uppercase font-semibold ${meta.color}`}>{meta.short}</span>
        {!small && <span className="truncate ml-1 opacity-80">{isSpecial ? specialTag : meta.desc.split(' ')[0]}</span>}
      </div>

      {badge && (
        <span className="absolute -top-2 -right-2 px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-amber-400 text-slate-950 shadow">
          {badge}
        </span>
      )}
    </button>
  );
}
