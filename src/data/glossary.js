const GLOSSARY_TERMS = [
  { term: 'Acting Condition', def: 'A Sequence-specific gameplay task. Completing it flips your potion to Digested (+1 bonus draw on Ascension).' },
  { term: 'Apotheosis (Seq 0)', def: 'Ascending from Sequence 1 to Sequence 0 immediately wins the game.' },
  { term: 'Chaos Event', def: 'Any Major Arcana card (all 22 remain in the full 78-card Deck) played from Hand. Resolves in FIFO order, then recycles itself + top X Grave cards to the bottom of the Deck.' },
  { term: 'Digested vs. Undigested', def: 'Digested Ascension draws +1 bonus card. Undigested (Reckless) Ascension forces you to discard 3 Hand cards.' },
  { term: 'FIFO vs. Interrupt', def: 'Proactive plays resolve FIFO. On an incoming Sword/Wand you may interrupt with Knight/Queen, an instant Major Arcana, or your Seq ability (once per turn). Logged as ![#n: …] with effects inside [].' },
  { term: 'Once Per Turn Limits', def: 'Sequence Ability may be cast only once per turn (abilityUsed). Ascension may occur only once per turn (ascendedThisRound). Ascending does not refresh your ability for that turn.' },
  { term: 'Grave Recycle (X)', def: 'When a Major Arcana numbered X (0–21) resolves, move it + the top X cards of the Grave to the bottom of the Deck.' },
  { term: 'Ingredient Bag (Pouch)', def: 'Your private 3-card face-down zone (netlist /B) holding numbered cards for Ascension math and Page Traps. Before or after a trick, you may tuck as many Hand cards as fit (up to 3) or discard unwanted Bag cards to the Grave.' },
  { term: 'Mental Break', def: 'Ending a round with 0 Hand cards (or hitting 0 on a forced Wand discard) causes you to skip your next round and draw 2 recovery cards.' },
  { term: 'Sanity Toll (Ability Cost)', def: 'Activating your Sequence Ability is FREE while Undigested. Once you fulfill your Acting Condition (Digested), activating your ability costs 1 Hand discard.' },
  { term: 'Shorthand Netlist Notation', def: 'One action per line; commas separate actions. Brackets: [] interrupts/instants, () effects, {} board state. Instant: ![#2: X1 (#1, #2/B↔#1/B, g^>k_{X1})]. Seq: #2: z3q9; copy: #2: z0q7=z8q8. Trick: #2: X11. Digestion: {#1: q8$}. Ascend: @q8 / @q8*. Zones: + Hand, +/ Bag (/B), - discard/steal (-Cs), -/ bag destroy/steal (-/Cs), /~ bag shuffle, V/ /V reveals. Deck: k^ k_ k^{a>b} g^>k_{…} k~. Phases: G= (then opening #n: +cards) R= D= T=/T& A=/A&. Display fog hides opponent private draws (+H) and bag tucks (+/H). 198 Sequence abilities (22×9) + 22 Chaos Events are first-class actions.' },
  { term: 'Seer\'s Gamble', def: 'Trick Winner option: guess the Suit of the next Minor Arcana on top of the Deck. Reveal until a Minor appears—if right, scoop ALL revealed cards (including Major Arcana) + Trump!' },
  { term: 'Shrinking Hand Cap', def: 'Maximum Hand size enforced at end of round (excess goes to Grave). Standard: 10→9→8→7. Strict: 7→6→5.' },
  { term: 'Trump Override (10 & Ace)', def: 'Playing a 10 overrides the Trump Suit in tricks (beaten by an Ace of the same Suit), OR tuck a 10 into your Pouch as a Wildcard (any Number 1–9) for Ascension!' }
];

export { GLOSSARY_TERMS };
