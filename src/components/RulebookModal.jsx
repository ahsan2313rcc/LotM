import { X } from 'lucide-react';
import { PATHWAYS, SUITS, SUIT_META, ROMAN, TARGETED_ABILITY_TAGS } from '../data/constants.js';
import { GLOSSARY_TERMS } from '../data/glossary.js';
import { SuitIcon } from './SuitIcon.jsx';

export function RulebookModal({
  open,
  tab,
  search,
  pathwayId,
  humanPathway = null,
  human = null,
  onClose,
  onTabChange,
  onSearchChange,
  onPathwayChange
}) {
  if (!open) return null;

  const q = search.trim().toLowerCase();
  const filteredChaos = PATHWAYS.filter(p => !q || p.arcana.toLowerCase().includes(q) || p.lotm.toLowerCase().includes(q) || p.chaosDesc.toLowerCase().includes(q));
  const searchSeqMatches = q ? PATHWAYS.flatMap(p =>
    [9, 8, 7, 6, 5, 4, 3, 2, 1]
      .map(sq => ({ p, sq, data: p.seqs[sq] }))
      .filter(({ p: pw, data }) =>
        pw.arcana.toLowerCase().includes(q) ||
        pw.lotm.toLowerCase().includes(q) ||
        data.name.toLowerCase().includes(q) ||
        data.ability.toLowerCase().includes(q) ||
        data.acting.toLowerCase().includes(q)
      )
  ) : [];

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 md:p-5">
      <div className="max-w-5xl w-full max-h-[88vh] flex flex-col rounded-2xl border-2 border-amber-500/60 bg-[#12101c] p-4 md:p-5 shadow-2xl">
        {/* Modal Header & Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/10">
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'rules', label: '1. Core Rules' },
              { id: 'cards', label: '2. Card Glossary (78)' },
              { id: 'chaos', label: '3. 22 Chaos Events' },
              { id: 'pathways', label: '4. 198 Abilities & Pathways' },
              { id: 'terms', label: '5. Terms Glossary' }
            ].map(t => (
              <button
                key={t.id}
                onClick={() => onTabChange(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  tab === t.id ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button onClick={() => onClose()} className="text-slate-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

          {/* Tab Body */}
          <div className="flex-1 overflow-y-auto pt-3 space-y-4 text-xs text-slate-300 pr-1">
            {tab === 'rules' && (
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30">
                  <div className="font-serif font-bold text-sm text-amber-200 mb-1">Objective — Sequence 0 Apotheosis</div>
                  <p>Start at <strong className="text-amber-300">Sequence 9</strong> with 7 cards in Hand and 1 chosen Major Arcana Pathway. The first player to ascend from Sequence 1 to <strong className="text-amber-300">Sequence 0</strong> wins immediately.</p>
                </div>

                <div className="grid md:grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-slate-900/80 border border-white/10 space-y-1.5">
                    <div className="font-bold text-amber-300 uppercase text-[11px]">3-Phase Round Loop + Instants</div>
                    <ol className="list-decimal list-inside space-y-1">
                      <li><strong>Phase 1 — Pouch & Draft (Before Trick, No Start Draw):</strong> The <em>only</em> phase to tuck cards into your 3-card Pouch or discard unwanted Pouch cards to the Grave (skipped players draw 2 recovery cards instead). Sequence Abilities, Chaos Events, Knights, and Queens are <strong>Instants</strong> playable at any time!</li>
                      <li><strong>Center Reveal & Draft:</strong> Reveal N+1 cards. Lowest rank (highest Seq number) drafts first; last card left is the <strong>Trump Card</strong>.</li>
                      <li><strong>Trick Play:</strong> Highest rank (last drafter) leads. Play <strong>any</strong> Minor or Major Arcana into the trick (no forced follow-suit!). If the Trump Card is a Major Arcana, Major Arcana is Trump and the highest Arcana value (0–21) wins. Targeting cards only target <em>active</em> opponents.</li>
                      <li><strong>Trick Winner Reward:</strong> Take the Trump Card OR attempt the <strong>Seer's Gamble</strong>.</li>
                      <li><strong>Ascension & Hand Cap:</strong> Spend Pouch cards summing to your current Seq. Trim Hand to your Sequence cap (excess to Grave). Ending at 0 cards triggers a <strong>Mental Break</strong>.</li>
                    </ol>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-900/80 border border-white/10 space-y-2">
                    <div className="font-bold text-amber-300 uppercase text-[11px]">Sanity, Recast Cost & Shrinking Hand Cap</div>
                    <ul className="space-y-1.5">
                      <li><strong className="text-emerald-300">Digested Ascension:</strong> Fulfill your Acting Condition before ascending to draw <strong>+1 bonus card</strong>.</li>
                      <li><strong className="text-rose-300">Undigested Ascension:</strong> Ascend early at the cost of <strong>discarding 3 Hand cards</strong>.</li>
                      <li><strong className="text-amber-200">Ability Recast Cost:</strong> First cast at your current Sequence is <strong>FREE</strong>; recasting that same ability costs <strong>1 Hand discard</strong>.</li>
                      <li><strong className="text-sky-300">Hand Limits:</strong> Standard <code>10→9→8→7</code> (Seq 9–8: 10, 7–6: 9, 5–4: 8, 3–1: 7) or Strict <code>7→6→5</code>.</li>
                      <li><strong className="text-rose-400">Mental Break:</strong> Ending a round with 0 Hand cards skips your next round and draws 2 recovery cards.</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {tab === 'cards' && (
              <div className="space-y-3">
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  {SUITS.map(st => (
                    <div key={st} className={`p-3 rounded-xl border ${SUIT_META[st].bg} ${SUIT_META[st].border} space-y-1`}>
                      <div className="flex items-center gap-1.5 font-bold text-sm text-slate-100">
                        <SuitIcon suit={st} className="w-4 h-4" /> {SUIT_META[st].name} (14 cards)
                      </div>
                      <div className="text-slate-200">{SUIT_META[st].desc}</div>
                      <div className="text-[11px] text-slate-400">
                        {st === 'swords' && 'Destroys 1 random face-down Pouch card of target opponent (triggers Page Traps; blocked by Knight).'}
                        {st === 'wands' && 'Forces target opponent to discard 1 Hand card (blocked by Queen; 0 cards triggers Mental Break).'}
                        {st === 'pentacles' && 'Draws 1 card immediately from the top of the Deck.'}
                        {st === 'cups' && 'Retrieves the top card of the Grave directly into your Hand.'}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="p-3 rounded-xl bg-slate-900/80 border border-white/10 space-y-2">
                  <div className="font-bold text-amber-300 uppercase text-[11px]">Special Ranks & Face Cards (In All 4 Suits)</div>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    <div className="p-2.5 rounded-lg bg-slate-950/70 border border-white/5"><strong className="text-amber-300">Ace (Rank 1):</strong> Counts as 1 for Pouch Math, and <strong>beats a 10 of the same Suit</strong> in trick resolution!</div>
                    <div className="p-2.5 rounded-lg bg-slate-950/70 border border-white/5"><strong className="text-amber-300">Numbers 2–9:</strong> Standard trick strength (higher wins unless inverted) and primary Pouch Ascension math ingredients.</div>
                    <div className="p-2.5 rounded-lg bg-slate-950/70 border border-white/5"><strong className="text-amber-300">10 (Trump Override):</strong> Playing a 10 overrides the Trump Suit to its own Suit for that trick.</div>
                    <div className="p-2.5 rounded-lg bg-slate-950/70 border border-white/5"><strong className="text-rose-300">Page (Trap):</strong> Tuck face-down in your Pouch. If hit by an opponent's Sword, steals 1 card from the attacker and goes to Grave.</div>
                    <div className="p-2.5 rounded-lg bg-slate-950/70 border border-white/5"><strong className="text-emerald-300">Knight (Instant Interrupt):</strong> Play out of turn to cancel an incoming Sword targeting your Pouch.</div>
                    <div className="p-2.5 rounded-lg bg-slate-950/70 border border-white/5"><strong className="text-sky-300">Queen (Instant Interrupt):</strong> Play out of turn to cancel an incoming Wand forced discard.</div>
                    <div className="p-2.5 rounded-lg bg-slate-950/70 border border-white/5"><strong className="text-violet-300">Instant Major / Seq Ability:</strong> On an incoming Sword/Wand you may also interrupt with a Major Arcana Chaos Event or your Sequence Ability (once per turn).</div>
                    <div className="p-2.5 rounded-lg bg-slate-950/70 border border-white/5 sm:col-span-2 lg:col-span-3"><strong className="text-amber-300">King (Hand Raid):</strong> Played into the trick; cannot win tricks (unless Iron-Blooded Knight / Knowledge Moor). Reveals target opponent's entire Hand and steals 1 card matching the King's Suit.</div>
                  </div>
                </div>
              </div>
            )}

            {tab === 'chaos' && (
              <div className="space-y-3">
                <input
                  type="text"
                  value={search}
                  onChange={e => onSearchChange(e.target.value)}
                  placeholder="Search 22 Chaos Events by Arcana name or effect..."
                  className="w-full bg-slate-900 border border-amber-500/30 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-400"
                />
                <div className="grid sm:grid-cols-2 gap-2">
                  {filteredChaos.map(p => (
                    <div key={p.id} className="p-2.5 rounded-xl bg-slate-900/80 border border-violet-500/25">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-amber-300">{ROMAN[p.id]}. {p.arcana}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-950 text-violet-300 border border-violet-500/30">
                          {p.chaosTiming} • Recycles {p.id}
                        </span>
                      </div>
                      <div className="text-slate-300 mt-1">{p.chaosDesc}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'pathways' && (() => {
              const cp = PATHWAYS[pathwayId];
              const isMine = humanPathway && cp.id === humanPathway.id;
              return (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={search}
                      onChange={e => onSearchChange(e.target.value)}
                      placeholder="Search all 198 abilities, sequence names, or acting conditions..."
                      className="flex-1 min-w-[220px] bg-slate-900 border border-amber-500/30 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-400"
                    />
                    {!q && (
                      <select
                        value={pathwayId}
                        onChange={e => onPathwayChange(Number(e.target.value))}
                        className="bg-slate-900 border border-amber-500/40 rounded-xl px-2.5 py-2 text-xs font-bold text-amber-200"
                      >
                        {PATHWAYS.map(p => (
                          <option key={p.id} value={p.id}>
                            {ROMAN[p.id]}. {p.arcana} ({p.lotm}){humanPathway && p.id === humanPathway.id ? ' ★ YOURS' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {q ? (
                    <div className="space-y-1.5">
                      <div className="text-[11px] text-slate-400">Found <strong className="text-amber-300">{searchSeqMatches.length}</strong> matching Sequence abilities across all 22 Pathways:</div>
                      {searchSeqMatches.map(({ p: pw, sq, data }) => (
                        <div key={`${pw.id}_${sq}`} className="p-2.5 rounded-xl bg-slate-900/80 border border-white/10">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-amber-300">{ROMAN[pw.id]}. {pw.arcana} — Seq {sq}: {data.name}</span>
                            <span className="text-[10px] text-slate-400">{TARGETED_ABILITY_TAGS.has(data.tag) ? 'Targeted' : 'Self/Table'}</span>
                          </div>
                          <div className="text-slate-200 mt-0.5">{data.ability}</div>
                          <div className="text-emerald-400 text-[11px] mt-0.5">Acting: {data.acting}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="p-3 rounded-xl bg-amber-950/25 border border-amber-500/30">
                        <div className="font-serif font-bold text-base text-amber-200">{ROMAN[cp.id]}. {cp.arcana} — {cp.lotm} Pathway</div>
                        <p className="text-slate-300 mt-0.5">{cp.playstyle}</p>
                        <div className="text-[11px] text-violet-300 mt-1"><strong>Chaos Event (X={cp.id}):</strong> {cp.chaosDesc}</div>
                      </div>
                      <div className="space-y-1.5">
                        {[9, 8, 7, 6, 5, 4, 3, 2, 1].map(sq => (
                          <div key={sq} className={`p-2.5 rounded-xl border ${isMine && human?.seq === sq ? 'bg-amber-950/40 border-amber-400' : 'bg-slate-900/70 border-white/10'}`}>
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-amber-300">Seq {sq}: {cp.seqs[sq].name} {isMine && human?.seq === sq && '(CURRENT)'}</span>
                              <span className="text-[10px] text-slate-400">{TARGETED_ABILITY_TAGS.has(cp.seqs[sq].tag) ? 'Targeted' : 'Self / Table'}</span>
                            </div>
                            <div className="text-slate-200 mt-0.5">{cp.seqs[sq].ability}</div>
                            <div className="text-emerald-400 text-[11px] mt-0.5">Acting: {cp.seqs[sq].acting}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {tab === 'terms' && (
              <div className="grid sm:grid-cols-2 gap-2.5">
                {GLOSSARY_TERMS.map(item => (
                  <div key={item.term} className="p-3 rounded-xl bg-slate-900/80 border border-white/10">
                    <div className="font-bold text-amber-300 mb-1">{item.term}</div>
                    <div className="text-slate-300 leading-relaxed">{item.def}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
}
