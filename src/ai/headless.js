import { PATHWAYS, SUITS, getCardSuit, TARGETED_ABILITY_TAGS } from '../data/constants.js';
import { shuffle, mulberry32, buildMinorDeck, buildMajorCard, cardCode, cardShortName, isNumberCard, isFaceCard } from '../utils/cards.js';
import { checkAscensionMath, findValidAscensionSubset, evaluateTrickWinner, getHandLimit } from '../utils/rules.js';
import { extractBoardFeatures } from './features.js';
import { isPolicyNet } from './PolicyNet.js';
import { policyPick, AT as PPO_AT } from './ppoBridge.js';
import { isBrowserRLNet } from './browserRL/BrowserRLNet.js';
import {
  pickDiscardCardIdx,
  discardSmart,
  applyHeadlessChaos,
  applyHeadlessAbility
} from './engineCore.js';

// Fast headless single-game simulator for Heuristic (Depth 1-3) & Neural Net RL training
function runHeadlessGame({ playerCount = 4, handLimitMode = '10-7', aiMode = 'nn_selfplay', heuristicDepth = 2, lookaheadDepth = 1, nn = null, refNN = null, nnEasy = null, nnSmall = null, nnMedium = null, nnLarge = null, nnHard = null, nnAscent = null, p1Config = null, p2Config = null, seatConfigs = null, training = false, learnFromHeuristic = false, fixedPathways = null, seed = null, maxRounds = 50, initialDealerIdx = 0 }) {
  const rng = seed !== null ? mulberry32(seed) : Math.random;
  const smallNet = nnSmall || nnEasy || (isBrowserRLNet(nn) && nn?.tier === 'small' ? nn : null) || (isPolicyNet(nn) && nn?.tier !== 'medium' && nn?.tier !== 'large' ? nn : null);
  const mediumNet = nnMedium || (isBrowserRLNet(nn) && nn?.tier === 'medium' ? nn : null) || (isPolicyNet(nn) && nn?.tier === 'medium' ? nn : null);
  const largeNet = nnLarge || (isBrowserRLNet(nn) && nn?.tier === 'large' ? nn : null);
  const actualCount = fixedPathways ? fixedPathways.length : playerCount;
  const chosenIds = fixedPathways ? [...fixedPathways] : shuffle(PATHWAYS.map(p => p.id), rng).slice(0, actualCount);
  const allMajor = PATHWAYS.map(p => buildMajorCard(p.id));
  let deck = shuffle([...buildMinorDeck(), ...allMajor], rng);
  let grave = [];

  const players = chosenIds.map((pid, idx) => ({
    id: idx,
    pathwayId: pid,
    seq: 9,
    minSeqLeadGap: 0,
    actingDone: false,
    safeRoundsCount: 0,
    abilityCastsThisSeq: 0,
    abilityUsed: false,
    skipNextTurn: false,
    lostTurns: 0,
    tricksWon: 0,
    abilitiesUsed: 0,
    chaosUsed: 0,
    handSum: 0,
    handSamples: 0,
    faceCounts: { K: 0, Q: 0, N: 0, P: 0 },
    suitCounts: { swords: 0, pentacles: 0, cups: 0, wands: 0 },
    hand: deck.splice(0, 7),
    pouch: [],
    mods: {},
    brain: seatConfigs && seatConfigs[idx]
      ? seatConfigs[idx].type
      : (p1Config && p2Config
        ? (idx === 0 ? p1Config.type : p2Config.type)
        : ((training && aiMode === 'nn_selfplay')
          ? (idx === 0 ? 'nn' : 'ref_nn')
          : aiMode === 'heuristic_vs_nn'
            ? (idx === 0 ? 'heuristic' : 'nn')
            : (aiMode === 'nn_vs_heuristic' ? (idx === 0 ? 'nn' : 'heuristic') : (aiMode === 'nn_selfplay' ? 'nn' : 'heuristic')))),
    depth: seatConfigs && seatConfigs[idx]
      ? (seatConfigs[idx].depth || heuristicDepth)
      : (p1Config && p2Config ? (idx === 0 ? (p1Config.depth || heuristicDepth) : (p2Config.depth || heuristicDepth)) : heuristicDepth),
    traj: [],
    stepReward: 0,
    heurMetaLog: []
  }));

  const stats = {
    rounds: 0,
    suitCounts: { swords: 0, wands: 0, pentacles: 0, cups: 0 },
    chaosTriggered: {},
    totalChaos: 0,
    digestedAscends: 0,
    undigestedAscends: 0,
    mentalBreaks: 0,
    avgHandSum: 0,
    avgPouchSum: 0,
    avgGraveSum: 0,
    avgDeckSum: 0,
    samples: 0,
    winnerId: null,
    wonBySeq0: false,
    comebackWin: false
  };

  const resolveNet = (p) => {
    if (p.brain === 'nn' || p.brain === 'ref_nn') return nn || smallNet || mediumNet || largeNet;
    if (p.brain === 'nn_small' || p.brain === 'nn_easy') return smallNet || nn;
    if (p.brain === 'nn_medium') return mediumNet || nn;
    if (p.brain === 'nn_large' || p.brain === 'nn_hard' || p.brain === 'nn_ascent') return largeNet || mediumNet || nn;
    if (p.brain === 'nn_tabula') return mediumNet || smallNet || nn;
    return null;
  };
  const isNNBrain = (p) => {
    const b = p.brain;
    return b === 'nn' || b === 'ref_nn' || b === 'nn_small' || b === 'nn_easy' || b === 'nn_medium'
      || b === 'nn_large' || b === 'nn_hard' || b === 'nn_tabula' || b === 'nn_ascent';
  };
  const policyTier = (net) => (net?.tier === 'large' ? 'large' : net?.tier === 'medium' ? 'medium' : 'small');
  const rlOpts = (p) => ({
    training: !!(training && (p.brain === 'nn' || p.brain === 'nn_small' || p.brain === 'nn_medium' || p.brain === 'nn_large' || p.brain === 'nn_easy')),
    exploreRate: training ? 0.12 : 0,
    trajectory: p.traj,
    handLimitMode
  });

  const addStepReward = (p, amount) => {
    if (!p || !training) return;
    p.stepReward = (p.stepReward || 0) + amount;
  };

  const creditRoundAscent = (ascendedIds, couldMap) => {
    if (!training) return;
    const ar = (isBrowserRLNet(nn) ? nn.ascendReward : null) ?? 0.08;
    for (const p of players) {
      if (!isNNBrain(p)) continue;
      if (ascendedIds.has(p.id)) addStepReward(p, ar);
      for (const o of players) {
        if (o.id !== p.id && ascendedIds.has(o.id)) addStepReward(p, -ar);
      }
      // Mild deny when you could ascend but didn't and someone else did
      if (couldMap[p.id] && !ascendedIds.has(p.id) && ascendedIds.size > 0) addStepReward(p, -ar * 0.35);
    }
  };

  const queryBrain = (p, mockState, headIdx, phaseTag = 'trick') => {
    const net = resolveNet(p);
    if (!net) return null;
    if (isBrowserRLNet(net)) {
      const kind =
        headIdx === 5 || phaseTag === 'ascend' ? 'ascend'
          : headIdx === 4 ? 'gamble'
            : headIdx === 3 ? 'chaos'
              : headIdx === 2 ? 'ability'
                : headIdx === 7 ? 'tuck'
                  : headIdx === 6 ? 'draft'
                    : headIdx === 1 ? 'play'
                      : 'play';
      return net.decideYesNo(mockState, p.id, kind, rlOpts(p));
    }
    if (!isPolicyNet(net)) return null;
    const tier = policyTier(net);
    if (headIdx === 5 || phaseTag === 'ascend') {
      const pick = policyPick(net, mockState, p.id, 'ascend', {}, tier);
      return pick?.type === 'ascend';
    }
    const yesKind =
      headIdx === 4 ? PPO_AT.GAMBLE
        : headIdx === 3 ? PPO_AT.PLAY
          : headIdx === 2 ? PPO_AT.PLAY
            : headIdx === 7 ? PPO_AT.TUCK
              : PPO_AT.PLAY;
    const pick = policyPick(net, mockState, p.id, 'meta_yesno', { yesKind }, tier);
    return pick?.type === 'yes';
  };

  const selectCardWithBrain = (p, mockState, candidates, phaseTag = 'trick') => {
    const net = resolveNet(p);
    if (!net || !candidates?.length) return null;
    if (isBrowserRLNet(net)) {
      return net.selectCard(mockState, p.id, candidates, phaseTag, rlOpts(p));
    }
    if (!isPolicyNet(net)) return null;
    const tier = policyTier(net);
    const ctx = phaseTag === 'draft' ? 'draft' : phaseTag === 'pouch' ? 'pouch' : 'trick';
    const pick = policyPick(net, mockState, p.id, ctx, { candidates }, tier);
    if (pick?.card) {
      const match = candidates.find(c => c === pick.card || c?.uid === pick.card?.uid);
      if (match) return match;
    }
    return candidates[0];
  };

  const drawN = (n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      if (deck.length === 0 && grave.length > 0) { deck = shuffle(grave, rng); grave = []; }
      if (deck.length > 0) out.push(deck.shift());
    }
    return out;
  };

  let dealerIdx = initialDealerIdx % actualCount;

  for (let round = 1; round <= maxRounds && stats.winnerId === null; round++) {
    stats.rounds = round;
    const roundMods = {};

    // Track comeback deficit (best seq on table vs each player)
    const bestSeqNow = Math.min(...players.map(p => p.seq));
    for (const p of players) {
      p.abilityUsed = false;
      p.ascendedThisRound = false;
      p.skippedThisRound = false;
      p.pouchLostThisRound = false;
      p.targetedThisRound = false;
      p.lostCardThisRound = false;
      p.mods = {};
      p._trajRoundAt = p.traj?.length || 0; // ascent dense credit window
      const deficit = p.seq - bestSeqNow;
      if (deficit > p.minSeqLeadGap) p.minSeqLeadGap = deficit;
    }

    // 1. Start of turn: NO initial draw! Skipped players draw 2 & skip everything; others optionally tuck 1 to Pouch
    const skippedThisRound = new Set();
    for (const p of players) {
      if (p.skipNextTurn) {
        skippedThisRound.add(p.id);
        p.skippedThisRound = true;
        p.skipNextTurn = false;
        p.hand.push(...drawN(2));
        p.lostTurns++;
        stats.mentalBreaks++;
        addStepReward(p, -0.22);
        continue;
      }
      // Helper: tuck as many cards as desired into Pouch (up to maxPouch=3) before OR after trick!
      const performMultiTuck = (pl, keepMinHand) => {
        const maxP = pl.mods.maxPouch || 3;
        const mockSt = { players, deck, grave, trumpCard: null, trickPlays: [], round };
        // Depth 6 Master / NN Exact Multi-Card Subset Solver: if Hand+Pouch has an exact Ascension subset fitting in Pouch, tuck all needed cards immediately!
        if (pl.depth >= 6 || isNNBrain(pl)) {
          if (!findValidAscensionSubset(pl.pouch, pl.seq, pl.mods)) {
            const handNums = pl.hand.filter(c => c.type === 'minor' && ((c.rank >= 1 && c.rank <= pl.seq) || c.rank === 10));
            const combined = [...pl.pouch, ...handNums];
            // Search subsets of size 1..maxP that sum to pl.seq
            let bestSub = null;
            const limit = Math.min(combined.length, 10);
            for (let mask = 1; mask < (1 << limit); mask++) {
              const sub = [];
              for (let b = 0; b < limit; b++) if (mask & (1 << b)) sub.push(combined[b]);
              if (sub.length > maxP) continue;
              if (checkAscensionMath(sub, pl.seq, pl.mods).valid) {
                const fromHand = sub.filter(c => pl.hand.some(h => h.uid === c.uid));
                if (pl.hand.length - fromHand.length >= keepMinHand || pl.seq === 1) {
                  if (!bestSub || fromHand.length < bestSub.fromHand.length) bestSub = { sub, fromHand };
                }
              }
            }
            if (bestSub) {
              const keepPouchUids = new Set(bestSub.sub.map(c => c.uid));
              while (pl.pouch.length + bestSub.fromHand.length > maxP) {
                const remIdx = pl.pouch.findIndex(c => !keepPouchUids.has(c.uid));
                if (remIdx === -1) break;
                grave.unshift(pl.pouch.splice(remIdx, 1)[0]);
              }
              for (const hc of bestSub.fromHand) {
                if (pl.pouch.length < maxP) {
                  pl.hand = pl.hand.filter(c => c.uid !== hc.uid);
                  pl.pouch.push(hc);
                }
              }
              return;
            }
          }
        }

        // Otherwise allow tucking up to (maxP - pouch.length) cards while keeping >= keepMinHand cards in Hand
        let guard = 0;
        while (pl.hand.length > keepMinHand && guard < 3) {
          guard++;
          const wantTuck = isNNBrain(pl) ? queryBrain(pl, mockSt, 7, 'pouch') : true;
          if (!wantTuck) break;
          const numCards = pl.hand.filter(c => c.type === 'minor' && ((c.rank >= 1 && c.rank <= pl.seq) || c.rank === 10));
          let chosenTuck = numCards.find(c => findValidAscensionSubset([...pl.pouch, c], pl.seq, pl.mods));
          if (!chosenTuck && pl.depth >= 2) {
            chosenTuck = numCards.find(c => c.rank === pl.seq) ||
              numCards.find(c => pl.pouch.some(pc => pc.rank && pc.rank + c.rank === pl.seq)) ||
              numCards.find(c => numCards.some(other => other.uid !== c.uid && other.rank + c.rank === pl.seq));
          }
          if (isNNBrain(pl)) {
            const validTucks = pl.hand.filter(c => c.type === 'minor' && (c.rank <= pl.seq || c.rank === 10 || (pl.pouch.length < 2 && c.rank === 11)));
            if (validTucks.length > 0) chosenTuck = selectCardWithBrain(pl, mockSt, validTucks, 'pouch');
          }
          const allowUnclog = isNNBrain(pl) ? (queryBrain(pl, mockSt, 8, 'pouch') ?? true) : (pl.depth >= 4);
          if (pl.pouch.length >= maxP) {
            if (allowUnclog && !findValidAscensionSubset(pl.pouch, pl.seq, pl.mods) && chosenTuck) {
              const deadIdx = pl.pouch.findIndex(c => !c.rank || c.rank > pl.seq || c.rank >= 11);
              grave.unshift(pl.pouch.splice(deadIdx !== -1 ? deadIdx : 0, 1)[0]);
              pl.hand = pl.hand.filter(c => c.uid !== chosenTuck.uid);
              pl.pouch.push(chosenTuck);
            }
            break;
          }
          if (!chosenTuck) {
            const nonTenNums = pl.depth >= 6 ? numCards.filter(c => c.rank !== 10) : numCards;
            chosenTuck = nonTenNums.sort((a, b) => b.rank - a.rank)[0] ||
              (pl.pouch.length < 2 ? pl.hand.find(c => c.type === 'minor' && c.rank === 11) : null);
          }
          if (!chosenTuck) break;
          pl.hand = pl.hand.filter(c => c.uid !== chosenTuck.uid);
          pl.pouch.push(chosenTuck);
          if (findValidAscensionSubset(pl.pouch, pl.seq, pl.mods)) break;
        }
      };
      // Before-Trick Multi-Tuck (keep at least 1 card for Trick Play)
      performMultiTuck(p, 1);
    }

    // 2. Center Reveal (N+1) & Draft (lowest rank = highest seq picks first)
    const activePlayers = players.filter(p => !skippedThisRound.has(p.id));
    if (activePlayers.length === 0) continue;

    let centerDraft = drawN(activePlayers.length + 1);
    const draftOrder = [...activePlayers].sort((a, b) => {
      if (b.seq !== a.seq) return b.seq - a.seq;
      return ((a.id - dealerIdx + actualCount) % actualCount) - ((b.id - dealerIdx + actualCount) % actualCount);
    });

    for (const p of draftOrder) {
      if (centerDraft.length === 0) break;
      const mockState = { players, deck, grave, trumpCard: centerDraft[0], trickPlays: [], round };
      let pickIdx = 0;
      if (isNNBrain(p)) {
        const hardPick = selectCardWithBrain(p, { ...mockState, centerDraft }, centerDraft, 'draft');
        if (hardPick) {
          pickIdx = Math.max(0, centerDraft.findIndex(c => c.uid === hardPick.uid));
        } else {
        const preferAsc = queryBrain(p, mockState, 6);
        const ascIdx = preferAsc ? centerDraft.findIndex(c => c.type === 'minor' && c.rank <= p.seq && findValidAscensionSubset([...p.pouch, c], p.seq, p.mods)) : -1;
        if (ascIdx !== -1) {
          pickIdx = ascIdx;
        } else {
          const preferMajor = queryBrain(p, mockState, 0);
          const mIdx = centerDraft.findIndex(c => c.type === 'major');
          if (preferMajor && mIdx !== -1) pickIdx = mIdx;
          else {
            let best = 0;
            for (let i = 1; i < centerDraft.length; i++) if ((centerDraft[i].rank || 8) > (centerDraft[best].rank || 8)) best = i;
            pickIdx = best;
          }
        }
        }
      } else {
        // Heuristic Depth 1-5 Drafting Engine
        let bestScore = -999;
        for (let i = 0; i < centerDraft.length; i++) {
          const c = centerDraft[i];
          let sc = c.type === 'major' ? 9 : (c.rank <= 10 ? c.rank : 6);
          if (c.type === 'minor' && (c.rank <= p.seq || c.rank === 10)) {
            if (p.depth >= 2 && findValidAscensionSubset([...p.pouch, c], p.seq, p.mods)) sc += 30;
            if (p.depth >= 3 && (c.rank === p.seq || c.rank === 10)) sc += 24;
            if (p.depth >= 4 && p.pouch.some(pc => pc.rank && pc.rank + c.rank === p.seq)) sc += 22;
            if (p.depth >= 5 && p.seq > 1 && c.rank <= p.seq - 1) sc += 8; // Next-Seq lookahead!
          }
          if (p.depth >= 3 && (c.suit === 'pentacles' || c.suit === 'cups') && p.hand.length <= 3) sc += 10;
          if (p.depth >= 5 && c.suit === 'swords' && players.some(o => o.id !== p.id && o.seq <= p.seq && o.pouch.length >= 2)) sc += 7;
          if (p.depth >= 6 && c.type === 'minor') {
            // Depth 6 Grandmaster: Hoard scarce endgame keys (Aces, 2s, 3s) from Round 1!
            if (c.rank === 10) sc += 32; // Wildcard 10 (any 1..9 in Pouch!)
            else if (c.rank === 1 && !p.hand.some(h => h.rank === 1)) sc += 26;
            else if (c.rank === 2 && p.seq >= 2 && !p.hand.some(h => h.rank === 2)) sc += 18;
            else if (c.rank === 3 && p.seq >= 3 && !p.hand.some(h => h.rank === 3)) sc += 12;
            // Fish Aces/2s/3s off the top of the Grave with Cups!
            if (c.suit === 'cups' && grave[0] && grave[0].type === 'minor' && grave[0].rank <= 3) sc += 22;
          }
          if (sc > bestScore) { bestScore = sc; pickIdx = i; }
        }
      }
      p.hand.push(centerDraft.splice(pickIdx, 1)[0]);
    }

    let trumpCard = centerDraft[0] || null;
    const trickOrder = [...draftOrder].reverse();
    const trickPlays = [];

    // 3. Trick Play + Chaos + Recast-Cost Abilities
    for (const p of trickOrder) {
      const mockState = { players, deck, grave, trumpCard, trickPlays, round, roundMods };
      const oppsList = players.filter(o => o.id !== p.id && !skippedThisRound.has(o.id));
      const netForTgt = resolveNet(p);
      let target = oppsList.length === 0 ? null
        : (isPolicyNet(netForTgt) && oppsList.length > 1)
          ? (() => {
            const pick = policyPick(netForTgt, mockState, p.id, 'target', { opps: oppsList }, policyTier(netForTgt));
            if (pick?.opp) return pick.opp;
            return oppsList[0];
          })()
          : oppsList.sort((a, b) => a.seq - b.seq)[0];

      // Decide Chaos Event
      const majorCard = p.hand.find(c => c.type === 'major');
      if (majorCard) {
        const cidCheck = majorCard.majorId;
        const selfHarmChaos = (cidCheck === 13 && p.pouch.length >= 2) || (cidCheck === 12 && p.hand.length <= 3) || (cidCheck === 18 && !!findValidAscensionSubset(p.pouch, p.seq, p.mods));
        const useChaos = isNNBrain(p)
          ? queryBrain(p, mockState, 3)
          : (p.depth >= 3 ? (!selfHarmChaos && (p.hand.length >= 3 || [9, 17, 19, 21].includes(cidCheck))) : (p.hand.length >= 4 && rng() < 0.35));
        if (false && training && learnFromHeuristic && p.brain === 'heuristic' && p.heurMetaLog.length < 24) {
          /* legacy imitate removed — training is Python PPO */
        }
        if (useChaos) {
          p.hand = p.hand.filter(c => c.uid !== majorCard.uid);
          stats.totalChaos++;
          p.chaosUsed++;
          stats.chaosTriggered[majorCard.majorId] = (stats.chaosTriggered[majorCard.majorId] || 0) + 1;
          trumpCard = applyHeadlessChaos(p, majorCard, target, players, deck, grave, trumpCard, roundMods, drawN, rng);
        }
      }

      // Decide Sequence Ability (FREE while Undigested; Sanity Toll = 1 Hand discard once Digested!)
      const recastCost = p.actingDone ? 1 : 0;
      if (!p.abilityUsed && p.hand.length >= (recastCost > 0 ? 3 : 1)) {
        const curTag = PATHWAYS[p.pathwayId]?.seqs[p.seq]?.tag || '';
        const highValRecastTags = new Set([
          'draw_2', 'omniscient_eye', 'author_coincidence', 'life_giver', 'white_angel', 'reboot_trick',
          'steal_trump_hand', 'steal_pouch_safe', 'crimson_moon', 'reaper_strike', 'devil_desire',
          'filthy_monarch', 'hijack_trump', 'steal_time', 'undying_revive', 'pale_emperor',
          'soul_harvest', 'grave_best_to_hand', 'witch_burn', 'tsunami_aoe', 'plague_aoe', 'catastrophe_aoe',
          'student_deduce', 'mysticism_cycle', 'telepathist_reveal', 'copy_ability', 'grafting', 'prisoner_restraint'
        ]);
        const wantCast = isNNBrain(p)
          ? (recastCost === 0 ? true : queryBrain(p, mockState, 2, 'trick'))
          : (recastCost === 0 ? true : (p.depth >= 2 && (
              (highValRecastTags.has(curTag) && p.hand.length >= 3) ||
              (!p.actingDone && p.hand.length >= 5)
            )));
        if (wantCast) {
          if (recastCost > 0 && p.hand.length > 0) discardSmart(p, grave, 1);
          p.abilityUsed = true;
          p.abilityCastsThisSeq++;
          p.abilitiesUsed++;
          // Execute REAL Sequence Ability (all 198 abilities with Knight/Queen/Page-Trap checks!)
          const trumpRef = { card: trumpCard };
          applyHeadlessAbility(p, players, target, deck, grave, trumpRef, roundMods, drawN, null, 0, rng);
          trumpCard = trumpRef.card;
        }
      }

      // Play ANY card into Trick (no forced follow-suit; Minor OR Major Arcana allowed!)
      if (p.hand.length === 0) continue;
      const leadSuit = trickPlays[0]?.effSuit;
      const legal = [...p.hand];

      let chosen;
      if (isNNBrain(p)) {
        const hardCard = selectCardWithBrain(p, mockState, legal, 'trick');
        if (hardCard) {
          chosen = hardCard;
        } else {
          const aggro = queryBrain(p, mockState, 1);
          legal.sort((a, b) => (b.rank <= 10 ? b.rank : 6) - (a.rank <= 10 ? a.rank : 6));
          chosen = aggro ? legal[0] : legal[legal.length - 1];
        }
      } else {
        // Depth 3-6: Trump/Lead-aware Trick Play + Ascension Key Preservation
        const tSuit = (!roundMods.abolishTrump && !roundMods.noTrumpChariot && trumpCard) ? getCardSuit(trumpCard) : null;
        const curWinPlay = trickPlays.length > 0 ? evaluateTrickWinner(trickPlays, trumpCard, roundMods) : null;
        const scorePlayCard = (c) => {
          if (c.type === 'major') return (tSuit === 'major' ? 14 : 4) + (c.majorId || 0) * 0.1;
          let sc = c.rank <= 10 ? c.rank : (c.rank === 14 ? 8 : 5);
          if (roundMods.invertTrick && c.rank <= 9) sc = 11 - sc;
          if (p.depth >= 3 && tSuit && getCardSuit(c) === tSuit && c.rank <= 10) sc += 6;
          if (p.depth >= 4 && curWinPlay) {
            const simPlay = { playerId: p.id, card: c, effValue: c.rank <= 10 ? c.rank : 0, effSuit: c.suit, isTenOverride: c.rank === 10, countsAsTrump: !!p.mods.countsAsTrump || (!!p.mods.cupsAreTrump && c.suit === 'cups'), faceCanWin: !!p.mods.faceCanWin, winsTies: !!p.mods.winsTies };
            const wouldWin = evaluateTrickWinner([...trickPlays, simPlay], trumpCard, roundMods)?.playerId === p.id;
            if (wouldWin) sc += 9;
            else if (c.rank <= 9) sc -= c.rank * 0.7; // Dump low card if we can't win!
          }
          if (p.depth >= 3 && c.suit === 'pentacles' && p.hand.length <= 3) sc += 9;
          if (p.depth >= 3 && c.suit === 'cups' && grave.length > 0 && p.hand.length <= 3) sc += 8;
          if (p.depth >= 4 && (c.rank <= p.seq || c.rank === 10) && findValidAscensionSubset([...p.pouch, c], p.seq, p.mods)) sc -= 25; // Preserve Ascension key!
          if (p.depth >= 5 && (c.rank === p.seq || c.rank === 10)) sc -= 18;
          if (p.depth >= 5 && (c.rank === 12 || c.rank === 13) && p.hand.length >= 3) sc -= 6; // Save Knights/Queens for interrupts
          if (p.depth >= 6) {
            if (c.rank === 10 && p.seq <= 4) sc -= 34; // Save Wildcard 10 for endgame Ascension!
            else if (c.rank === 1 && p.seq >= 1) sc -= 38; // Sacred Ace hoard for Seq 1 -> 0!
            else if (c.rank === 2 && p.seq >= 2) sc -= 24;
            else if (c.rank === 3 && p.seq >= 3) sc -= 14;
            if (c.suit === 'cups' && grave[0] && grave[0].type === 'minor' && grave[0].rank <= Math.min(3, p.seq)) sc += 32; // Fish endgame key from Grave!
            if (c.suit === 'pentacles' && p.seq <= 3 && !p.hand.some(h => h.rank <= p.seq)) sc += 16; // Dig Deck for Aces/2s/3s!
          }
          return sc;
        };
        legal.sort((a, b) => scorePlayCard(b) - scorePlayCard(a));
        chosen = legal[0];
      }

      p.hand = p.hand.filter(c => c.uid !== chosen.uid);
      if (chosen.type === 'major') {
        stats.totalChaos++;
        p.chaosUsed++;
        stats.chaosTriggered[chosen.majorId] = (stats.chaosTriggered[chosen.majorId] || 0) + 1;
        if (p.pathwayId === 2 && (p.seq === 4 || p.seq === 1)) p.actingDone = true;
        if (p.pathwayId === 12 && p.seq === 1) p.actingDone = true;
        const recCntM = p.mods.skipRecycle ? 0 : chosen.majorId;
        const recM = grave.splice(0, Math.min(recCntM, grave.length));
        deck.push(chosen, ...recM);
        trickPlays.push({
          playerId: p.id,
          card: chosen,
          effValue: chosen.majorId,
          effSuit: 'major',
          isTenOverride: false,
          countsAsTrump: trumpCard?.type === 'major',
          faceCanWin: false,
          winsTies: !!p.mods.winsTies,
          absorbed: true
        });
        continue;
      }
      stats.suitCounts[chosen.suit]++;
      p.suitCounts[chosen.suit]++;
      if (chosen.rank === 14) p.faceCounts.K++;
      else if (chosen.rank === 13) p.faceCounts.Q++;
      else if (chosen.rank === 12) p.faceCounts.N++;
      else if (chosen.rank === 11) p.faceCounts.P++;
      let effVal = chosen.rank <= 10 ? chosen.rank : (p.mods.faceCanWin ? 11 : 0);
      if (p.mods.trickBonus && chosen.rank <= 9) effVal = Math.min(9, effVal + p.mods.trickBonus);
      if (p.mods.wandCupBonus && (chosen.suit === 'wands' || chosen.suit === 'cups') && chosen.rank <= 9) effVal = Math.min(9, effVal + p.mods.wandCupBonus);
      if (p.mods.sunBoost && (chosen.suit === 'cups' || chosen.suit === 'pentacles') && chosen.rank <= 9) effVal = Math.min(9, effVal + p.mods.sunBoost);
      const isLeadingPlay = trickPlays.length === 0;
      const isTrumpCardPlay = !!(trumpCard && getCardSuit(chosen) === getCardSuit(trumpCard) && !roundMods.abolishTrump && !roundMods.noTrumpChariot);
      if (p.mods.nonTrumpPenalty && !isTrumpCardPlay && effVal > 1) effVal = Math.max(1, effVal - p.mods.nonTrumpPenalty);
      if (p.mods.jackpotBoost && trumpCard && (getCardSuit(chosen) === getCardSuit(trumpCard) || (chosen.rank && chosen.rank === trumpCard.rank))) { effVal = Math.min(10, effVal + 4); p.actingDone = true; }
      if (p.mods.trickPenalty && effVal > 1) effVal = Math.max(1, effVal - p.mods.trickPenalty);
      if (p.mods.sailorLeadDraw && isLeadingPlay) { p.hand.push(...drawN(1)); p.actingDone = true; }
      if (p.mods.arbiterTrumpDraw && isTrumpCardPlay) { p.hand.push(...drawN(1)); p.actingDone = true; }
      if (p.pathwayId === 20 && p.seq === 9 && (isTrumpCardPlay || (leadSuit && chosen.suit === leadSuit))) p.actingDone = true;
      if (roundMods.forbidSuit && roundMods.forbidOwner !== p.id && chosen.suit === roundMods.forbidSuit && !p.mods.handImmune && !roundMods.globalImmunity && p.hand.length > 0) {
        players[roundMods.forbidOwner]?.hand.push(p.hand.pop());
      }
      trickPlays.push({
        playerId: p.id,
        card: chosen,
        effValue: effVal,
        effSuit: chosen.suit,
        isTenOverride: chosen.rank === 10 || !!p.mods.degenerateTen,
        countsAsTrump: !!p.mods.countsAsTrump || (!!p.mods.cupsAreTrump && chosen.suit === 'cups'),
        faceCanWin: !!p.mods.faceCanWin,
        winsTies: !!p.mods.winsTies
      });

      // Suit Actions (100% parity with live game — respects all defensive, trap, Dawn Paladin & doubleSuit mods!)
      let chosenAbsorbedByPaladin = false;
      if (!roundMods.globalImmunity && !roundMods.cancelSuitActions && !p.mods.silenced) {
        const times = p.mods.doubleSuit ? 2 : 1;
        if (p.mods.doubleSuit) p.actingDone = true;
        if (chosen.rank === 14 && target) {
          const mIdx = target.hand.findIndex(c => c.suit === chosen.suit);
          if (mIdx !== -1) p.hand.push(target.hand.splice(mIdx, 1)[0]);
          if (p.pathwayId === 16 && p.seq === 2) p.actingDone = true;
        }
        if ((chosen.suit === 'swords' || roundMods.weatherSwords || chosen.suit === 'wands') && target && target.mods.redirectNext) {
          target.mods.redirectNext = false;
          target.hand.push(...drawN(1));
          target.actingDone = true;
          const alt = players.find(o => o.id !== p.id && o.id !== target.id && !skippedThisRound.has(o.id)) || p;
          target = alt;
        }
        if ((chosen.suit === 'swords' || roundMods.weatherSwords) && target) {
          target.targetedThisRound = true;
          const canBlock = !p.mods.unblockable && !roundMods.spatialLock && !roundMods.apocalypse;
          const knIdx = canBlock ? target.hand.findIndex(c => c.rank === 12) : -1;
          if (knIdx !== -1) {
            const knCard = target.hand.splice(knIdx, 1)[0];
            target.faceCounts.N++;
            // Activate Instant Knight Suit Action!
            if (knCard.suit === 'pentacles') target.hand.push(...drawN(1));
            else if (knCard.suit === 'cups' && grave.length > 0) target.hand.push(grave.shift());
            else if (knCard.suit === 'swords' && p.pouch.length > 0 && !p.mods.pouchImmune) grave.unshift(p.pouch.pop());
            else if (knCard.suit === 'wands' && p.hand.length > 0 && !p.mods.handImmune) discardSmart(p, grave, 1);
            grave.unshift(knCard);
            if (target.pathwayId === 8 && (target.seq === 8 || target.seq === 7)) target.actingDone = true;
          } else if (target.mods.dawnPaladin) {
            // Dawn Paladin: attacking Sword enters target's Pouch (or Hand if full)!
            chosenAbsorbedByPaladin = true;
            if (target.pouch.length < (target.mods.maxPouch || 3)) target.pouch.push(chosen);
            else target.hand.push(chosen);
            target.actingDone = true;
          } else if (
            target.mods.clownFigurine &&
            target.pouch.length > 0 &&
            target.hand.length > 0 &&
            (target.pouch.some(c => c.rank === target.seq || c.rank === 10) || target.pouch.length <= 2 || rng() < 0.55)
          ) {
            // Optional Paper Figurine (like Knight) — Hand↔Bag swap blocks the Sword
            target.mods.clownFigurine = false;
            const pIdx = Math.floor(rng() * target.pouch.length);
            const hIdx = Math.floor(rng() * target.hand.length);
            const tmp = target.pouch[pIdx];
            target.pouch[pIdx] = target.hand[hIdx];
            target.hand[hIdx] = tmp;
            if (target.pathwayId === 0 && target.seq === 8) target.actingDone = true;
          } else if (target.mods.pouchImmune) {
            if (target.mods.counterPunch) { discardSmart(p, grave, 1); target.actingDone = true; }
            if (target.pathwayId === 12 && target.seq === 7) target.actingDone = true;
          } else if (target.pouch.length > 0) {
            const hits = (roundMods.apocalypse ? 2 : 1) * times;
            let destroyed = 0;
            for (let h = 0; h < hits && target.pouch.length > 0; h++) {
              const pIdx = Math.floor(rng() * target.pouch.length);
              const hit = target.pouch.splice(pIdx, 1)[0];
              grave.unshift(hit);
              if (hit.rank === 11 || target.mods.despairTraps) {
                target.faceCounts.P++;
                if (p.pouch.length > 0) target.hand.push(p.pouch.pop());
                else if (p.hand.length > 0) target.hand.push(p.hand.pop());
                if ((target.pathwayId === 3 || target.pathwayId === 0) && target.seq === 4) target.actingDone = true;
              } else {
                target.pouchLostThisRound = true;
                destroyed++;
              }
            }
            if (destroyed > 0) {
              if (p.mods.assassinSwordDraw) p.hand.push(...drawN(1));
              if ((p.pathwayId === 7 && p.seq === 9) || (p.pathwayId === 3 && (p.seq === 9 || p.seq === 7 || p.seq === 1)) || (p.pathwayId === 5 && p.seq === 4) || (p.pathwayId === 8 && p.seq === 7) || (p.pathwayId === 4 && p.seq === 8)) p.actingDone = true;
            }
          }
        } else if (chosen.suit === 'wands' && target) {
          target.targetedThisRound = true;
          const canBlock = !p.mods.unblockable && !roundMods.spatialLock && !roundMods.apocalypse;
          const qnIdx = canBlock ? target.hand.findIndex(c => c.rank === 13) : -1;
          if (qnIdx !== -1) {
            const qnCard = target.hand.splice(qnIdx, 1)[0];
            target.faceCounts.Q++;
            // Activate Instant Queen Suit Action!
            if (qnCard.suit === 'pentacles') target.hand.push(...drawN(1));
            else if (qnCard.suit === 'cups' && grave.length > 0) target.hand.push(grave.shift());
            else if (qnCard.suit === 'swords' && p.pouch.length > 0 && !p.mods.pouchImmune) grave.unshift(p.pouch.pop());
            else if (qnCard.suit === 'wands' && p.hand.length > 0 && !p.mods.handImmune) discardSmart(p, grave, 1);
            grave.unshift(qnCard);
          } else if (target.mods.handImmune) {
            if (target.mods.counterPunch) { discardSmart(p, grave, 1); target.actingDone = true; }
            if (target.pathwayId === 3 && target.seq === 8) target.hand.push(...drawN(1));
            if (target.pathwayId === 12 && target.seq === 7) target.actingDone = true;
          } else {
            for (let h = 0; h < times; h++) {
              if (target.mods.sunFloor && target.hand.length <= 3) break;
              if (target.hand.length > 0) { discardSmart(target, grave, 1); target.lostCardThisRound = true; }
              else { target.skipNextTurn = true; if (p.pathwayId === 7 && p.seq === 1) p.actingDone = true; break; }
            }
            if ((p.pathwayId === 15 && p.seq === 9) || (p.pathwayId === 3 && (p.seq === 8 || p.seq === 5)) || (p.pathwayId === 4 && p.seq === 8)) p.actingDone = true;
          }
        } else if (chosen.suit === 'pentacles') {
          p.hand.push(...drawN(times));
          if ((p.pathwayId === 16 && p.seq === 9) || (p.pathwayId === 21 && p.seq === 5) || (p.pathwayId === 19 && (p.seq === 8 || p.seq === 7))) p.actingDone = true;
        } else if (chosen.suit === 'cups') {
          for (let h = 0; h < times && grave.length > 0; h++) p.hand.push(grave.shift());
          if ((p.pathwayId === 18 && p.seq === 8) || (p.pathwayId === 21 && p.seq === 8) || (p.pathwayId === 13 && p.seq === 9)) p.actingDone = true;
        }
      }
      if (chosenAbsorbedByPaladin) trickPlays[trickPlays.length - 1].absorbed = true;

      // Play-based Acting checks (100% parity with live game)
      if (p.pathwayId === 4 && p.seq === 9 && chosen.rank <= 6) p.actingDone = true;
      if (p.pathwayId === 8 && p.seq === 9 && (chosen.suit === 'swords' || chosen.rank === 12)) p.actingDone = true;
      if (p.pathwayId === 8 && p.seq === 8 && chosen.rank <= 10 && chosen.rank >= 5) p.actingDone = true;
      if (p.pathwayId === 8 && p.seq === 3 && isFaceCard(chosen)) p.actingDone = true;
      if (p.pathwayId === 16 && p.seq === 5 && (chosen.rank === 1 || chosen.rank === 10)) p.actingDone = true;
      if (p.pathwayId === 17 && p.seq === 9 && trickPlays.length === activePlayers.length) p.actingDone = true;
    }

    // 4. Trick Winner & Reward
    if (trickPlays.length > 0) {
      const winPlay = evaluateTrickWinner(trickPlays, trumpCard, roundMods);
      const winner = players[winPlay.playerId];
      winner.tricksWon++;
      addStepReward(winner, 0.05);
      if (roundMods.warDeclared) { for (const pl of players) if (pl.id !== winner.id && !skippedThisRound.has(pl.id) && pl.hand.length > 0) discardSmart(pl, grave, 1); }
      if (winner.mods.eternalNight) winner.hand.push(...drawN(2));
      if (winner.mods.folkWinDraw) winner.hand.push(...drawN(1));

      // Strength S9 Warrior: if you lose a trick, take the winning card into your Hand!
      let winCardTaken = false;
      for (const pl of players) {
        if (pl.id !== winner.id && pl.mods.warriorTakeWinner && !winPlay.absorbed && !winCardTaken) {
          pl.hand.push(winPlay.card);
          winPlay.absorbed = true;
          winCardTaken = true;
        }
      }
      // Emperor S6 Baron of Corruption: after trick, take 1 played trick card into your Pouch!
      for (const pl of players) {
        if (pl.mods.baronPouch && pl.pouch.length < (pl.mods.maxPouch || 3)) {
          const avail = trickPlays.filter(tp => !tp.absorbed);
          const pickTp = avail.find(tp => tp.card.type === 'minor' && (tp.card.rank === 10 || tp.card.rank <= pl.seq)) || avail[0];
          if (pickTp) {
            pl.pouch.push(pickTp.card);
            pickTp.absorbed = true;
          }
        }
      }

      // Win-based Acting checks (100% parity with live game)
      if (winner.pathwayId === 0 && (winner.seq === 7 || winner.seq === 3 || winner.seq === 2 || winner.seq === 1)) winner.actingDone = true;
      if (winner.pathwayId === 1 && (winner.seq === 4 || winner.seq === 3 || winner.seq === 1)) winner.actingDone = true;
      if (winner.pathwayId === 2 && winner.seq === 8 && (winPlay.card.suit === 'wands' || winPlay.card.suit === 'cups')) winner.actingDone = true;
      if (winner.pathwayId === 2 && winner.seq === 3) winner.actingDone = true;
      if (winner.pathwayId === 3 && (winner.seq === 9 || winner.seq === 1)) winner.actingDone = true;
      if (winner.pathwayId === 6 && winner.seq === 3) winner.actingDone = true;
      if (winner.pathwayId === 11 && winner.seq === 3) winner.actingDone = true;
      if (winner.pathwayId === 12 && winner.seq === 2 && winner.mods.degenerateTen) winner.actingDone = true;
      if (winner.pathwayId === 17 && winner.seq === 6) winner.actingDone = true;
      if (winner.pathwayId === 4 && winner.seq === 6 && winPlay.card.rank <= 4) winner.actingDone = true;
      if (winner.pathwayId === 4 && (winner.seq === 3 || winner.seq === 1)) winner.actingDone = true;
      if (winner.pathwayId === 5 && (winner.seq === 9 || winner.seq === 8 || winner.seq === 6 || winner.seq === 2 || winner.seq === 1)) winner.actingDone = true;
      if (winner.pathwayId === 7 && (winner.seq === 5 || winner.seq === 4 || winner.seq === 3 || winner.seq === 2)) winner.actingDone = true;
      if (winner.pathwayId === 8 && (winner.seq === 2 || winner.seq === 1)) winner.actingDone = true;
      if (winner.pathwayId === 9 && (winner.seq === 4 || (winner.seq === 1 && winner.mods.addedDeckToPouch))) winner.actingDone = true;
      if (winner.pathwayId === 10 && (winner.seq === 7 || winner.seq === 1)) winner.actingDone = true;
      if (winner.pathwayId === 13 && winner.seq === 2) winner.actingDone = true;
      if (winner.pathwayId === 14 && (winner.seq === 7 || winner.seq === 3 || winner.seq === 2)) winner.actingDone = true;
      if (winner.pathwayId === 16 && (winner.seq === 4 || winner.seq === 1)) winner.actingDone = true;
      if (winner.pathwayId === 17 && (winner.seq === 4 || winner.seq === 2 || winner.seq === 1)) winner.actingDone = true;
      if (winner.pathwayId === 18 && winner.seq === 5 && winPlay.card.suit === 'cups') winner.actingDone = true;
      if (winner.pathwayId === 19 && (winner.seq === 2 || winner.seq === 1)) winner.actingDone = true;
      if (winner.pathwayId === 20 && (winner.seq === 4 || winner.seq === 3 || winner.seq === 1)) winner.actingDone = true;
      if (winner.pathwayId === 21 && (winner.seq === 6 || winner.seq === 1)) winner.actingDone = true;

      const mockState = { players, deck, grave, trumpCard, trickPlays, round };
      const trumpIsKey = trumpCard && trumpCard.type === 'minor' && (trumpCard.rank === 10 || trumpCard.rank === 1 || trumpCard.rank === winner.seq || !!findValidAscensionSubset([...winner.pouch, trumpCard], winner.seq, winner.mods));
      const gamble = isNNBrain(winner)
        ? queryBrain(winner, mockState, 4)
        : (winner.mods.luckyTwoSuits ? true : (!trumpIsKey && winner.depth >= 3 ? false : rng() < 0.25));

      if (gamble && deck.length > 0) {
        const g1 = SUITS[Math.floor(rng() * 4)];
        const guesses = winner.mods.luckyTwoSuits ? [g1, SUITS[(SUITS.indexOf(g1) + 1) % 4]] : [g1];
        const rev = [];
        let minor = null;
        while (deck.length > 0 && !minor) {
          const t = deck.shift();
          rev.push(t);
          if (t.type === 'minor') minor = t;
        }
        if (minor && guesses.includes(minor.suit)) {
          winner.hand.push(...rev);
          if (trumpCard) winner.hand.push(trumpCard);
          winner.actingDone = true;
        } else {
          grave.unshift(...rev);
          if (trumpCard) grave.unshift(trumpCard);
        }
      } else if (trumpCard) {
        winner.hand.push(trumpCard);
      }
      for (const tp of trickPlays) if (!tp.absorbed) grave.unshift(tp.card);
    }

    // End-of-round Acting checks (100% parity with live game)
    const maxHandLen = Math.max(...players.map(pl => pl.hand.length));
    for (const p of players) {
      if (!p.pouchLostThisRound && !p.lostCardThisRound) p.safeRoundsCount = (p.safeRoundsCount || 0) + 1;
      if (p.pathwayId === 0 && p.seq === 8 && !p.pouchLostThisRound) p.actingDone = true;
      if (p.pathwayId === 1 && p.seq === 5 && !p.pouchLostThisRound && !p.lostCardThisRound) p.actingDone = true;
      if (p.pathwayId === 3 && p.seq === 4 && p.pouch.length >= 2) p.actingDone = true;
      if (p.pathwayId === 8 && p.seq === 6 && !p.pouchLostThisRound) p.actingDone = true;
      if (p.pathwayId === 8 && p.seq === 5 && p.safeRoundsCount >= 2) p.actingDone = true;
      if (p.pathwayId === 10 && (p.seq === 9 || p.seq === 8)) {
        const cnts = {};
        for (const c of p.hand) if (c.rank) cnts[c.rank] = (cnts[c.rank] || 0) + 1;
        if (Object.values(cnts).some(v => v >= 2)) p.actingDone = true;
      }
      if (p.pathwayId === 20 && p.seq === 2 && p.hand.length >= maxHandLen) p.actingDone = true;
      if (p.pathwayId === 11 && p.seq === 9 && !p.targetedThisRound) p.actingDone = true;
      if (p.pathwayId === 12 && p.seq === 7 && !p.pouchLostThisRound && !p.lostCardThisRound) p.actingDone = true;
      if (p.pathwayId === 11 && p.seq === 1 && (p.hand.length >= 5 || p.pouch.length >= 3)) p.actingDone = true;
      if (p.pathwayId === 14 && p.seq === 9 && p.pouch.length <= 1) p.actingDone = true;
      if (p.pathwayId === 14 && p.seq === 6 && !p.pouchLostThisRound) p.actingDone = true;
      if (p.pathwayId === 17 && p.seq === 5 && !p.pouchLostThisRound) p.actingDone = true;
      if (p.pathwayId === 18 && p.seq === 2 && p.hand.length >= 6) p.actingDone = true;
      if (p.pathwayId === 19 && p.seq === 5 && p.hand.length >= 4) p.actingDone = true;
      if (p.pathwayId === 21 && p.seq === 9 && !p.pouchLostThisRound && p.pouch.length > 0) p.actingDone = true;
    }

    // 5. Phase 3 — Ascend Only (once per turn; strict 3-phase: Pouch -> Trick -> Ascend)
    // Snapshot who *can* ascend before choices — used for dense per-round ascent/deny credit.
    const couldAscend = {};
    for (const p of players) {
      if (skippedThisRound.has(p.id) || p.mods.ascendLocked) {
        couldAscend[p.id] = false;
        continue;
      }
      const pool = p.mods.handAscend ? [...p.pouch, ...p.hand] : p.pouch;
      couldAscend[p.id] = !!findValidAscensionSubset(pool, p.seq, p.mods);
    }

    for (const p of players) {
      if (skippedThisRound.has(p.id) || p.mods.ascendLocked || p.ascendedThisRound) continue;
      const ascPool = p.mods.handAscend ? [...p.pouch, ...p.hand] : p.pouch;
      const subset = findValidAscensionSubset(ascPool, p.seq, p.mods);
      if (subset) {
        const mockState = { players, deck, grave, trumpCard: null, trickPlays: [], round };
        const doReckless = (p.actingDone || p.seq === 1) ? true : (
          isNNBrain(p)
            ? queryBrain(p, mockState, 5, 'ascend')
            : (p.seq === 1 || p.hand.length >= (p.depth >= 4 ? 2 : 4) || (p.depth >= 3 && p.seq <= 3))
        );
        if (doReckless) {
          // Emperor S9 Lawyer: if ascending using ±1 leeway, keep 1 used ingredient card in Pouch!
          const exactCheck = checkAscensionMath(subset, p.seq, { ...p.mods, mathLeeway: 0 });
          const usedLeeway = !exactCheck.valid && !!p.mods.lawyerKeepOne;
          const keepCard = usedLeeway && subset.length > 0 ? subset[0] : null;
          const spentCards = keepCard ? subset.filter(c => c.uid !== keepCard.uid) : subset;
          const setU = new Set(spentCards.map(c => c.uid));
          p.pouch = p.pouch.filter(c => !setU.has(c.uid));
          if (p.mods.handAscend) p.hand = p.hand.filter(c => !setU.has(c.uid));
          grave.unshift(...spentCards);
          const wasDigested = p.actingDone;
          p.seq--;
          p.actingDone = false;
          p.safeRoundsCount = 0;
          p.ascendedThisRound = true;
          p._ascendDigested = wasDigested;
          p.abilityCastsThisSeq = 0;
          if (p.seq === 0) {
            stats.winnerId = p.id;
            stats.wonBySeq0 = true;
            stats.comebackWin = p.minSeqLeadGap >= 2;
            break;
          }
          if (wasDigested) {
            p.hand.push(...drawN(1));
            stats.digestedAscends++;
          } else {
            discardSmart(p, grave, 3);
            stats.undigestedAscends++;
          }
        }
      }

      // Enforce Shrinking Hand Limit at End of Round (Depth 6 & NN keep Aces/2s/3s & Seq keys instead of blindly popping them!)
      const cap = getHandLimit(p.seq, handLimitMode);
      if (p.hand.length > cap) {
        if (p.depth >= 6 || isNNBrain(p)) {
          p.hand.sort((a, b) => {
            const keepScore = (c) => {
              if (c.type === 'major') return 7;
              if (c.rank === 10) return 22;
              if (c.rank === 1) return 20;
              if (c.rank === 2 && p.seq >= 2) return 16;
              if (c.rank === 3 && p.seq >= 3) return 12;
              if (c.rank === p.seq) return 18;
              if (c.rank === 12 || c.rank === 13) return 9;
              return c.rank <= p.seq ? 6 : 2;
            };
            return keepScore(b) - keepScore(a); // Highest-priority cards kept at front; lowest-value trimmed from back!
          });
        }
        while (p.hand.length > cap) grave.unshift(p.hand.pop());
      }

      // Ending round with 0 cards -> lose next turn (draw 2 on recovery)
      if (p.hand.length === 0) p.skipNextTurn = true;
    }

    // Dense ascend / deny credit for browser RL (once per round)
    {
      const ascendedIds = new Set(players.filter(pl => pl.ascendedThisRound).map(pl => pl.id));
      creditRoundAscent(ascendedIds, couldAscend);
    }

    // Sample board stats
    for (const pl of players) { pl.handSum += pl.hand.length; pl.handSamples++; }
    stats.avgHandSum += players.reduce((a, p) => a + p.hand.length, 0) / players.length;
    stats.avgPouchSum += players.reduce((a, p) => a + p.pouch.length, 0) / players.length;
    stats.avgGraveSum += grave.length;
    stats.avgDeckSum += deck.length;
    stats.samples++;
    dealerIdx = (dealerIdx + 1) % actualCount;
  }

  // If maxRounds reached with no Sequence 0 -> draw
  stats.isDraw = (stats.winnerId === null);

  let challengerBeatRef = false;
  if (nn && training) {
    const learner = players.find(p =>
      p.brain === 'nn' || p.brain === 'nn_small' || p.brain === 'nn_medium' || p.brain === 'nn_large' || p.brain === 'nn_easy'
    ) || players[0];
    const won = !stats.isDraw && stats.winnerId === learner.id;
    if (won) challengerBeatRef = true;
    const terminal = stats.isDraw ? -0.2 : (won ? 1.0 : -1.0);
    const dense = learner.stepReward || 0;
    const totalReward = terminal + dense;
    if (learner.traj?.length) {
      if (isBrowserRLNet(nn) && typeof nn.trainEpisode === 'function') {
        nn.trainEpisode(learner.traj, totalReward);
      } else if (isPolicyNet(nn) && typeof nn.trainTrajectoryPPO === 'function') {
        nn.trainTrajectoryPPO(learner.traj, totalReward);
      }
    }
  }

  return {
    ...stats,
    winnerPathwayId: stats.winnerId !== null ? players[stats.winnerId].pathwayId : null,
    winnerBrain: stats.winnerId !== null ? players[stats.winnerId].brain : 'draw',
    challengerBeatRef,
    finalSeqs: players.map(p => ({
      id: p.id,
      pathwayId: p.pathwayId,
      seq: p.seq,
      lostTurns: p.lostTurns,
      tricksWon: p.tricksWon,
      abilitiesUsed: p.abilitiesUsed,
      chaosUsed: p.chaosUsed,
      avgHand: p.handSamples > 0 ? p.handSum / p.handSamples : p.hand.length,
      faceCounts: p.faceCounts,
      suitCounts: p.suitCounts,
      comeback: p.id === stats.winnerId && stats.comebackWin
    }))
  };
}

export {
  pickDiscardCardIdx,
  discardSmart,
  applyHeadlessAbility,
  applyHeadlessChaos,
  runHeadlessGame
};
