const SUITS = ['swords', 'wands', 'pentacles', 'cups'];
const SUIT_META = {
  swords: { name: 'Swords', short: 'SWD', color: 'text-rose-400', bg: 'bg-rose-950/60', border: 'border-rose-500/50', desc: 'Destroy 1 Pouch card' },
  wands: { name: 'Wands', short: 'WND', color: 'text-violet-400', bg: 'bg-violet-950/60', border: 'border-violet-500/50', desc: 'Force 1 Hand discard' },
  pentacles: { name: 'Pentacles', short: 'PNT', color: 'text-emerald-400', bg: 'bg-emerald-950/60', border: 'border-emerald-500/50', desc: 'Draw 1 from Deck' },
  cups: { name: 'Cups', short: 'CUP', color: 'text-sky-400', bg: 'bg-sky-950/60', border: 'border-sky-500/50', desc: 'Take top of Grave' },
  major: { name: 'Major Arcana', short: 'MAJ', color: 'text-amber-400', bg: 'bg-amber-950/60', border: 'border-amber-500/50', desc: 'Major Arcana Trump / Chaos' }
};
const getCardSuit = (c) => (!c ? null : (c.type === 'major' ? 'major' : c.suit));

const RANK_LABELS = {
  1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'Page', 12: 'Knight', 13: 'Queen', 14: 'King'
};

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI'];

const TARGETED_ABILITY_TAGS = new Set([
  'bard_inspire', 'blatherer_2', 'bribe_opp', 'calamity_jinx', 'clairvoyant',
  'conqueror_lock', 'copy_ability', 'criminal_discard', 'crimson_moon', 'deduce_reveal',
  'demon_hunter_strike', 'devil_desire', 'ferryman_swap', 'filthy_monarch', 'frenzy_discard',
  'hand_of_god', 'hand_swap_opp', 'hunter_track', 'hypnotist_steal', 'interrogator',
  'jinx_cycle', 'marionette', 'notary_pact', 'pouch_swap_opp', 'puppet_curse',
  'reaper_strike', 'scribe_grave', 'serial_killer', 'silence_opp', 'steal_pouch_safe',
  'steal_time', 'steal_trump_hand', 'swap_best_hand', 'taunt_discard', 'warlock_cast',
  'weaken_opp', 'witch_burn', 'wraith_possess'
]);

// All 22 Major Arcana Pathways, Chaos Events & 198 Sequence Abilities + Acting Conditions
const PATHWAYS = [
  {
    id: 0, arcana: 'The Fool', lotm: 'Seer', lever: 'Deck Top & Suit-Guess',
    playstyle: 'Chaotic trope-hopping: divination, paper figurines, faceless copying, marionettes & historical projections.',
    chaosTiming: 'Trick', chaosDesc: 'Swap the center Trump Card with 1 card from your Hand.',
    seqs: {
      9: { name: 'Seer', ability: 'Peek & reorder the top 2 cards of the Deck (moves best card to top).', acting: 'Win a trick & succeed on Suit-Guess Gamble.', tag: 'peek_deck_2' },
      8: { name: 'Clown', ability: 'Paper Figurine: On a Sword attack, you may swap 1 Hand card with 1 Bag card to block the hit (optional, like a Knight).', acting: 'Survive a round losing 0 Bag cards.', tag: 'clown_shield' },
      7: { name: 'Magician', ability: 'Illusion: Your next played trick card counts as +3 value (max 9) and Trump Suit.', acting: 'Win a trick with a non-natural highest card.', tag: 'illusion_boost' },
      6: { name: 'Faceless', ability: 'Copy and immediately trigger an opponent\'s current Sequence Ability.', acting: 'Copy and resolve an opponent\'s ability.', tag: 'copy_ability' },
      5: { name: 'Marionettist', ability: 'Force target opponent to discard a random card and play a weak card next.', acting: 'Force an opponent to lose a trick or discard.', tag: 'marionette' },
      4: { name: 'Bizarro Sorcerer', ability: 'Pull 1 card from Grave face-down into Pouch (acts as a Page Trap).', acting: 'Trigger a Page Trap or hold 3 Pouch cards.', tag: 'grave_to_pouch_trap' },
      3: { name: 'Scholar of Yore', ability: 'Historical Projection: Pull any 1 Minor Arcana from Grave into Hand and gain +2 trick value.', acting: 'Take a card from Grave and win a trick.', tag: 'scholar_proj' },
      2: { name: 'Miracle Invoker', ability: 'Swap the center Trump Card with the top card of the Deck.', acting: 'Change the Trump Card and win the trick.', tag: 'swap_trump_deck' },
      1: { name: 'Attendant of Mysteries', ability: 'Grafting: Draw 2 cards and convert any enemy Sword/Wand this trick into a draw for you.', acting: 'Resolve a Chaos Event or Grafting and win a trick.', tag: 'grafting' }
    }
  },
  {
    id: 1, arcana: 'The Magician', lotm: 'Door (Apprentice)', lever: 'Drafting & Trump Zone',
    playstyle: 'Spatial control: swaps with Center Draft/Trump Card, blinks out of tricks, and exiles Pouch cards safely.',
    chaosTiming: 'Anytime', chaosDesc: 'Blindly swap 1 face-down card in your Pouch with 1 in an opponent\'s Pouch.',
    seqs: {
      9: { name: 'Apprentice', ability: 'Door Opening: Swap 1 Hand card with the center Trump Card or a Draft card.', acting: 'Draft or swap a card matching Trump Suit.', tag: 'swap_hand_trump' },
      8: { name: 'Trickmaster', ability: 'Cancel your next Suit Action to instead draw 2 cards and discard 1.', acting: 'Trigger Trickmaster draw/cycle.', tag: 'cycle_2_1' },
      7: { name: 'Astrologer', ability: 'Peek at top card of Deck and cycle it to bottom if unwanted (+1 draw).', acting: 'Use Astrologer or win a Suit-Guess Gamble.', tag: 'astrologer' },
      6: { name: 'Scribe', ability: 'Record: Trigger the Suit Action of the top card in the Grave immediately.', acting: 'Trigger 2 Suit Actions in one turn.', tag: 'scribe_grave' },
      5: { name: 'Traveler', ability: 'Blink: Become immune to Swords/Wands/Kings this round and draw 1 card.', acting: 'End a round taking 0 Hand/Pouch losses.', tag: 'blink_immune' },
      4: { name: 'Secrets Sorcerer', ability: 'Exile: Shield 1 Pouch card permanently from Swords/Chaos and draw 1 card.', acting: 'Protect/exile a Pouch card for a round.', tag: 'pouch_immune_draw' },
      3: { name: 'Wanderer', ability: 'Swap the center Trump Card with the top Minor Arcana in the Grave.', acting: 'Win a trick after Trump Card changed.', tag: 'swap_trump_grave' },
      2: { name: 'Planeswalker', ability: 'Replicate: Pull the highest numbered Minor Arcana from Grave into Hand.', acting: 'Pull a card from Grave into Hand.', tag: 'grave_best_to_hand' },
      1: { name: 'Key of Stars', ability: 'Spatial Lock: Lock opponent Knights, Queens & 10-overrides for this round.', acting: 'Win a trick while Spatial Lock is active.', tag: 'spatial_lock' }
    }
  },
  {
    id: 2, arcana: 'The High Priestess', lotm: 'Hermit (Mystery Pryer)', lever: 'Major Arcana & Spells',
    playstyle: 'Spellcraft: pulls Major Arcana from Deck/Grave, doubles or skips Grave recycles, and casts instant Suit spells.',
    chaosTiming: 'Anytime', chaosDesc: 'Look at the top 3 cards of the Deck and place the best card on top.',
    seqs: {
      9: { name: 'Mystery Pryer', ability: 'Peek at the top of the Deck; you may swap it with the bottom card of the Grave.', acting: 'Peek at a hidden card (Deck, Grave, opponent Hand, or Pouch).', tag: 'mystery_pryer_swap' },
      8: { name: 'Melee Scholar', ability: 'Your Wands and Cups gain +2 trick value (max 9) this round.', acting: 'Win a trick using a Wand or Cup.', tag: 'wand_cup_boost' },
      7: { name: 'Warlock', ability: 'Discard 1 card from Hand to immediately trigger Pentacle (draw 1) + Sword (hit rival Pouch).', acting: 'Resolve 2 Suit Actions in one turn.', tag: 'warlock_cast' },
      6: { name: 'Scrolls Professor', ability: 'Store a Spell Scroll: draw 1 card and gain +1 trick value this round.', acting: 'Activate Scrolls Professor during a round.', tag: 'scroll_charge' },
      5: { name: 'Constellations Master', ability: 'Search top 4 cards of Deck for a Major Arcana and take it into Hand (else draw 1).', acting: 'Hold or play a Major Arcana card.', tag: 'find_major' },
      4: { name: 'Mysticologist', ability: 'Fairy Tale: Draw 1 card; your next Major Arcana skips Grave Recycle (0X).', acting: 'Play a Major Arcana Chaos Event.', tag: 'mystic_fairytale' },
      3: { name: 'Clairvoyant', ability: 'Reveal 1 card from every opponent\'s Hand and gain +2 trick value this round.', acting: 'Win a trick after peeking at rival Hands.', tag: 'clairvoyant' },
      2: { name: 'Sage', ability: 'Information Flood: Swap 1 random card from target opponent\'s Hand with 1 from yours.', acting: 'Swap a card with an opponent\'s Hand.', tag: 'hand_swap_opp' },
      1: { name: 'Knowledge Emperor', ability: 'Spell Synthesis: Discard 1 card to pull any Major Arcana from Grave into Hand.', acting: 'Resolve a Major Arcana Chaos Event.', tag: 'grave_major_to_hand' }
    }
  },
  {
    id: 3, arcana: 'The Empress', lotm: 'Demoness (Assassin)', lever: 'Page Traps & Pouch Sabotage',
    playstyle: 'Ambush & plague: turns Pouch cards into traps, spreads Suit-based plagues, and destroys rival Pouches.',
    chaosTiming: 'Anytime', chaosDesc: 'Target opponent reveals 1 Pouch card; if it is a Page, destroy it (else discard 1 from Hand).',
    seqs: {
      9: { name: 'Assassin', ability: 'Ambush: Gain +2 trick value (max 9) this round; your Swords also steal 1 from Deck.', acting: 'Destroy an opponent\'s Pouch card or win a trick.', tag: 'assassin_ambush' },
      8: { name: 'Instigator', ability: 'Redirect: Next Sword/Wand targeting you bounces to another opponent instead (draw 1 if triggered).', acting: 'Force a discard (Wand).', tag: 'instigator_redirect' },
      7: { name: 'Witch', ability: "Black Flame: Destroy 1 face-down card from target opponent's Pouch; if it lands (not blocked by Knight), draw 1 from Deck.", acting: "Destroy a card in an opponent's Pouch.", tag: 'witch_burn' },
      6: { name: 'Pleasure', ability: 'Charm: Target opponent gives you 1 card from their Hand of their choice.', acting: 'Receive a card from an opponent via Charm.', tag: 'pleasure_gift' },
      5: { name: 'Affliction', ability: 'Plague: Every opponent with 3+ cards in Hand discards 1 card; you may take 1 discarded card into your Hand.', acting: 'Unleash Plague or play a Wand.', tag: 'plague_aoe' },
      4: { name: 'Despair', ability: 'Mirror Substitute: All your Pouch cards act as Page Traps this round.', acting: 'Hold 2+ Pouch cards or trigger a Page Trap.', tag: 'despair_traps' },
      3: { name: 'Unaging', ability: 'Mirror World: Swap your Pouch cards with the top cards of the Grave.', acting: 'Refresh cards in your Pouch.', tag: 'pouch_swap_grave' },
      2: { name: 'Catastrophe', ability: 'Disaster: Every opponent loses 1 Pouch card (or discards 2 Hand cards if Pouch empty).', acting: 'Force 2+ opponents to lose cards.', tag: 'catastrophe_aoe' },
      1: { name: 'Apocalypse', ability: 'End of Days: Disable opponent Knights/Queens this round; Swords destroy 2 Pouch cards.', acting: 'Destroy a Pouch card or win a trick.', tag: 'apocalypse_mode' }
    }
  },
  {
    id: 4, arcana: 'The Emperor', lotm: 'Black Emperor (Lawyer)', lever: 'Number Inversion & Bribes',
    playstyle: 'Loophole exploitation: inverts trick rankings so low numbers win, bends Ascension Math (±1), and forces Bribes.',
    chaosTiming: 'Trick', chaosDesc: 'Invert trick rankings this trick so the lowest Number of the led/trump suit wins.',
    seqs: {
      9: { name: 'Lawyer', ability: 'Loophole: Your Ascension Pouch math has ±1 leeway this turn; if you Ascend using the leeway, keep 1 used ingredient card in your Pouch.', acting: 'Play a card numbered 6 or lower into a trick.', tag: 'math_plus_minus_1' },
      8: { name: 'Barbarian', ability: 'Brute Force: Your next Sword or Wand this round ignores Knights and Queens.', acting: 'Resolve a Sword or Wand without being blocked.', tag: 'unblockable_next' },
      7: { name: 'Briber', ability: 'Bribe: Give 1 card to target opponent; they cannot target you this round and you draw 2.', acting: 'Give a card to an opponent via Bribe.', tag: 'bribe_opp' },
      6: { name: 'Baron of Corruption', ability: 'Distort: Invert trick rankings (lowest Number wins!); after the trick, take 1 played trick card into your Pouch.', acting: 'Win a trick with a card valued 4 or lower.', tag: 'invert_trick' },
      5: { name: 'Mentor of Disorder', ability: 'Disorder: Each opponent (everyone except you) passes 1 random Hand card to the left.', acting: 'Trigger Disorder or play a newly gained card.', tag: 'disorder_pass' },
      4: { name: 'Earl of the Fallen', ability: 'Magnify: Double the effect of your next Suit Action this round.', acting: 'Trigger a doubled Suit Action.', tag: 'double_suit' },
      3: { name: 'Frenzied Mage', ability: 'Weaken: Reduce target opponent\'s played trick card value by -3 (min 1).', acting: 'Win a trick after weakening an opponent.', tag: 'weaken_opp' },
      2: { name: 'Duke of Entropy', ability: 'Exploit: Immediately draw 2 cards from the Deck.', acting: 'Draw cards outside normal start-of-turn draw.', tag: 'draw_2' },
      1: { name: 'Prince of Abolition', ability: 'Abolish: Cancel the Trump Suit and all 10-overrides for this trick.', acting: 'Win a trick while Trump is abolished.', tag: 'abolish_trump' }
    }
  },
  {
    id: 5, arcana: 'The Hierophant', lotm: 'Tyrant (Sailor)', lever: 'Leading & Storm AoE',
    playstyle: 'Storm dominance: steals the Lead, hits all opponents with multi-target Swords/Wands, and crushes large hands.',
    chaosTiming: 'Anytime', chaosDesc: 'Name Trump Suit; every opponent without it in Hand discards 1 card.',
    seqs: {
      9: { name: 'Sailor', ability: 'Sea Legs: Gain +1 trick value (max 9) and draw 1 if you lead the trick.', acting: 'Lead a trick or win a trick.', tag: 'trick_plus_1' },
      8: { name: 'Folk of Rage', ability: 'Fury: Discard 1 Hand card to gain +3 trick value (max 9); if you win the trick, draw 1 card.', acting: 'Win a trick with a card valued 7 or higher.', tag: 'fury_boost' },
      7: { name: 'Seafarer', ability: 'Storm Surge: Draw 2 cards from Deck and discard 1 card from Hand.', acting: 'Draw 2+ cards in a single turn.', tag: 'cycle_2_1' },
      6: { name: 'Wind-Blessed', ability: 'Gale: Gain +2 trick value and treat your card as Leading Suit.', acting: 'Win a trick with Gale active.', tag: 'trick_plus_2' },
      5: { name: 'Ocean Songster', ability: 'Siren Song: Every opponent with more Hand cards than you discards 1 card.', acting: 'Force an opponent to discard a card.', tag: 'siren_song' },
      4: { name: 'Cataclysmic Interrer', ability: 'Tsunami: Destroy 1 random Pouch card from EVERY opponent; draw 1 card for each opponent whose Pouch card was destroyed.', acting: 'Destroy a Pouch card.', tag: 'tsunami_aoe' },
      3: { name: 'Sea King', ability: 'Lightning Strike: Destroy the center Trump Card (replace from Deck) and draw 1 card.', acting: 'Replace the center Trump Card.', tag: 'replace_trump_draw' },
      2: { name: 'Thunder God', ability: "Thunderclap: Opponents' non-Trump cards get -3 trick value (min 1) this trick.", acting: 'Win a trick with Thunderclap.', tag: 'thunderclap' },
      1: { name: 'Tyrant', ability: 'Wrath of the Sea: Every opponent discards 2 cards from Hand (or 1 if low).', acting: 'Win a trick while an opponent has ≤3 Hand cards.', tag: 'wrath_sea' }
    }
  },
  {
    id: 6, arcana: 'The Lovers', lotm: 'Error (Marauder)', lever: 'Theft, Swaps & Hijacking',
    playstyle: 'Parasitism: steals cards directly, hijacks Sequence Abilities and Trick rewards, and swaps played cards.',
    chaosTiming: 'Anytime', chaosDesc: 'Choose an opponent; you and they each take 1 random card from the other\'s Hand.',
    seqs: {
      9: { name: 'Marauder', ability: 'Pickpocket: Steal 1 random card from target opponent\'s Hand and give 1 back.', acting: 'Swap or steal a card from an opponent.', tag: 'hand_swap_opp' },
      8: { name: 'Swindler', ability: 'Con: Swap 1 card in your Pouch with the top card of the Deck.', acting: 'Swap a card into your Pouch.', tag: 'pouch_swap_deck' },
      7: { name: 'Cryptologist', ability: 'Steal 1 face-down card from target opponent\'s Pouch into your Hand (ignores Page!).', acting: 'Steal a card from an opponent\'s Pouch.', tag: 'steal_pouch_safe' },
      6: { name: 'Prometheus', ability: 'Theft of Fire: Trigger the Suit Action of the top Minor Arcana in the Grave.', acting: 'Resolve a copied Suit Action.', tag: 'scribe_grave' },
      5: { name: 'Dream Stealer', ability: 'Steal Thought: Copy target opponent\'s Sequence Ability and lock theirs this round.', acting: 'Use a stolen ability.', tag: 'copy_ability' },
      4: { name: 'Parasite', ability: 'Parasitize: Draw 1 card now and 1 extra card when the trick resolves.', acting: 'Draw an extra card via Parasite.', tag: 'draw_2' },
      3: { name: 'Mentor of Deceit', ability: 'Swap Fate: Steal the highest card from target opponent\'s Hand for your lowest.', acting: 'Win a trick after swapping cards.', tag: 'swap_best_hand' },
      2: { name: 'Trojan Horse of Destiny', ability: 'Hijack: Swap 1 card from your Hand with the center Trump Card immediately.', acting: 'Claim a Trump Card via Hijack or Trick Win.', tag: 'hijack_trump' },
      1: { name: 'Worm of Time', ability: 'Steal Time: Force target opponent to either discard 1 Hand card OR skip their next turn.', acting: 'Win a trick when an opponent skips a turn or discards.', tag: 'steal_time' }
    }
  },
  {
    id: 7, arcana: 'The Chariot', lotm: 'Red Priest (Hunter)', lever: 'War Chains & Aggression',
    playstyle: 'Relentless warfare: provokes rivals, chains multi-target Wands/Swords, and weaponizes Knights and Kings.',
    chaosTiming: 'Trick', chaosDesc: 'Leading Suit cannot be trumped this trick (ignores Trump Suit and 10s).',
    seqs: {
      9: { name: 'Hunter', ability: 'Track: Peek at target opponent\'s Pouch and gain +1 trick value this round.', acting: 'Destroy an opponent\'s Pouch card with a Sword.', tag: 'hunter_track' },
      8: { name: 'Provoker', ability: 'Taunt: Force target opponent to discard 1 card and shield yourself from next attack.', acting: 'Block an attack or force a discard.', tag: 'taunt_discard' },
      7: { name: 'Pyromaniac', ability: 'Fireball: Discard 1 Hand card to force TWO opponents to each discard 1 card.', acting: 'Force 2+ opponents to discard in one round.', tag: 'pyro_aoe' },
      6: { name: 'Conspirator', ability: 'Conspiracy: Destroy 1 Pouch card from Opponent A and force Opponent B to discard 1.', acting: 'Hit two different opponents in one turn.', tag: 'conspirator_dual' },
      5: { name: 'Reaper', ability: 'Fatal Strike: Destroy 1 Pouch card from target opponent AND steal 1 from their Hand.', acting: 'Win a trick with a Sword or use Fatal Strike.', tag: 'reaper_strike' },
      4: { name: 'Iron-Blooded Knight', ability: 'Chain of Command: Your Knights & Kings can win tricks (value 11, beats 10s!).', acting: 'Win a trick using a Face Card.', tag: 'face_can_win' },
      3: { name: 'War Bishop', ability: 'Declare War: Every player who loses this trick must discard 1 card from Hand.', acting: 'Win a trick during a War round.', tag: 'declare_war' },
      2: { name: 'Weather Warlock', ability: 'Storm of Blades: Change Trump Suit to Swords and gain +2 trick value.', acting: 'Win a trick where Swords is Trump.', tag: 'weather_swords' },
      1: { name: 'Conqueror', ability: 'Subjugation: Disable opponent Knights/Queens/Abilities this round and force 1 discard.', acting: 'Force an opponent to lose a turn or Pouch card.', tag: 'conqueror_lock' }
    }
  },
  {
    id: 8, arcana: 'Strength', lotm: 'Twilight Giant (Warrior)', lever: 'Knights, Queens & Armor',
    playstyle: 'Defensive fortress: wins numeric ties, turns Pentacles into Knights, shields the Pouch, and counters attacks.',
    chaosTiming: 'Trick', chaosDesc: 'For the rest of this turn, all Pouches are immune to Swords and Hands immune to Wands.',
    seqs: {
      9: { name: 'Warrior', ability: 'Combat Mastery: If you lose a trick this round, take the winning card into your Hand.', acting: 'Play a Sword or Knight during the round.', tag: 'warrior_mastery' },
      8: { name: 'Pugilist', ability: 'Counter-Punch: Shield your Hand & Pouch once; if hit, attacker discards 1 card.', acting: 'Block an attack or play a card ≥ 5.', tag: 'counter_shield' },
      7: { name: 'Weapon Master', ability: 'Fortify: Protect your Pouch from Swords this round and draw 1 card.', acting: 'Destroy an opponent Pouch card (Sword) or block a Sword.', tag: 'pouch_immune_draw' },
      6: { name: 'Dawn Paladin', ability: 'Armor of Light: Any Sword attacking your Pouch enters your Pouch instead (or Hand if Pouch is full).', acting: 'End a round with 0 Pouch cards lost.', tag: 'dawn_paladin' },
      5: { name: 'Guardian', ability: 'Shield Wall: Protect both Hand & Pouch from all Swords/Wands/Kings this round.', acting: 'End 2 rounds without losing a card from Hand or Pouch.', tag: 'blink_immune' },
      4: { name: 'Demon Hunter', ability: 'Weakness Strike: Destroy 1 Pouch card from target opponent (ignores Page Traps & Knights).', acting: 'Destroy a card in an opponent\'s Pouch.', tag: 'demon_hunter_strike' },
      3: { name: 'Silver Knight', ability: 'Mercury Liquefaction: Pull any Knight or Queen from Grave into Hand (else draw 2).', acting: 'Play any Face Card.', tag: 'grave_defense_pull' },
      2: { name: 'Glory', ability: 'Twilight Aura: All opponents\' trick cards get -2 numeric value (min 1) this trick.', acting: 'Win a trick with the highest value.', tag: 'glory_aura' },
      1: { name: 'Hand of God', ability: 'Sever: Destroy target opponent\'s Pouch card, cancel active Laws, and gain +2 trick value.', acting: 'Win a trick with a 10, Ace, or Sever.', tag: 'hand_of_god' }
    }
  },
  {
    id: 9, arcana: 'The Hermit', lotm: 'White Tower (Reader)', lever: 'Hand Deduction & Copying',
    playstyle: 'Information mastery: guesses hidden Hand cards for draws, copies abilities, and predicts winning Suits.',
    chaosTiming: 'Anytime', chaosDesc: 'Take the top card from the Grave into your Hand (before recycling 9).',
    seqs: {
      9: { name: 'Reader', ability: 'Speed Read: Peek at the top card of the Deck; keep it on top or move it to the bottom of the Deck.', acting: 'Guess a Suit correctly or use Reader.', tag: 'reader_scry' },
      8: { name: 'Student of Ratiocination', ability: "Deduce: Reveal 1 random card from target opponent's Hand and the top card of the Deck—you take one, opponent takes the other.", acting: "Reveal a card in an opponent's Hand.", tag: 'student_deduce' },
      7: { name: 'Detective', ability: 'Inspect Clues: Pull 1 card from the top 3 of the Grave into your Hand.', acting: 'Take a card from the Grave into Hand.', tag: 'grave_peek_take' },
      6: { name: 'Polymath', ability: 'Imitate: Copy and immediately trigger target opponent\'s current Sequence Ability.', acting: 'Use an imitated Sequence Ability.', tag: 'copy_ability' },
      5: { name: 'Mysticism Magister', ability: 'Spell Analysis: Draw 2 cards from the Deck, then place 1 card from your Hand on the bottom of the Deck.', acting: 'Trigger a Pentacle draw or Spell Analysis.', tag: 'mysticism_cycle' },
      4: { name: 'Prophet', ability: 'Foresight: Peek at top 2 of Deck and gain +2 trick value this round.', acting: 'Win a trick after using Foresight.', tag: 'prophet_foresight' },
      3: { name: 'Cognizer', ability: 'Total Recall: Reveal target opponent\'s entire Hand and draw 1 card.', acting: 'View an opponent\'s Hand.', tag: 'deduce_reveal' },
      2: { name: 'Wisdom Angel', ability: "Omniscient Deduction: Steal 1 Trump-suited (or random) card from target opponent's Hand.", acting: "Steal a Trump-suited card from an opponent's Hand.", tag: 'steal_trump_hand' },
      1: { name: 'Omniscient Eye', ability: 'Perfect Counter: Draw 2 cards from Deck and tuck 1 directly into your Pouch.', acting: 'Add a card directly from Deck to Pouch & win trick.', tag: 'omniscient_eye' }
    }
  },
  {
    id: 10, arcana: 'Wheel of Fortune', lotm: 'Monster', lever: 'Probability, Pairs & Luck',
    playstyle: 'Fate manipulation: profits from matching Pairs/Numbers, widens Suit-Guess odds, and forces redraws/reboots.',
    chaosTiming: 'Anytime', chaosDesc: 'Every player passes 1 card from Hand to the left, then draws 1 card from the Deck.',
    seqs: {
      9: { name: 'Monster', ability: 'Sixth Sense: Replace the center Trump Card with the top card of the Deck.', acting: 'Draft or hold a matching pair of Numbers.', tag: 'swap_trump_deck' },
      8: { name: 'Robot', ability: 'Precision: If you hold a matching Number Pair in Hand, draw 2 cards (else draw 1).', acting: 'Hold a matching Pair of Numbers in Hand.', tag: 'robot_pair' },
      7: { name: 'Lucky One', ability: 'Lucky Draw: Your Suit-Guess Gamble lets you pick TWO suits this round (+1 draw).', acting: 'Win a trick.', tag: 'lucky_two_suits' },
      6: { name: 'Calamity Priest', ability: 'Bad Luck: Target opponent discards the top card of the Deck and 1 from Hand.', acting: 'Cause an opponent to discard a card.', tag: 'calamity_jinx' },
      5: { name: 'Winner', ability: 'Jackpot: If your played card matches Trump Suit or Number, gain +4 value (max 10).', acting: 'Play a card matching Trump Suit or Number.', tag: 'jackpot_boost' },
      4: { name: 'Misfortune Mage', ability: 'Jinx: Force target opponent to discard 1 random card and draw a replacement.', acting: 'Force an opponent to cycle/change their Hand.', tag: 'jinx_cycle' },
      3: { name: 'Chaoswalker', ability: 'Twist of Fate: Replace the Trump Card from Deck and draw 1 card.', acting: 'Play a trick after Trump Card changed.', tag: 'replace_trump_draw' },
      2: { name: 'Soothsayer', ability: 'Prophecy of Luck: Flip top 2 cards of Deck—keep all even-numbered cards (min 1).', acting: 'Gain a card from a blind Deck flip.', tag: 'soothsayer_flip' },
      1: { name: 'Snake of Mercury', ability: 'Reboot: Return all cards played so far in this trick to owners\' Hands and draw 2!', acting: 'Win a trick after Reboot or a Chaos Event.', tag: 'reboot_trick' }
    }
  },
  {
    id: 11, arcana: 'Justice', lotm: 'Visionary (Spectator)', lever: 'Hand Size & Secret Influence',
    playstyle: 'Quiet control: thrives when uninvolved, reads Hands, plants hypnotic traps, and predicts trick winners.',
    chaosTiming: 'Anytime', chaosDesc: 'Player with the most Hand cards gives 1 card to the player with the fewest.',
    seqs: {
      9: { name: 'Spectator', ability: 'Observe: Draw 1 card if you have not played a Sword or Wand this round.', acting: 'Complete a round without being targeted by Swords/Wands.', tag: 'spectator_draw' },
      8: { name: 'Telepathist', ability: "Read Mind: Reveal 2 random cards in target opponent's Hand; draw 1 card from Deck for each revealed card matching the Trump Suit.", acting: "Reveal a card in an opponent's Hand.", tag: 'telepathist_reveal' },
      7: { name: 'Psychiatrist', ability: 'Frenzy: Force target opponent to discard 1 card from Hand (triggers no Queen).', acting: 'Cause an opponent to discard without playing a Wand.', tag: 'frenzy_discard' },
      6: { name: 'Hypnotist', ability: 'Hypnotic Cue: Steal 1 random card from target opponent if they hold 5+ cards (else draw 1).', acting: 'Trigger Hypnotist steal or draw.', tag: 'hypnotist_steal' },
      5: { name: 'Dreamwalker', ability: 'Dream Swap: Secretly swap 1 card in your Pouch with 1 card in target opponent\'s Pouch.', acting: 'Swap a face-down card between your Pouch and an opponent\'s Pouch.', tag: 'pouch_swap_opp' },
      4: { name: 'Manipulator', ability: 'Virtual Persona: Reveal 1 card from every opponent\'s Hand; richest opponent discards 1.', acting: 'Have 2+ opponents reveal Hand cards in one round.', tag: 'manipulator_aoe' },
      3: { name: 'Dream Weaver', ability: 'False Lead: Reduce target opponent\'s trick value by -3 this trick.', acting: 'Force an opponent to lose a trick.', tag: 'weaken_opp' },
      2: { name: 'Discerner', ability: 'Discern: Look at target opponent\'s Hand and steal 1 Trump-suited card (or random).', acting: 'Steal or reveal a Trump-suited card from an opponent\'s Hand.', tag: 'steal_trump_hand' },
      1: { name: 'Author', ability: 'Coincidence: Draw 2 cards from Deck; optionally tuck 1 into your Pouch.', acting: 'Hold 5+ cards in Hand or 3 cards in your Pouch.', tag: 'author_coincidence' }
    }
  },
  {
    id: 12, arcana: 'The Hanged Man', lotm: 'Secrets Suppliant', lever: 'Self-Sacrifice & Substitution',
    playstyle: 'Dark sacrifice: voluntarily burns Hand/Pouch cards for explosive draws, Grazing wildcards, and Grave Chaos copies.',
    chaosTiming: 'Anytime', chaosDesc: 'Discard 2 Hand cards to immediately tuck the top 2 cards of the Deck into your Pouch.',
    seqs: {
      9: { name: 'Secrets Suppliant', ability: 'Listen: Discard 1 card from Hand to draw 2 cards from the Deck.', acting: 'Voluntarily discard a card via an ability.', tag: 'cycle_2_1' },
      8: { name: 'Listener', ability: 'Whispers: Discard 1 Hand card to take any 1 card from the top 3 of the Grave.', acting: 'Take a card from Grave after discarding.', tag: 'listener_grave' },
      7: { name: 'Shadow Ascetic', ability: 'Shadow Hide: Make your Hand & Pouch immune to attacks this round.', acting: 'End a round without losing a card from Hand or Pouch.', tag: 'shadow_sacrifice' },
      6: { name: 'Rose Bishop', ability: 'Flesh & Blood: Move the top card of the Grave directly into your Pouch (or Hand if Pouch is full).', acting: 'Move a card from Grave into your Pouch or Hand.', tag: 'grave_to_pouch_sac' },
      5: { name: 'Shepherd', ability: 'Grazing: Pull top card of Grave into Hand and gain ±2 Ascension Math leeway this turn.', acting: 'Graze a card or ascend with leeway.', tag: 'math_plus_minus_2' },
      4: { name: 'Black Knight', ability: 'Dark Substitution: Discard 1 Hand card so 1 card in your Pouch acts as a Wildcard fulfilling your Ascension math this turn.', acting: 'Sacrifice 1 Hand card via Dark Substitution.', tag: 'dark_sub_4' },
      3: { name: 'Trinity Templar', ability: 'Blood Ritual: Discard 1 Hand card to force EVERY opponent to discard 1 card.', acting: 'Force 2+ opponents to discard in one round.', tag: 'blood_ritual' },
      2: { name: 'Profane Presbyter', ability: 'Degenerate: Destroy 1 own Pouch card to turn your next trick card into a Trump 10!', acting: 'Win a trick after sacrificing a Pouch card.', tag: 'degenerate_10' },
      1: { name: 'Dark Angel', ability: 'Shadow Dominion: Discard 1 Hand card to pull a Major Arcana from Grave (or draw 2).', acting: 'Resolve a Major Arcana effect.', tag: 'grave_major_to_hand' }
    }
  },
  {
    id: 13, arcana: 'Death', lotm: 'Corpse Collector', lever: 'The Graveyard Zone',
    playstyle: 'Necromancy: treats the top of the Grave as an active Hand/Pouch and harvests Major Arcana recycle triggers.',
    chaosTiming: 'Anytime', chaosDesc: 'Destroy 1 random face-down card from EVERY player\'s Pouch (before recycling 13).',
    seqs: {
      9: { name: 'Corpse Collector', ability: 'Undead Touch: Pull the best card from the top 3 of the Grave into your Hand.', acting: 'Take a card from the Grave into Hand.', tag: 'grave_peek_take' },
      8: { name: 'Gravedigger', ability: 'Exhume: Swap 1 card in your Hand with the top card of the Grave.', acting: 'Complete a swap with the Grave.', tag: 'exhume_swap' },
      7: { name: 'Spirit Medium', ability: 'Spirit Channel: Pull any Face Card from the Grave into your Hand (else top Grave).', acting: 'Play a Face Card or pull from Grave.', tag: 'grave_face_pull' },
      6: { name: 'Spirit Guide', ability: 'Soul Harvest: Pull 1 card from Grave and draw 1 if Grave has 4+ cards.', acting: 'Take a card from Grave when Grave has 4+ cards.', tag: 'soul_harvest' },
      5: { name: 'Gatekeeper', ability: 'Underworld Gate: Pull any Minor Arcana matching the Trump Suit from Grave into Hand.', acting: 'Pull a card from the Grave into Hand.', tag: 'grave_trump_pull' },
      4: { name: 'Undying', ability: 'Revive: Draw 2 cards from the Grave into your Hand (prevents losing a turn!).', acting: 'Pull 2 cards from Grave or survive low Hand.', tag: 'undying_revive' },
      3: { name: 'Ferryman', ability: 'River of Darkness: Swap 1 random card in target opponent\'s Pouch with top of Grave.', acting: 'Swap an opponent\'s Pouch card with Grave.', tag: 'ferryman_swap' },
      2: { name: 'Death Consul', ability: 'Pale Decree: Gain +1 trick value for every 3 cards in the Grave (max +3).', acting: 'Win a trick with Pale Decree active.', tag: 'pale_decree' },
      1: { name: 'Pale Emperor', ability: 'Enslave the Dead: Move up to 2 numbered cards from Grave directly into your Pouch!', acting: 'Add a card directly from Grave into Pouch.', tag: 'pale_emperor' }
    }
  },
  {
    id: 14, arcana: 'Temperance', lotm: 'Chained (Prisoner)', lever: 'Restraint & Burst Turns',
    playstyle: 'Delayed power: imposes self-restraint to charge curses, hardened defense, and unchained multi-pouch bursts.',
    chaosTiming: 'Trick', chaosDesc: 'Cancel the Suit Action or King/10/Ace effect of the Minor Arcana card just played.',
    seqs: {
      9: { name: 'Prisoner', ability: 'Restraint: Empty 1 card from Pouch to Hand to draw 2 cards from the Deck.', acting: 'End a round with 0 or 1 card in Pouch.', tag: 'prisoner_restraint' },
      8: { name: 'Lunatic', ability: 'Frenzy Burst: Your next Sword or Wand this round hits TWICE!', acting: 'Play a Sword or Wand during the round.', tag: 'double_suit' },
      7: { name: 'Werewolf', ability: 'Bloodlust: Gain +2 trick value (max 9); +3 if you hold 4 or fewer Hand cards.', acting: 'Win a trick while Bloodlust is active.', tag: 'werewolf_blood' },
      6: { name: 'Zombie', ability: 'Hardened Skin: Pouch is immune to Swords valued ≤6 this round; draw 1 card.', acting: 'Survive a round without losing a Pouch card.', tag: 'pouch_immune_draw' },
      5: { name: 'Wraith', ability: 'Possession: Lock target opponent from Ascending this round and force 1 discard.', acting: 'Delay an opponent or force a discard.', tag: 'wraith_possess' },
      4: { name: 'Puppet', ability: 'Curse Doll: Discard 1 Hand card to destroy 1 Pouch card & 1 Hand card from target opponent.', acting: 'Force an opponent to lose cards.', tag: 'puppet_curse' },
      3: { name: 'Disciple of Silence', ability: 'Silence: Disable target opponent\'s Suit Action & Sequence Ability this round.', acting: 'Win a trick after silencing an opponent.', tag: 'silence_opp' },
      2: { name: 'Ancient Bane', ability: 'Curse of Restraint: Every opponent with 5+ Hand cards discards 1; gain +2 trick value.', acting: 'Win a trick while Curse of Restraint is active.', tag: 'ancient_bane' },
      1: { name: 'Abomination', ability: 'Unchained: Tuck 2 extra cards from Hand into Pouch (Pouch limit raised to 5 this turn!).', acting: 'Hold 4+ cards in your Pouch at once.', tag: 'abomination_unchain' }
    }
  },
  {
    id: 15, arcana: 'The Devil', lotm: 'Abyss (Criminal)', lever: 'Turn-Skip & Hand Starvation',
    playstyle: 'Attrition & corruption: drains opponents to 0 cards to force skipped turns and punishes low-hand rivals.',
    chaosTiming: 'Anytime', chaosDesc: 'Every opponent must either discard 1 card from Hand or destroy 1 from Pouch.',
    seqs: {
      9: { name: 'Criminal', ability: 'Cold-Blooded: Force target opponent to discard their highest numbered Hand card.', acting: 'Force an opponent to discard a card.', tag: 'criminal_discard' },
      8: { name: 'Unwinged Angel', ability: 'Danger Sense: Shield your Hand & Pouch from the next attack this round.', acting: 'Cancel an attack or take 0 hits this round.', tag: 'counter_shield' },
      7: { name: 'Serial Killer', ability: 'Blood Trail: Destroy 1 Pouch card from target opponent (2 if they have ≤4 Hand cards).', acting: 'Target an opponent with 4 or fewer Hand cards.', tag: 'serial_killer' },
      6: { name: 'Devil', ability: 'Desire: Steal 1 random Hand card from target opponent (or destroy 1 Pouch card if empty).', acting: 'Steal a card or destroy a Pouch card via Desire.', tag: 'devil_desire' },
      5: { name: 'Desire Apostle', ability: 'Temptation: Every opponent with more cards than you discards 1 card.', acting: 'Trigger Temptation on an opponent.', tag: 'siren_song' },
      4: { name: 'Demon', ability: 'Abyssal Filth: Every opponent holding >5 Hand cards discards down to 5 immediately.', acting: 'Force an opponent to discard via Abyssal Filth.', tag: 'abyssal_filth' },
      3: { name: 'Blatherer', ability: 'Demonic Ravings: Target opponent discards 2 random cards from Hand!', acting: 'Reduce an opponent to ≤2 Hand cards or skip.', tag: 'blatherer_2' },
      2: { name: 'Bloody Archduke', ability: 'Massacre: Discard 1 Hand card to destroy 1 Pouch card from every opponent with ≤5 Hand.', acting: 'Destroy a Pouch card from a low-hand opponent.', tag: 'massacre_aoe' },
      1: { name: 'Filthy Monarch', ability: 'Corruption: Target opponent discards 2 cards; if they hit 0 cards, you draw 2 & tuck 1!', acting: 'Force an opponent to lose a turn or ≤1 Hand.', tag: 'filthy_monarch' }
    }
  },
  {
    id: 16, arcana: 'The Tower', lotm: 'Paragon (Savant)', lever: 'Face Cards & Alchemy Math',
    playstyle: 'Alchemy & artifacts: subtracts Pouch math, forges Face Cards into table Artifacts, and transmutes Suits.',
    chaosTiming: 'Trick', chaosDesc: 'Destroy the center Trump Card and replace it with the top card in the Grave.',
    seqs: {
      9: { name: 'Savant', ability: 'Precision Math: You may SUBTRACT Pouch card values when ascending this turn (e.g. 9-1=8).', acting: 'Play a Pentacle or hold 2+ Pouch cards.', tag: 'savant_subtract' },
      8: { name: 'Archaeologist', ability: 'Excavate: Look at bottom 3 cards of Deck and draw 1 into Hand.', acting: 'Draw or excavate a card from the Deck.', tag: 'draw_1_peek' },
      7: { name: 'Appraiser', ability: 'Appraise: Draw 1 card (2 if you hold a Face Card in Hand).', acting: 'Hold or reveal a Face Card during the round.', tag: 'appraiser_draw' },
      6: { name: 'Artisan', ability: 'Forge Artifact: Gain +2 trick value this round (max 9) and draw 1 card.', acting: 'Activate Forge Artifact during a trick.', tag: 'artisan_artifact' },
      5: { name: 'Astronomer', ability: 'Star Alignment: Your 10s count as Aces, and your Aces count as any Number (1–9) in Pouch!', acting: 'Play a 10/Ace or tuck one in Pouch.', tag: 'astronomer_wild' },
      4: { name: 'Alchemist', ability: 'Transmute: Your next played trick card counts as the Trump Suit!', acting: 'Win a trick using a transmuted card.', tag: 'transmute_trump' },
      3: { name: 'Arcane Scholar', ability: 'Sealed Armory: Pull any Face Card from the Grave into your Hand (else draw 1).', acting: 'Play a Face Card during the round.', tag: 'grave_face_pull' },
      2: { name: 'Knowledge Moor', ability: 'Master Blueprint: Your Kings can win tricks (value 10) AND reveal/steal!', acting: 'Play a King or win a trick with +2.', tag: 'face_can_win' },
      1: { name: 'Illuminator', ability: 'Civilization\'s Light: You may Ascend using cards directly from your Hand this turn!', acting: 'Win a trick with a Face Card, 10, or Ace.', tag: 'hand_ascend' }
    }
  },
  {
    id: 17, arcana: 'The Star', lotm: 'Darkness (Sleepless)', lever: 'Turn Order & Concealment',
    playstyle: 'Concealment: excels playing last, puts rival Hand/Pouch cards to "Sleep," and conceals plays face-down.',
    chaosTiming: 'Anytime', chaosDesc: 'Secretly inspect target opponent\'s Pouch and draw 1 card from the Deck.',
    seqs: {
      9: { name: 'Sleepless', ability: 'Night Owl: Draw 1 card from the Deck (+1 trick value if playing last).', acting: 'Play last in a trick or use Night Owl.', tag: 'night_owl' },
      8: { name: 'Midnight Poet', ability: 'Lullaby: Put target opponent\'s highest card to sleep (they discard 1, draw 1).', acting: 'Trigger Lullaby or draft a card.', tag: 'jinx_cycle' },
      7: { name: 'Nightmare', ability: 'Pull into Dream: Force target opponent to discard 1 random card from Hand.', acting: 'Disrupt an opponent\'s Hand.', tag: 'frenzy_discard' },
      6: { name: 'Soul Assurer', ability: 'Requiem: Cancel all Sword & Wand actions targeting you this round.', acting: 'Complete a trick taking 0 Sword/Wand hits.', tag: 'blink_immune' },
      5: { name: 'Spirit Warlock', ability: 'Concealment: Conceal your Pouch—immune to Swords, peeks & swaps this round.', acting: 'Keep your Pouch untouched for a round.', tag: 'pouch_immune_draw' },
      4: { name: 'Nightwatcher', ability: 'Horror Aura: Gain +2 trick value and reverse turn priority for ties.', acting: 'Win a trick with Horror Aura.', tag: 'trick_plus_2' },
      3: { name: 'Horror Bishop', ability: 'Sleep of Concealment: Lock target opponent from Ascending this round.', acting: 'Lock an opponent\'s Pouch for a round.', tag: 'wraith_possess' },
      2: { name: 'Servant of Concealment', ability: 'Erase Presence: Your next played trick card ignores Leading Suit and counts as Trump!', acting: 'Win a trick with a concealed card.', tag: 'transmute_trump' },
      1: { name: 'Knight of Misfortune', ability: 'Eternal Night: Every opponent discards 1 card; if you win the trick, draw 2!', acting: 'Win a trick while Eternal Night is active.', tag: 'eternal_night' }
    }
  },
  {
    id: 18, arcana: 'The Moon', lotm: 'Moon (Apothecary)', lever: 'Pouch Swaps & Elixirs',
    playstyle: 'Fluid alchemy: swaps freely between Hand/Pouch/Grave, turns Cups into Trump cards, and steals with Swords.',
    chaosTiming: 'Anytime', chaosDesc: 'Shuffle all face-down cards from every player\'s Pouch together and deal back equally.',
    seqs: {
      9: { name: 'Apothecary', ability: 'Herbalism: Swap 1 card in your Hand with 1 card in your Pouch.', acting: 'Swap a card between Hand and Pouch.', tag: 'swap_own_pouch' },
      8: { name: 'Beast Tamer', ability: 'Familiar: Draw 1 card from top of Grave (or Deck if Grave empty).', acting: 'Play a Cup during a trick.', tag: 'grave_peek_take' },
      7: { name: 'Vampire', ability: 'Blood Drain: Steal 1 face-down card from target opponent\'s Pouch into your Hand.', acting: 'Steal a card from an opponent\'s Pouch.', tag: 'steal_pouch_safe' },
      6: { name: 'Potions Professor', ability: 'Brew Elixir: Tuck 1 extra card from Hand into your Pouch immediately (up to 3).', acting: 'Add 2 cards to your Pouch in one round.', tag: 'extra_pouch_add' },
      5: { name: 'Scarlet Scholar', ability: 'Full Moon: Your Cups count as the Trump Suit this trick!', acting: 'Win a trick using a Cup card.', tag: 'cups_are_trump' },
      4: { name: 'Shaman King', ability: 'Moonlight Swap: Swap 1 card in your Pouch with the top card of the Grave.', acting: 'Swap a card between Grave and Pouch.', tag: 'pouch_swap_grave' },
      3: { name: 'High Summoner', ability: 'Summon Spirit: Pull 1 Knight or Queen from Grave into Hand (else draw 2).', acting: 'Pull a Face Card from Grave or play one.', tag: 'grave_defense_pull' },
      2: { name: 'Life-Giver', ability: 'Vitality: Draw 2 cards from the Deck (3 if you have ≤3 Hand cards).', acting: 'End a round with 6+ cards in Hand.', tag: 'life_giver' },
      1: { name: 'Beauty Goddess', ability: 'Crimson Moon: Steal 1 Pouch card from target opponent and draw 1 from Deck.', acting: 'Swap/steal from an opponent\'s Pouch & win trick.', tag: 'crimson_moon' }
    }
  },
  {
    id: 19, arcana: 'The Sun', lotm: 'Sun (Bard)', lever: 'Purification & Contracts',
    playstyle: 'Radiant control: refills hands via mutual pacts, purifies traps/Chaos Events, and boosts Cups and Pentacles.',
    chaosTiming: 'Anytime', chaosDesc: 'Draw 1 card from the Deck, and immediately tuck 1 extra card into your Pouch.',
    seqs: {
      9: { name: 'Bard', ability: 'Inspire: You and target opponent each draw 1 card from the Deck.', acting: 'Cause yourself and an opponent to draw in one turn.', tag: 'bard_inspire' },
      8: { name: 'Light Suppliant', ability: 'Flash of Light: Reveal top of Deck—draw it (+1 more if it is a Cup or Pentacle).', acting: 'Play or reveal a Cup or Pentacle.', tag: 'flash_light' },
      7: { name: 'Solar High Priest', ability: 'Purify: Shield yourself from traps/debuffs this round and draw 1 card.', acting: 'Play a Cup or Pentacle taking 0 hits.', tag: 'pouch_immune_draw' },
      6: { name: 'Notary', ability: 'Notarized Pact: Swap 1 card with target opponent; both of you draw 1 extra card.', acting: 'Complete a trade or draw via Notary.', tag: 'notary_pact' },
      5: { name: 'Priest of Light', ability: 'Sun\'s Protection: Your Hand cannot drop below 3 cards this round; draw 1 card.', acting: 'End a round with 4+ cards in Hand.', tag: 'sun_protect' },
      4: { name: 'Unshadowed', ability: 'Unshadowed Spear: Destroy 1 Pouch card from target opponent (ignores Page Traps!).', acting: 'Destroy an opponent\'s Pouch card.', tag: 'demon_hunter_strike' },
      3: { name: 'Justice Mentor', ability: 'Radiant Law: Clear negative locks on you and every player draws 1 card.', acting: 'Play a trick with Radiant Law active.', tag: 'radiant_law' },
      2: { name: 'Lightseeker', ability: 'Blazing Sun: Your Cups & Pentacles gain +3 trick value (max 9) this round.', acting: 'Win a trick with a Cup or Pentacle.', tag: 'sun_boost' },
      1: { name: 'White Angel', ability: 'Purification Halo: Draw 2 cards and clear all opponent round buffs.', acting: 'Win a trick holding 5+ Hand cards.', tag: 'white_angel' }
    }
  },
  {
    id: 20, arcana: 'Judgement', lotm: 'Justiciar (Arbiter)', lever: 'Prohibition & Laws',
    playstyle: 'Strict order: declares Forbidden Suits/Face Cards/Abilities, taxes rule-breakers, and enforces raw number tricks.',
    chaosTiming: 'Anytime', chaosDesc: 'Every opponent with cards in their Pouch must return 1 random Pouch card to their Hand.',
    seqs: {
      9: { name: 'Arbiter', ability: 'Authority: Gain +1 trick value; draw 1 card if you play Trump Suit this trick.', acting: 'Play the Leading Suit or Trump Suit.', tag: 'arbiter_auth' },
      8: { name: 'Sheriff', ability: 'Track: Peek at target opponent\'s Hand and draw 1 card from Deck.', acting: 'Draft a card or track an opponent.', tag: 'deduce_reveal' },
      7: { name: 'Interrogator', ability: 'Psychic Piercing: Force target opponent to discard 1 card (if they have Trump Suit, they lose 2).', acting: 'Force a discard via Interrogator.', tag: 'interrogator' },
      6: { name: 'Judge', ability: 'Prohibition: Forbid Swords this trick—anyone playing a Sword gives you 1 Hand card!', acting: 'Enforce a Prohibition during the trick.', tag: 'forbid_swords' },
      5: { name: 'Disciplinary Paladin', ability: 'Punishment: Forbid 10-overrides and Face Cards for opponents this round.', acting: 'Enforce Punishment for a round.', tag: 'spatial_lock' },
      4: { name: 'Imperative Mage', ability: 'Deprivation: Disable target opponent\'s Sequence Ability for this round and draw 1.', acting: 'Win a trick while an opponent is deprived.', tag: 'silence_opp' },
      3: { name: 'Chaos Hunter', ability: 'Order Restored: Cancel Trump overrides and draw 1 card from Deck.', acting: 'Win a trick without Trump overrides.', tag: 'abolish_trump' },
      2: { name: 'Balancer', ability: 'Balance of Power: Every opponent with more Hand cards than you discards down to match (max 2).', acting: 'End a round tied for or holding most Hand cards.', tag: 'balancer_equalize' },
      1: { name: 'Hand of Order', ability: 'Supreme Verdict: Cancel Trump Suit & 10s this trick, and gain +2 trick value!', acting: 'Win a trick under Supreme Verdict.', tag: 'supreme_verdict' }
    }
  },
  {
    id: 21, arcana: 'The World', lotm: 'Mother (Planter)', lever: 'Pouch Cultivation & Growth',
    playstyle: 'Patient cultivation: grows Pouch card values over time, mutates Ascension Math, and shields a full Pouch.',
    chaosTiming: 'Trick', chaosDesc: 'Immediately end the trick boost—gain +3 trick value (max 10) to seize the trick right now.',
    seqs: {
      9: { name: 'Planter', ability: 'Sow: Cultivate your Pouch—all your Pouch cards gain +1 leeway for Ascension Math!', acting: 'Keep a card in your Pouch for a full round.', tag: 'math_plus_minus_1' },
      8: { name: 'Doctor', ability: 'Heal: Recover the top card of the Grave into your Hand and shield Hand once.', acting: 'Play a Cup or recover a card from Grave.', tag: 'doctor_heal' },
      7: { name: 'Harvest Priest', ability: 'Bountiful Harvest: Draw 2 cards if your Pouch has 3 cards (else draw 1).', acting: 'Start or end a turn with 3 Pouch cards.', tag: 'harvest_draw' },
      6: { name: 'Biologist', ability: 'Crossbreed: Discard 1 Hand card to give your played trick card +3 value (max 9).', acting: 'Win a trick using a boosted card.', tag: 'fury_boost' },
      5: { name: 'Druid', ability: 'Life\'s Shield: Shield your Hand from Wands/Kings this round and draw 1 card.', acting: 'Block a Wand/King or play a Pentacle.', tag: 'blink_immune' },
      4: { name: 'Classical Alchemist', ability: 'Mutate: Adjust your Pouch Ascension sum by ±2 this turn and draw 1 card.', acting: 'Hold 2+ Pouch cards and trigger Mutate.', tag: 'math_plus_minus_2' },
      3: { name: 'Pallbearer', ability: 'Cycle of Life: Move the top Minor Arcana from Grave directly into your Pouch.', acting: 'Pull a card from Grave into Hand or Pouch.', tag: 'grave_to_pouch_free' },
      2: { name: 'Desolate Matriarch', ability: 'Overgrowth: Tuck 1 extra card from Hand into Pouch immediately and draw 1 card.', acting: 'Fill your Pouch to 3 cards in a turn.', tag: 'extra_pouch_add' },
      1: { name: 'Naturewalker', ability: 'World Tree: Pouch is completely immune this round AND gains ±2 Ascension leeway!', acting: 'Win a trick while holding 3 Pouch cards.', tag: 'world_tree' }
    }
  }
];

export {
  SUITS,
  SUIT_META,
  getCardSuit,
  RANK_LABELS,
  ROMAN,
  TARGETED_ABILITY_TAGS,
  PATHWAYS
};
