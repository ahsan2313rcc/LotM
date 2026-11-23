import { Swords, Flame, Coins, Wine, Sparkles } from 'lucide-react';

export function SuitIcon({ suit, className = 'w-4 h-4' }) {
  if (suit === 'swords') return <Swords className={`${className} text-rose-400`} />;
  if (suit === 'wands') return <Flame className={`${className} text-violet-400`} />;
  if (suit === 'pentacles') return <Coins className={`${className} text-emerald-400`} />;
  if (suit === 'cups') return <Wine className={`${className} text-sky-400`} />;
  return <Sparkles className={`${className} text-amber-400`} />;
}
