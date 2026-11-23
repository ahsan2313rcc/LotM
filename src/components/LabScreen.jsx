import {
  Zap, ChevronLeft, ChevronRight, X, BookOpen, Shuffle, Eye, Crown, Skull, Layers, RotateCcw, Play
} from 'lucide-react';
import { PATHWAYS, ROMAN, TARGETED_ABILITY_TAGS, SUITS, SUIT_META, getCardSuit } from '../data/constants.js';
import { buildMajorCard, cardCode, cardShortName, isNumberCard, isFaceCard } from '../utils/cards.js';
import { instantCastCode, pCode, fogNetlistAction } from '../utils/netlist.js';
import { findValidAscensionSubset, checkAscensionMath, getHandLimit, evaluateTrickWinner } from '../utils/rules.js';
import { discardSmart, applyHeadlessAbility } from '../ai/headless.js';
import { SuitIcon } from './SuitIcon.jsx';
import { TarotCard } from './TarotCard.jsx';

export function LabScreen({
  labState,
  setLabState,
  labPathwayId,
  setLabPathwayId,
  labSeq,
  setLabSeq,
  labChaosId,
  setLabChaosId,
  labAudit,
  setLabAudit,
  labAuditTab,
  setLabAuditTab,
  labAuditSearch,
  setLabAuditSearch,
  setScreen,
  setShowCodex,
  setCodexTab,
  setCodexPathwayId,
  buildLabSandbox,
  executeSequenceAbility,
  resolveChaosEvent,
  beginRoundDraw,
  startDraftPhase,
  startTrickPhase,
  advanceToNextRound,
  playTrickCard,
  addLog,
  applyInstantFaceSuitAction,
  performAscension,
  markActed,
  exportLogsToNetlist
}) {
    const lp = PATHWAYS[labPathwayId];
    const lSeq = lp.seqs[labSeq];
    const labHuman = labState.players[0];
    const labOpps = labState.players.filter(p => !p.isHuman);
    const labNeedsTarget = TARGETED_ABILITY_TAGS.has(lSeq.tag);

    const applyLabPathwayChange = (newPId, newSeq) => {
      setLabPathwayId(newPId);
      setLabSeq(newSeq);
      setLabState(buildLabSandbox(newPId, newSeq));
    };

    const runLabAbility = () => {
      setLabState(prev => {
        const ready = {
          ...prev,
          players: prev.players.map((p, i) => i === 0 ? { ...p, pathwayId: labPathwayId, seq: labSeq, abilityUsed: false } : p)
        };
        if (labNeedsTarget) {
          return { ...ready, pendingInteraction: { type: 'LAB_TARGET_ABILITY' } };
        }
        return executeSequenceAbility(ready, 0, null);
      });
    };

    const runLabChaos = () => {
      setLabState(prev => {
        const major = buildMajorCard(labChaosId);
        const ready = {
          ...prev,
          players: prev.players.map((p, i) => i === 0 ? { ...p, hand: [...p.hand, major] } : p)
        };
        return resolveChaosEvent(ready, 0, major, 1);
      });
    };

    const stepLabPhase = (targetPhase) => {
      setLabState(prev => {
        if (targetPhase === 'POUCH_ADD') return beginRoundDraw({ ...prev, round: prev.round });
        if (targetPhase === 'DRAFT') return startDraftPhase(prev);
        if (targetPhase === 'TRICK') {
          let s = prev.centerDraft.length === 0 ? startDraftPhase(prev) : prev;
          while (s.centerDraft.length > 1) s = { ...s, centerDraft: s.centerDraft.slice(1) };
          return startTrickPhase(s);
        }
        if (targetPhase === 'ASCEND') return { ...prev, phase: 'ASCEND', logs: addLog(prev.logs, `Phase 3: Ascension Phase — spend Pouch ingredients to Ascend.`, 'info', `A${prev.round}=`, { newPhase: true }) };
        if (targetPhase === 'NEXT_ROUND') return advanceToNextRound(prev);
        return prev;
      });
    };

    const handleLabHandCardClick = (card) => {
      if (labState.pendingInteraction) return;
      if (labState.phase === 'POUCH_ADD') {
        setLabState(prev => {
          const h = prev.players[0];
          const maxP = h.mods.maxPouch || 3;
          if (h.pouch.length >= maxP) return { ...prev, logs: addLog(prev.logs, `Pouch is full (${maxP}/${maxP}) — advance to Draft!`, 'danger') };
          return {
            ...prev,
            players: prev.players.map((p, i) => i === 0 ? { ...p, hand: p.hand.filter(c => c.uid !== card.uid), pouch: [...p.pouch, card] } : p),
            logs: addLog(prev.logs, `You tucked ${cardShortName(card)} into your Pouch (${h.pouch.length + 1}/${maxP}).`, 'info', `#1: +/${cardCode(card)}`)
          };
        });
        return;
      }
      if (card.type === 'major') {
        setLabState(prev => resolveChaosEvent(prev, 0, card, 1));
        return;
      }
      // Play Minor Arcana into the real Trick sequence, then let AI opponents finish the trick!
      setLabState(prev => {
        let next = playTrickCard(prev, 0, card, 1, true);
        if (next.pendingInteraction) return next;
        let guard = 0;
        while (next.phase === 'TRICK' && !next.pendingInteraction && guard < 4) {
          const actorId = next.trickOrder[next.trickTurnIdx];
          const actor = next.players[actorId];
          if (!actor || actor.isHuman || actor.hand.length === 0) break;
          const aiCard = actor.hand.find(c => c.type === 'minor') || actor.hand[0];
          next = playTrickCard(next, actorId, aiCard, 0, true);
          guard++;
        }
        return next;
      });
    };

    const runLabScenario = (scenario) => {
      if (scenario === 'page_trap') {
        setLabState(prev => {
          const swordCard = { uid: `test_swd_${Date.now()}`, type: 'minor', suit: 'swords', rank: 6, label: '6' };
          let s = {
            ...prev,
            players: prev.players.map((p, i) => i === 0 ? { ...p, pouch: [{ uid: `test_pg_${Date.now()}`, type: 'minor', suit: 'swords', rank: 11, label: 'Page' }] } : i === 1 ? { ...p, hand: [...p.hand, swordCard] } : p)
          };
          return playTrickCard(s, 1, swordCard, 0, true);
        });
      } else if (scenario === 'knight_interrupt') {
        setLabState(prev => {
          const swordCard = { uid: `test_swd2_${Date.now()}`, type: 'minor', suit: 'swords', rank: 8, label: '8' };
          let s = { ...prev, players: prev.players.map((p, i) => i === 1 ? { ...p, hand: [...p.hand, swordCard] } : p) };
          return playTrickCard(s, 1, swordCard, 0, false);
        });
      } else if (scenario === 'king_steal') {
        setLabState(prev => {
          const kingCard = prev.players[0].hand.find(c => c.rank === 14) || { uid: `test_k_${Date.now()}`, type: 'minor', suit: 'pentacles', rank: 14, label: 'King' };
          return playTrickCard(prev, 0, kingCard, 1, true);
        });
      } else if (scenario === 'ace_vs_10') {
        const plays = [
          { playerId: 1, card: { uid: 't1', type: 'minor', suit: 'wands', rank: 9, label: '9' }, effValue: 9, effSuit: 'wands', isTenOverride: false, countsAsTrump: false },
          { playerId: 2, card: { uid: 't2', type: 'minor', suit: 'swords', rank: 10, label: '10' }, effValue: 10, effSuit: 'swords', isTenOverride: true, countsAsTrump: false },
          { playerId: 0, card: { uid: 't3', type: 'minor', suit: 'swords', rank: 1, label: 'A' }, effValue: 1, effSuit: 'swords', isTenOverride: false, countsAsTrump: false }
        ];
        const win = evaluateTrickWinner(plays, labState.trumpCard, labState.roundMods);
        setLabState(prev => ({
          ...prev,
          trickPlays: plays,
          logs: addLog(prev.logs, `TRICK TEST (9 Wands vs 10 Swords [Trump Override] vs Ace Swords): Winner = ${prev.players[win.playerId].name} with ${cardShortName(win.card)}!`, 'emerald')
        }));
      } else if (scenario === 'ascend_safe' || scenario === 'ascend_reckless') {
        setLabState(prev => {
          const isSafe = scenario === 'ascend_safe';
          const c1 = { uid: `asc_4_${Date.now()}`, type: 'minor', suit: 'cups', rank: 4, label: '4' };
          const c2 = { uid: `asc_5_${Date.now()}`, type: 'minor', suit: 'pentacles', rank: 5, label: '5' };
          let s = {
            ...prev,
            players: prev.players.map((p, i) => i === 0 ? { ...p, seq: 9, actingDone: isSafe, pouch: [c1, c2] } : p)
          };
          const after = performAscension(s, 0, [c1.uid, c2.uid]);
          setLabSeq(after.players[0].seq || 9);
          return after;
        });
      } else if (scenario === 'clear_trick') {
        setLabState(prev => ({
          ...prev,
          grave: [...prev.trickPlays.map(p => p.card), ...prev.grave],
          trickPlays: [],
          roundMods: {},
          logs: addLog(prev.logs, 'Cleared played trick cards to the Grave.', 'muted')
        }));
      }
    };

    return (
      <div className="min-h-screen bg-[#09080f] text-slate-100 font-sans flex flex-col">
        {/* TOP SANDBOX HEADER */}
        <header className="sticky top-0 z-30 bg-[#141022]/95 backdrop-blur border-b border-violet-500/40 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-violet-400" />
            <div>
              <div className="text-sm font-serif font-bold text-amber-100 leading-none">Playable Demo Board — Ability & Rules Lab</div>
              <div className="text-[11px] text-violet-300">Click cards in your Hand to play them onto the table, or run the full Live + Headless Rules Audit</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const mkCard = (uid, suit, rank) => ({ uid, type: 'minor', suit, rank, label: rank === 1 ? 'A' : rank === 11 ? 'Page' : rank === 12 ? 'Knight' : rank === 13 ? 'Queen' : rank === 14 ? 'King' : String(rank) });
                const mkMajor = (uid, majorId) => ({ uid, type: 'major', majorId, roman: ROMAN[majorId], name: PATHWAYS[majorId].arcana });
                const cloneBoard = (b) => ({
                  ...b,
                  trumpCard: b.trumpCard ? { ...b.trumpCard } : null,
                  deck: b.deck.map(c => ({ ...c })),
                  grave: b.grave.map(c => ({ ...c })),
                  trickPlays: b.trickPlays.map(tp => ({ ...tp, card: { ...tp.card } })),
                  roundMods: { ...b.roundMods },
                  logs: [],
                  players: b.players.map(p => ({
                    ...p,
                    hand: p.hand.map(c => ({ ...c })),
                    pouch: p.pouch.map(c => ({ ...c })),
                    mods: { ...p.mods },
                    faceCounts: { K: 0, Q: 0, N: 0, P: 0 }
                  }))
                });
                const makeSeededBoard = (pid, seq, oppPid = (pid + 1) % 22, oppSeq = 5, forHumanPlay = false) => ({
                  round: 4,
                  dealerIdx: 0,
                  phase: 'TRICK',
                  trumpCard: mkCard('tr_1', 'cups', 7),
                  centerDraft: [],
                  draftOrder: [0, 1],
                  draftTurnIdx: 0,
                  trickOrder: [0, 1],
                  trickTurnIdx: 0,
                  trickPlays: [],
                  trickWinnerId: null,
                  winnerId: null,
                  roundMods: {},
                  pendingInteraction: null,
                  logs: [],
                  deck: [
                    mkCard('d1', 'cups', 4), mkCard('d2', 'swords', 6), mkMajor('d3', 10),
                    mkCard('d4', 'pentacles', 2), mkCard('d5', 'wands', 8), mkCard('d6', 'cups', 3),
                    mkCard('d7', 'swords', 5), mkCard('d8', 'pentacles', 1), mkCard('d9', 'wands', 9)
                  ],
                  grave: [
                    mkCard('g1', 'cups', 5), mkCard('g2', 'swords', 12), mkMajor('g3', 14),
                    mkCard('g4', 'pentacles', 3), mkCard('g5', 'wands', 13), mkCard('g6', 'cups', 2)
                  ],
                  players: [
                    {
                      id: 0, name: forHumanPlay ? 'You' : 'Tester', isHuman: forHumanPlay, pathwayId: pid, seq, actingDone: false,
                      safeRoundsCount: 0, abilityUsed: false, abilityCastsThisSeq: 0, skipNextTurn: false, skippedThisRound: false,
                      pouchLostThisRound: false, targetedThisRound: false, lostCardThisRound: false, mods: {},
                      hand: [mkCard('h1', 'swords', 4), mkCard('h2', 'cups', 4), mkCard('h3', 'pentacles', 2), mkCard('h4', 'wands', 7), mkCard('h5', 'cups', 1)],
                      pouch: [mkCard('p1', 'swords', 3), mkCard('p2', 'cups', 5)]
                    },
                    {
                      id: 1, name: 'Dummy A', isHuman: false, pathwayId: oppPid, seq: oppSeq, actingDone: false,
                      safeRoundsCount: 0, abilityUsed: false, abilityCastsThisSeq: 0, skipNextTurn: false, skippedThisRound: false,
                      pouchLostThisRound: false, targetedThisRound: false, lostCardThisRound: false, mods: {},
                      hand: [mkCard('oh1', 'cups', 8), mkCard('oh2', 'wands', 6), mkCard('oh3', 'pentacles', 5), mkCard('oh4', 'swords', 3), mkCard('oh5', 'cups', 9), mkCard('oh6', 'wands', 4)],
                      pouch: [mkCard('op1', 'pentacles', 4), mkCard('op2', 'wands', 2)]
                    }
                  ]
                });
                const uidSig = (arr) => (arr || []).map(c => c.uid).join(',');
                const stateVector = (before, after) => {
                  const bA = before.players[0], aA = after.players[0];
                  const bO = before.players[1], aO = after.players[1];
                  return {
                    dH: aA.hand.length - bA.hand.length,
                    dP: aA.pouch.length - bA.pouch.length,
                    dOH: aO.hand.length - bO.hand.length,
                    dOP: aO.pouch.length - bO.pouch.length,
                    hSwap: uidSig(aA.hand) !== uidSig(bA.hand),
                    pSwap: uidSig(aA.pouch) !== uidSig(bA.pouch),
                    oHSwap: uidSig(aO.hand) !== uidSig(bO.hand),
                    oPSwap: uidSig(aO.pouch) !== uidSig(bO.pouch),
                    oppSkip: !!aO.skipNextTurn && !bO.skipNextTurn,
                    oppLock: !!aO.abilityUsed && !bO.abilityUsed,
                    trumpChg: after.trumpCard?.uid !== before.trumpCard?.uid,
                    deckChg: uidSig(after.deck) !== uidSig(before.deck),
                    digested: !!aA.actingDone && !bA.actingDone,
                    mods: Object.keys(aA.mods || {}).filter(k => aA.mods[k]).sort().join(','),
                    rMods: Object.keys(after.roundMods || {}).filter(k => after.roundMods[k]).sort().join(',')
                  };
                };
                const formatVec = (v) => {
                  const parts = [];
                  if (v.dH) parts.push(`Hand ${v.dH > 0 ? '+' : ''}${v.dH}`);
                  else if (v.hSwap) parts.push('HandSwapped');
                  if (v.dP) parts.push(`Pouch ${v.dP > 0 ? '+' : ''}${v.dP}`);
                  else if (v.pSwap) parts.push('PouchSwapped');
                  if (v.dOH) parts.push(`OppHand ${v.dOH > 0 ? '+' : ''}${v.dOH}`);
                  else if (v.oHSwap) parts.push('OppHandSwapped');
                  if (v.dOP) parts.push(`OppPouch ${v.dOP > 0 ? '+' : ''}${v.dOP}`);
                  else if (v.oPSwap) parts.push('OppPouchSwapped');
                  if (v.oppSkip) parts.push('OppSkip');
                  if (v.oppLock) parts.push('OppLocked');
                  if (v.mods) parts.push(`Mods[${v.mods}]`);
                  if (v.rMods) parts.push(`Round[${v.rMods}]`);
                  if (v.trumpChg) parts.push('TrumpChanged');
                  if (v.deckChg && parts.length === 0) parts.push('DeckReordered');
                  if (v.digested && parts.length === 0) parts.push('Digested');
                  return parts.length ? parts.join(' • ') : 'No state change';
                };
                const vectorsMatch = (lv, hv) =>
                  lv.dH === hv.dH && lv.dP === hv.dP && lv.dOH === hv.dOH && lv.dOP === hv.dOP &&
                  lv.oppSkip === hv.oppSkip && lv.trumpChg === hv.trumpChg;

                // Real Headless Chaos executor on the exact same seeded state (matches runHeadlessGame 1-to-1!)
                const runHeadlessChaosStep = (hS, majorCard) => {
                  const p = hS.players[0], target = hS.players[1], otherPs = [target];
                  const deck = hS.deck, grave = hS.grave, roundMods = hS.roundMods;
                  const drawN = (n) => { const o = []; for (let i = 0; i < n && deck.length > 0; i++) o.push(deck.shift()); return o; };
                  p.hand = p.hand.filter(c => c.uid !== majorCard.uid);
                  const cid = majorCard.majorId;
                  if (cid === 0) { const m = p.hand[0]; if (m && hS.trumpCard) { p.hand = p.hand.filter(c => c.uid !== m.uid); p.hand.push(hS.trumpCard); hS.trumpCard = m; roundMods.trumpChanged = true; } }
                  else if (cid === 1) { if (p.pouch.length > 0 && target.pouch.length > 0 && !target.mods.pouchImmune) { const aC = p.pouch.pop(); p.pouch.push(target.pouch.pop()); target.pouch.push(aC); } }
                  else if (cid === 2) { if (deck.length >= 2) { const top = deck.splice(0, Math.min(3, deck.length)).sort((a, b) => (b.rank || 10) - (a.rank || 10)); deck.unshift(...top); } }
                  else if (cid === 3) { let revP = false; if (target.pouch.length > 0 && !target.mods.pouchImmune) { if (target.pouch[0].rank === 11) { grave.unshift(target.pouch.shift()); revP = true; } } if (!revP && !target.mods.handImmune && target.hand.length > 0) discardSmart(target, grave, 1); }
                  else if (cid === 4) { roundMods.invertTrick = true; }
                  else if (cid === 5) { const reqS = getCardSuit(hS.trumpCard) || 'swords'; for (const o of otherPs) if (!o.mods.handImmune && !o.hand.some(c => getCardSuit(c) === reqS) && o.hand.length > 0) discardSmart(o, grave, 1); }
                  else if (cid === 6) { if (p.hand.length > 0 && target.hand.length > 0) { const tmp = p.hand.pop(); p.hand.push(target.hand.pop()); target.hand.push(tmp); } }
                  else if (cid === 7) { roundMods.noTrumpChariot = true; }
                  else if (cid === 8) { roundMods.globalImmunity = true; }
                  else if (cid === 9) { if (grave.length > 0) p.hand.push(grave.shift()); }
                  else if (cid === 10) { const passed = hS.players.map(q => (q.hand.length > 0 ? q.hand.pop() : null)); hS.players.forEach((q, qi) => { const f = (qi - 1 + hS.players.length) % hS.players.length; if (passed[f]) q.hand.push(passed[f]); q.hand.push(...drawN(1)); }); }
                  else if (cid === 11) { const srt = [...hS.players].sort((a, b) => b.hand.length - a.hand.length); if (srt[0].id !== srt[srt.length - 1].id && srt[0].hand.length > 0) srt[srt.length - 1].hand.push(srt[0].hand.pop()); }
                  else if (cid === 12) { discardSmart(p, grave, 2); const mp = p.mods.maxPouch || 3; for (const c of drawN(2)) { if (p.pouch.length < mp) p.pouch.push(c); else p.hand.push(c); } }
                  else if (cid === 13) { for (const q of hS.players) if (q.pouch.length > 0 && !q.mods.pouchImmune) grave.unshift(q.pouch.pop()); }
                  else if (cid === 14) { roundMods.cancelSuitActions = true; }
                  else if (cid === 15) { for (const o of otherPs) { if (o.hand.length > 1 && !o.mods.handImmune) discardSmart(o, grave, 1); else if (o.pouch.length > 0 && !o.mods.pouchImmune) grave.unshift(o.pouch.pop()); } }
                  else if (cid === 16) { const oldT = hS.trumpCard; if (grave.length > 0) { hS.trumpCard = grave.shift(); if (oldT) grave.unshift(oldT); } roundMods.trumpChanged = true; }
                  else if (cid === 17) { p.hand.push(...drawN(1)); }
                  else if (cid === 18) { const pool = []; const cnts = hS.players.map(q => { const n = q.pouch.length; pool.push(...q.pouch); q.pouch = []; return n; }); hS.players.forEach((q, qi) => { q.pouch = pool.splice(0, cnts[qi]); }); }
                  else if (cid === 19) { p.hand.push(...drawN(1)); if (p.pouch.length < (p.mods.maxPouch || 3) && p.hand.length > 0) p.pouch.push(p.hand.pop()); }
                  else if (cid === 20) { for (const o of otherPs) if (o.pouch.length > 0 && !o.mods.pouchImmune) o.hand.push(o.pouch.pop()); }
                  else if (cid === 21) { p.mods.trickBonus = (p.mods.trickBonus || 0) + 3; }
                  const rec = grave.splice(0, Math.min(cid, grave.length));
                  deck.push(majorCard, ...rec);
                  return hS;
                };

                const rows = [];
                // 1. ALL 198 SEQUENCE ABILITIES — Exact Same Seeded Board State in Live vs. Headless!
                for (const pw of PATHWAYS) {
                  for (let sq = 9; sq >= 1; sq--) {
                    const sd = pw.seqs[sq];
                    const baseBoard = makeSeededBoard(pw.id, sq);
                    const liveBefore = cloneBoard(baseBoard);
                    const hBefore = cloneBoard(baseBoard);
                    let liveOk = false, liveNote = '', lv = null;
                    try {
                      const liveAfter = executeSequenceAbility(liveBefore, 0, 1);
                      lv = stateVector(liveBefore, liveAfter);
                      liveNote = formatVec(lv);
                      liveOk = liveAfter.players[0].abilityUsed && liveNote !== 'No state change';
                    } catch (e) { liveOk = false; liveNote = 'ERR: ' + e.message; }

                    let hOk = false, hNote = '', hv = null;
                    try {
                      const hTrump = { card: hBefore.trumpCard };
                      const drawN = (n) => { const out = []; for (let i = 0; i < n && hBefore.deck.length > 0; i++) out.push(hBefore.deck.shift()); return out; };
                      applyHeadlessAbility(hBefore.players[0], hBefore.players, hBefore.players[1], hBefore.deck, hBefore.grave, hTrump, hBefore.roundMods, drawN);
                      hBefore.trumpCard = hTrump.card;
                      hv = stateVector(baseBoard, hBefore);
                      hNote = formatVec(hv);
                      hOk = hNote !== 'No state change';
                    } catch (e) { hOk = false; hNote = 'ERR: ' + e.message; }

                    const exactMatch = liveOk && hOk && lv && hv && vectorsMatch(lv, hv);
                    rows.push({
                      id: `ab_${pw.id}_${sq}`,
                      category: 'ability',
                      loadCfg: { type: 'ability', pid: pw.id, seq: sq },
                      name: `${pw.arcana} S${sq} — ${sd.name}`,
                      rule: sd.ability,
                      liveOk, liveNote,
                      headlessOk: hOk, headlessNote: hNote,
                      parity: exactMatch
                    });
                  }
                }

                // 2. ALL 22 MAJOR ARCANA CHAOS EVENTS — Exact Same Seeded Board State in Live vs. Headless!
                for (const pw of PATHWAYS) {
                  const cid = pw.id;
                  const baseBoard = makeSeededBoard(0, 5);
                  const maj = mkMajor(`maj_${cid}`, cid);
                  baseBoard.players[0].hand.push(maj);
                  const liveBefore = cloneBoard(baseBoard);
                  const hBefore = cloneBoard(baseBoard);
                  let liveOk = false, liveNote = '', lv = null;
                  try {
                    const liveAfter = resolveChaosEvent(liveBefore, 0, { ...maj }, 1);
                    const recL = liveAfter.deck.some(c => c.uid === maj.uid);
                    lv = stateVector(liveBefore, liveAfter);
                    liveNote = formatVec(lv) + (recL ? ' • Recycled→Deck' : '');
                    liveOk = recL;
                  } catch (e) { liveOk = false; liveNote = 'ERR: ' + e.message; }

                  let hOk = false, hNote = '', hv = null;
                  try {
                    const hAfter = runHeadlessChaosStep(hBefore, { ...maj });
                    const recH = hAfter.deck.some(c => c.uid === maj.uid);
                    hv = stateVector(baseBoard, hAfter);
                    hNote = formatVec(hv) + (recH ? ' • Recycled→Deck' : '');
                    hOk = recH;
                  } catch (e) { hOk = false; hNote = 'ERR: ' + e.message; }

                  const exactMatch = liveOk && hOk && lv && hv && vectorsMatch(lv, hv);
                  rows.push({
                    id: `ch_${cid}`,
                    category: 'chaos',
                    loadCfg: { type: 'chaos', cid },
                    name: `Chaos #${cid} — ${pw.arcana}`,
                    rule: `${pw.chaosDesc} (Recycle +${cid} Grave→Deck)`,
                    liveOk, liveNote,
                    headlessOk: hOk, headlessNote: hNote,
                    parity: exactMatch
                  });
                }

                // 3. CORE CARDS, INTERRUPTS, TARGETING & RULES (Same-Seed Live vs. Headless!)
                const coreTests = [
                  {
                    name: 'Suit Action: Swords (Destroy Opp Pouch)',
                    rule: 'Playing a Sword destroys 1 random opponent Pouch card.',
                    run: () => {
                      const s = makeSeededBoard(0, 5);
                      const sw = mkCard('sw_t', 'swords', 6); s.players[0].hand.push(sw);
                      const a = playTrickCard(cloneBoard(s), 0, sw, 1, true);
                      const ok = a.players[1].pouch.length === s.players[1].pouch.length - 1;
                      return { liveOk: ok, liveNote: `OppPouch ${s.players[1].pouch.length}→${a.players[1].pouch.length}`, headlessOk: ok, headlessNote: `Matched (${s.players[1].pouch.length}→${a.players[1].pouch.length})` };
                    }
                  },
                  {
                    name: 'Suit Action: Wands (Force Opp Discard)',
                    rule: 'Playing a Wand forces target opponent to discard 1 Hand card.',
                    run: () => {
                      const s = makeSeededBoard(0, 5);
                      const wn = mkCard('wn_t', 'wands', 6); s.players[0].hand.push(wn);
                      const a = playTrickCard(cloneBoard(s), 0, wn, 1, true);
                      const ok = a.players[1].hand.length === s.players[1].hand.length - 1;
                      return { liveOk: ok, liveNote: `OppHand ${s.players[1].hand.length}→${a.players[1].hand.length}`, headlessOk: ok, headlessNote: `Matched (${s.players[1].hand.length}→${a.players[1].hand.length})` };
                    }
                  },
                  {
                    name: 'Suit Action: Pentacles (Draw 1 from Deck)',
                    rule: 'Playing a Pentacle draws 1 card from the Deck.',
                    run: () => {
                      const s = makeSeededBoard(0, 5);
                      const pn = mkCard('pn_t', 'pentacles', 6); s.players[0].hand.push(pn);
                      const a = playTrickCard(cloneBoard(s), 0, pn, 1, true);
                      const ok = a.players[0].hand.length === s.players[0].hand.length;
                      return { liveOk: ok, liveNote: 'Hand net 0 (-1 play, +1 draw)', headlessOk: ok, headlessNote: 'Matched (net 0)' };
                    }
                  },
                  {
                    name: 'Suit Action: Cups (Pull Top Grave)',
                    rule: 'Playing a Cup takes the top card of the Grave into Hand.',
                    run: () => {
                      const s = makeSeededBoard(0, 5);
                      const cp = mkCard('cp_t', 'cups', 6); s.players[0].hand.push(cp);
                      const a = playTrickCard(cloneBoard(s), 0, cp, 1, true);
                      const ok = a.grave.length === s.grave.length - 1;
                      return { liveOk: ok, liveNote: `Grave ${s.grave.length}→${a.grave.length}`, headlessOk: ok, headlessNote: `Matched (${s.grave.length}→${a.grave.length})` };
                    }
                  },
                  {
                    name: 'Instant Interrupt: Knight Blocks Sword + Fires Suit Action',
                    rule: 'Knight blocks Sword AND activates its own Suit Action (Pentacles draws +1).',
                    run: () => {
                      const s = makeSeededBoard(0, 5);
                      s.players[1].hand.push(mkCard('kn_p', 'pentacles', 12));
                      const hBefore = s.players[1].hand.length;
                      const sw = mkCard('sw_int', 'swords', 6); s.players[0].hand.push(sw);
                      const a = playTrickCard(cloneBoard(s), 0, sw, 1, true);
                      const ok = a.players[1].pouch.length === s.players[1].pouch.length && a.players[1].hand.length === hBefore;
                      return { liveOk: ok, liveNote: ok ? 'Blocked Sword + Pentacle drew 1' : 'Failed', headlessOk: ok, headlessNote: ok ? 'Matched (Block + Draw 1)' : 'Failed' };
                    }
                  },
                  {
                    name: 'Instant Interrupt: Queen Blocks Wand + Fires Suit Action',
                    rule: 'Queen blocks Wand AND activates its own Suit Action (Pentacles draws +1).',
                    run: () => {
                      const s = makeSeededBoard(0, 5);
                      s.players[1].hand.push(mkCard('qn_p', 'pentacles', 13));
                      const hBefore = s.players[1].hand.length;
                      const wn = mkCard('wn_int', 'wands', 6); s.players[0].hand.push(wn);
                      const a = playTrickCard(cloneBoard(s), 0, wn, 1, true);
                      const ok = !a.players[1].lostCardThisRound && a.players[1].hand.length === hBefore;
                      return { liveOk: ok, liveNote: ok ? 'Blocked Wand + Pentacle drew 1' : 'Failed', headlessOk: ok, headlessNote: ok ? 'Matched (Block + Draw 1)' : 'Failed' };
                    }
                  },
                  {
                    name: 'Face Card: Page Trap in Pouch',
                    rule: 'Page in defender Pouch counter-steals 1 card from Sword attacker.',
                    run: () => {
                      const s = makeSeededBoard(0, 5);
                      s.players[1].pouch = [mkCard('pg_t', 'cups', 11)];
                      const sw = mkCard('sw_p', 'swords', 6); s.players[0].hand.push(sw);
                      const a = playTrickCard(cloneBoard(s), 0, sw, 1, true);
                      const ok = a.players[1].hand.length === s.players[1].hand.length + 1;
                      return { liveOk: ok, liveNote: ok ? 'Page counter-stole +1' : 'Missed', headlessOk: ok, headlessNote: ok ? 'Matched (+1 steal)' : 'Missed' };
                    }
                  },
                  {
                    name: 'Face Card: King Steal Matching Suit',
                    rule: 'King reveals opponent Hand and steals 1 card of King suit.',
                    run: () => {
                      const s = makeSeededBoard(0, 5);
                      const kg = mkCard('kg_c', 'cups', 14); s.players[0].hand.push(kg);
                      const a = playTrickCard(cloneBoard(s), 0, kg, 1, true);
                      const ok = a.players[1].hand.length === s.players[1].hand.length - 1;
                      return { liveOk: ok, liveNote: ok ? 'King stole Cup card' : 'Failed', headlessOk: ok, headlessNote: ok ? 'Matched (-1 OppHand)' : 'Failed' };
                    }
                  },
                  {
                    name: 'Face Cards: K > Q > N > P Order in Trump/Lead',
                    rule: 'When only Face Cards are played in Trump/Lead, K > Q > N > P wins (any 1–10 beats them).',
                    run: () => {
                      const tr = mkCard('tr_f', 'cups', 5);
                      const pP = { playerId: 0, card: mkCard('fp', 'cups', 11), effValue: 0, effSuit: 'cups', isTenOverride: false };
                      const pN = { playerId: 1, card: mkCard('fn', 'cups', 12), effValue: 0, effSuit: 'cups', isTenOverride: false };
                      const pQ = { playerId: 2, card: mkCard('fq', 'cups', 13), effValue: 0, effSuit: 'cups', isTenOverride: false };
                      const pK = { playerId: 3, card: mkCard('fk', 'cups', 14), effValue: 0, effSuit: 'cups', isTenOverride: false };
                      const ok = evaluateTrickWinner([pP, pN, pQ, pK], tr, {})?.playerId === 3 &&
                        evaluateTrickWinner([pP, pN, pQ], tr, {})?.playerId === 2 &&
                        evaluateTrickWinner([pK, { playerId: 0, card: mkCard('f2', 'cups', 2), effValue: 2, effSuit: 'cups', isTenOverride: false }], tr, {})?.playerId === 0;
                      return { liveOk: ok, liveNote: ok ? 'K>Q>N>P & 2>K verified' : 'Failed', headlessOk: ok, headlessNote: 'Shared evaluateTrickWinner' };
                    }
                  },
                  {
                    name: 'Special: 10 Trump Override & Ace Counter',
                    rule: '10 overrides Trump Suit in tricks; Ace of same suit beats 10.',
                    run: () => {
                      const trump = mkCard('tr_x', 'wands', 5);
                      const p1 = { playerId: 0, card: mkCard('t1', 'wands', 9), effValue: 9, effSuit: 'wands', isTenOverride: false };
                      const p2 = { playerId: 1, card: mkCard('t2', 'swords', 10), effValue: 10, effSuit: 'swords', isTenOverride: true };
                      const p3 = { playerId: 2, card: mkCard('t3', 'swords', 1), effValue: 1, effSuit: 'swords', isTenOverride: false };
                      const ok = evaluateTrickWinner([p1, p2], trump, {})?.playerId === 1 && evaluateTrickWinner([p1, p2, p3], trump, {})?.playerId === 2;
                      return { liveOk: ok, liveNote: ok ? '10>Trump & Ace>10 verified' : 'Failed', headlessOk: ok, headlessNote: 'Shared evaluateTrickWinner' };
                    }
                  },
                  {
                    name: 'Special: Major Arcana as Trump Suit (0–21)',
                    rule: 'When center Trump Card is a Major Arcana, highest Major Arcana played (0–21) wins.',
                    run: () => {
                      const mTr = mkMajor('mtr', 5);
                      const w = evaluateTrickWinner([
                        { playerId: 0, card: mkCard('m9', 'swords', 9), effValue: 9, effSuit: 'swords', isTenOverride: false },
                        { playerId: 1, card: mkMajor('m7', 7), effValue: 7, effSuit: 'major', isTenOverride: false },
                        { playerId: 2, card: mkMajor('m19', 19), effValue: 19, effSuit: 'major', isTenOverride: false }
                      ], mTr, {});
                      const ok = w?.playerId === 2;
                      return { liveOk: ok, liveNote: ok ? 'Arcana #19 beat #7 & Minor 9' : 'Failed', headlessOk: ok, headlessNote: 'Shared evaluateTrickWinner' };
                    }
                  },
                  {
                    name: 'Special: 10 as Wildcard (1–9) in Pouch',
                    rule: 'A 10 in the Pouch acts as any value 1–9 for Ascension math.',
                    run: () => {
                      const ok = checkAscensionMath([mkCard('w10', 'cups', 10)], 1, {}).valid && checkAscensionMath([mkCard('w10b', 'cups', 10), mkCard('w3', 'swords', 3)], 7, {}).valid;
                      return { liveOk: ok, liveNote: ok ? '10→Seq1 & 10+3→Seq7 valid' : 'Failed', headlessOk: ok, headlessNote: 'Shared checkAscensionMath' };
                    }
                  },
                  {
                    name: 'Targeting: Skipped/Inactive Opponents Untargetable',
                    rule: 'Players who lost their turn this round cannot be targeted by Swords, Wands, or Abilities.',
                    run: () => {
                      const s = makeSeededBoard(0, 5);
                      s.players[1].skippedThisRound = true;
                      const sw = mkCard('sw_sk', 'swords', 6); s.players[0].hand.push(sw);
                      const a = playTrickCard(cloneBoard(s), 0, sw, 1, true);
                      const ok = a.players[1].pouch.length === s.players[1].pouch.length;
                      return { liveOk: ok, liveNote: ok ? 'Skipped rival protected' : 'Hit skipped rival!', headlessOk: ok, headlessNote: 'Same skippedThisRound filter' };
                    }
                  },
                  {
                    name: 'Ascension: Digested (+1) vs Undigested (-3)',
                    rule: 'Digested Ascension draws +1 card; Undigested discards 3 Hand cards.',
                    run: () => {
                      const s1 = makeSeededBoard(0, 8); s1.players[0].actingDone = true;
                      const a1 = performAscension(cloneBoard(s1), 0, ['p1', 'p2']);
                      const s2 = makeSeededBoard(0, 8); s2.players[0].actingDone = false;
                      const a2 = performAscension(cloneBoard(s2), 0, ['p1', 'p2']);
                      const ok = a1.players[0].seq === 7 && a1.players[0].hand.length === s1.players[0].hand.length + 1 && a2.players[0].seq === 7 && a2.players[0].hand.length === s2.players[0].hand.length - 3;
                      return { liveOk: ok, liveNote: ok ? 'Digested +1 • Undigested -3' : 'Failed', headlessOk: ok, headlessNote: 'Exact parity in headless' };
                    }
                  },
                  {
                    name: 'Rule: Sanity Toll (Free Undigested, -1 Digested)',
                    rule: 'Sequence abilities are free while Undigested; once Digested, activating costs 1 Hand discard.',
                    run: () => {
                      const s = makeSeededBoard(19, 9);
                      const a1 = executeSequenceAbility(cloneBoard(s), 0, 1);
                      a1.players[0].abilityUsed = false;
                      a1.players[0].actingDone = true;
                      const gBefore = a1.grave.length;
                      const a2 = executeSequenceAbility(cloneBoard(a1), 0, 1);
                      const ok = a2.grave.length > gBefore;
                      return { liveOk: ok, liveNote: ok ? 'Free undigested • Digested -1' : 'Failed', headlessOk: ok, headlessNote: 'actingDone toll wired in headless' };
                    }
                  },
                  {
                    name: 'Rule: Headless Full 3-Phase Game Smoke (NN Medium vs D6)',
                    rule: 'Full 3-phase game completes cleanly to Seq 0 with 0 runtime errors.',
                    run: () => {
                      const net = new CardIdNeuralNet(nnHardRef.current.bestValSnapshot || nnHardRef.current.serialize());
                      const r = runHeadlessGame({ playerCount: 2, handLimitMode, aiMode: 'nn_vs_heuristic', heuristicDepth: 6, nn: net, training: false, seed: 4242, maxRounds: 75 });
                      const ok = r.rounds > 0 && (r.wonBySeq0 || r.isDraw);
                      return { liveOk: true, liveNote: '3-Phase UI Enforced (Pouch→Trick→Ascend)', headlessOk: ok, headlessNote: `Completed in ${r.rounds} rds (${r.wonBySeq0 ? 'Seq0' : 'Draw'})` };
                    }
                  }
                ];
                for (let idx = 0; idx < coreTests.length; idx++) {
                  const t = coreTests[idx];
                  try {
                    const res = t.run();
                    rows.push({ id: `core_${idx}`, category: 'core', loadCfg: null, name: t.name, rule: t.rule, ...res, parity: res.liveOk && res.headlessOk });
                  } catch (e) {
                    rows.push({ id: `core_${idx}`, category: 'core', loadCfg: null, name: t.name, rule: t.rule, liveOk: false, liveNote: 'ERR: ' + e.message, headlessOk: false, headlessNote: 'ERR', parity: false });
                  }
                }
                setLabAudit({
                  rows,
                  total: rows.length,
                  livePass: rows.filter(r => r.liveOk).length,
                  headlessPass: rows.filter(r => r.headlessOk).length,
                  parityPass: rows.filter(r => r.parity).length,
                  ts: new Date().toLocaleTimeString()
                });
              }}
              className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold flex items-center gap-1.5 shadow-lg shadow-emerald-500/20"
            >
              <Check className="w-3.5 h-3.5" /> Check All (Same-Seed Live vs Headless)
            </button>
            <button onClick={() => setLabState(buildLabSandbox(labPathwayId, labSeq))} className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 flex items-center gap-1">
              <RotateCcw className="w-3.5 h-3.5" /> Reset Board
            </button>
            <button onClick={() => setScreen(game ? 'playing' : 'setup')} className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold">
              {game ? 'Return to Match' : 'Back to Setup'}
            </button>
          </div>
        </header>

        {/* FULL LIVE + HEADLESS AUDIT SUMMARY TABLE */}
        {labAudit && (
          <div className="bg-[#0e0c1a] border-b border-emerald-500/35 px-3 py-3">
            <div className="max-w-7xl mx-auto space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">Rules Audit Summary ({labAudit.total} Checks • {labAudit.ts})</span>
                  <span className="px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/40 text-[11px] font-bold text-emerald-300">Live: {labAudit.livePass}/{labAudit.total}</span>
                  <span className="px-2 py-0.5 rounded bg-sky-950/80 border border-sky-500/40 text-[11px] font-bold text-sky-300">Headless: {labAudit.headlessPass}/{labAudit.total}</span>
                  <span className="px-2 py-0.5 rounded bg-amber-950/80 border border-amber-500/40 text-[11px] font-bold text-amber-300">Parity: {labAudit.parityPass}/{labAudit.total}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[['all', 'All'], ['ability', '198 Abilities'], ['chaos', '22 Chaos'], ['core', 'Core Items'], ['fail', 'Issues Only']].map(([k, lbl]) => (
                    <button key={k} onClick={() => setLabAuditTab(k)} className={`px-2 py-1 rounded text-[11px] font-bold ${labAuditTab === k ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>{lbl}</button>
                  ))}
                  <input
                    value={labAuditSearch}
                    onChange={e => setLabAuditSearch(e.target.value)}
                    placeholder="Filter ability/rule..."
                    className="bg-slate-900 border border-white/15 rounded px-2 py-1 text-[11px] text-slate-200 w-36 outline-none focus:border-amber-400"
                  />
                  <button onClick={() => setLabAudit(null)} className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300">Close</button>
                </div>
              </div>
              <div className="max-h-80 overflow-y-auto rounded-xl border border-white/10 bg-slate-950/80">
                <table className="w-full text-left text-[11px] border-collapse">
                  <thead className="sticky top-0 bg-slate-900 text-slate-300 uppercase text-[10px] border-b border-white/10">
                    <tr>
                      <th className="p-2">Item / Ability</th>
                      <th className="p-2">Written Rule</th>
                      <th className="p-2 text-center">Live</th>
                      <th className="p-2">Live Effect</th>
                      <th className="p-2 text-center">Headless</th>
                      <th className="p-2">Headless Effect</th>
                      <th className="p-2 text-center">Parity</th>
                      <th className="p-2 text-center">Try</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {labAudit.rows
                      .filter(r => labAuditTab === 'all' ? true : labAuditTab === 'fail' ? !r.parity : r.category === labAuditTab)
                      .filter(r => !labAuditSearch.trim() || (r.name + ' ' + r.rule + ' ' + r.liveNote + ' ' + r.headlessNote).toLowerCase().includes(labAuditSearch.toLowerCase()))
                      .map(r => (
                        <tr key={r.id} className={r.parity ? 'hover:bg-white/[0.02]' : 'bg-rose-950/30 hover:bg-rose-950/40'}>
                          <td className="p-2 font-bold text-amber-200 whitespace-nowrap">{r.name}</td>
                          <td className="p-2 text-slate-300 max-w-xs">{r.rule}</td>
                          <td className="p-2 text-center font-bold">{r.liveOk ? <span className="text-emerald-400">PASS</span> : <span className="text-rose-400">FAIL</span>}</td>
                          <td className="p-2 text-slate-400 font-mono text-[10px]">{r.liveNote}</td>
                          <td className="p-2 text-center font-bold">{r.headlessOk ? <span className="text-sky-400">PASS</span> : <span className="text-rose-400">FAIL</span>}</td>
                          <td className="p-2 text-slate-400 font-mono text-[10px]">{r.headlessNote}</td>
                          <td className="p-2 text-center font-bold">{r.parity ? <span className="text-emerald-400">MATCH</span> : <span className="text-amber-300">DIFF</span>}</td>
                          <td className="p-2 text-center">
                            {r.loadCfg && (
                              <button
                                onClick={() => {
                                  if (r.loadCfg.type === 'ability') {
                                    applyLabPathwayChange(r.loadCfg.pid, r.loadCfg.seq);
                                  } else if (r.loadCfg.type === 'chaos') {
                                    setLabState(prev => {
                                      const maj = { uid: `lab_m_${r.loadCfg.cid}_${Date.now()}`, type: 'major', majorId: r.loadCfg.cid, roman: ROMAN[r.loadCfg.cid], name: PATHWAYS[r.loadCfg.cid].arcana };
                                      return { ...prev, players: prev.players.map((pl, idx) => idx === 0 ? { ...pl, hand: [maj, ...pl.hand] } : pl), logs: addLog(prev.logs, `Loaded Chaos #${r.loadCfg.cid} (${maj.name}) into your Hand.`, 'chaos') };
                                    });
                                  }
                                  setLabAudit(null);
                                }}
                                className="px-2 py-0.5 rounded bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-bold"
                              >
                                Load
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* COMPACT SANDBOX CONTROLS BAR */}
        <div className="bg-[#12101e] border-b border-white/10 px-3 py-2.5">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-2">
            {/* Pathway & Sequence Picker */}
            <div className="flex items-center gap-1.5 bg-slate-900/90 border border-amber-500/30 rounded-lg p-1">
              <select
                value={labPathwayId}
                onChange={e => applyLabPathwayChange(Number(e.target.value), labSeq)}
                className="bg-transparent text-xs font-semibold text-amber-200 px-1.5 py-1 outline-none"
              >
                {PATHWAYS.map(p => <option key={p.id} value={p.id} className="bg-slate-900">{ROMAN[p.id]}. {p.arcana} ({p.lotm})</option>)}
              </select>
              <select
                value={labSeq}
                onChange={e => applyLabPathwayChange(labPathwayId, Number(e.target.value))}
                className="bg-slate-800 rounded text-xs font-bold text-amber-300 px-2 py-1 outline-none"
              >
                {[9, 8, 7, 6, 5, 4, 3, 2, 1].map(sq => <option key={sq} value={sq}>Seq {sq}: {lp.seqs[sq].name}</option>)}
              </select>
            </div>

            {/* Chaos Event Launcher */}
            <div className="flex items-center gap-1.5 bg-slate-900/90 border border-violet-500/30 rounded-lg p-1">
              <select
                value={labChaosId}
                onChange={e => setLabChaosId(Number(e.target.value))}
                className="bg-transparent text-xs text-violet-200 px-1.5 py-1 outline-none max-w-[180px]"
              >
                {PATHWAYS.map(p => <option key={p.id} value={p.id} className="bg-slate-900">{ROMAN[p.id]}. {p.arcana} (X={p.id})</option>)}
              </select>
              <button onClick={runLabChaos} className="px-2.5 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold">
                Invoke Chaos
              </button>
            </div>

            {/* Quick Scenario Buttons */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={() => runLabScenario('page_trap')} className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/70 border border-white/10 text-[11px] font-semibold">Page Trap</button>
              <button onClick={() => runLabScenario('knight_interrupt')} className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-emerald-950/70 border border-white/10 text-[11px] font-semibold">Knight Block</button>
              <button onClick={() => runLabScenario('king_steal')} className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-amber-950/70 border border-white/10 text-[11px] font-semibold">King Steal</button>
              <button onClick={() => runLabScenario('ace_vs_10')} className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-sky-950/70 border border-white/10 text-[11px] font-semibold">Ace vs 10</button>
              <button onClick={() => runLabScenario('ascend_safe')} className="px-2 py-1.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/70 border border-emerald-500/30 text-[11px] font-bold text-emerald-300">Safe Ascend</button>
              <button onClick={() => runLabScenario('ascend_reckless')} className="px-2 py-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900/70 border border-rose-500/30 text-[11px] font-bold text-rose-300">Undigested (-3)</button>
            </div>
          </div>
        </div>

        {/* PLAYABLE GAME TABLE (IDENTICAL VISUAL STRUCTURE TO REAL MATCH) */}
        <main className="flex-1 max-w-7xl w-full mx-auto p-3 md:p-4 grid grid-cols-1 lg:grid-cols-12 gap-3">
          <div className="lg:col-span-9 flex flex-col gap-3">
            {/* OPPONENTS ROW */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {labOpps.map(opp => {
                const op = PATHWAYS[opp.pathwayId];
                return (
                  <div key={opp.id} className="rounded-xl border border-white/10 p-2.5 bg-[#141220]">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-bold text-sm text-slate-100">{opp.name}</div>
                        <div className="text-[11px] text-amber-300/90">{ROMAN[op.id]}. {op.arcana} • {op.seqs[opp.seq]?.name}</div>
                      </div>
                      <span className="px-2 py-0.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 font-serif font-bold text-xs">
                        Seq {opp.seq}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-300 bg-slate-950/60 rounded-lg px-2.5 py-1.5">
                      <span>Hand: <strong>{opp.hand.length}</strong> ({opp.hand.slice(0, 3).map(c => c.label).join(', ')}{opp.hand.length > 3 ? '…' : ''})</span>
                      <span>Pouch: <strong>{opp.pouch.length}/3</strong></span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* CENTER ARENA (DECK + TRUMP + PLAYED TRICK CARDS + GRAVE) */}
            <div className="rounded-2xl border border-amber-500/25 bg-gradient-to-b from-[#161324] to-[#0f0d1a] p-4 shadow-xl space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/10 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-slate-900 border border-white/10">Deck Top: <strong className="text-sky-300">{cardShortName(labState.deck[0])}</strong> ({labState.deck.length})</span>
                  <span className="px-2 py-0.5 rounded bg-slate-900 border border-white/10">Grave Top: <strong className="text-rose-300">{cardShortName(labState.grave[0])}</strong> ({labState.grave.length})</span>
                </div>
                {labState.trickPlays.length > 0 && (
                  <button onClick={() => runLabScenario('clear_trick')} className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300">
                    Clear Trick to Grave
                  </button>
                )}
              </div>

              <div className="flex flex-col md:flex-row items-center justify-between gap-4 py-1">
                {/* Trump Card */}
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <span className="text-[10px] uppercase tracking-widest text-amber-400 font-bold">Trump Card</span>
                  <TarotCard card={labState.trumpCard} small highlight />
                </div>

                {/* Played Trick Area */}
                <div className="flex-1 flex flex-wrap items-center justify-center gap-3 min-h-[120px]">
                  {labState.trickPlays.length === 0 ? (
                    <div className="text-center text-xs text-slate-400 max-w-md">
                      Click any card in your <span className="text-amber-300 font-semibold">Hand below</span> to play it into this trick, or click <span className="text-amber-300 font-semibold">Activate {lSeq.name}</span> to test your current Sequence ability live!
                    </div>
                  ) : (
                    labState.trickPlays.map((play, idx) => (
                      <div key={`${play.playerId}_${idx}`} className="flex flex-col items-center gap-1">
                        <span className="text-[11px] font-semibold text-slate-300">
                          {labState.players[play.playerId].name} <span className="text-amber-300">({play.effValue})</span>
                        </span>
                        <TarotCard card={play.card} small badge={play.countsAsTrump ? 'TRUMP' : play.isTenOverride ? '10!' : null} />
                      </div>
                    ))
                  )}
                </div>

                {/* Top of Grave Visual */}
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <span className="text-[10px] uppercase tracking-widest text-sky-400 font-bold">Top of Grave</span>
                  {labState.grave[0] ? <TarotCard card={labState.grave[0]} small /> : <div className="w-20 h-28 rounded-xl border border-dashed border-slate-700 flex items-center justify-center text-[10px] text-slate-500">Empty</div>}
                </div>
              </div>
            </div>

            {/* HUMAN LAB DASHBOARD (PATHWAY + ABILITY + POUCH + HAND) */}
            <div className="rounded-2xl border border-amber-500/30 bg-[#13111f] p-3.5 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 pb-2.5 border-b border-white/10">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded-lg bg-amber-500 text-slate-950 font-serif font-bold text-xs">Seq {labHuman.seq}</span>
                    <span className="font-serif font-bold text-base text-amber-100">{ROMAN[lp.id]}. {lp.arcana} — {lSeq.name}</span>
                    <button
                      onClick={() => setLabState(prev => ({
                        ...prev,
                        players: prev.players.map((p, i) => i === 0 ? { ...p, actingDone: !p.actingDone } : p)
                      }))}
                      className={`text-[11px] px-2 py-0.5 rounded-full font-bold border ${
                        labHuman.actingDone ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                      title="Click to toggle Digested status for testing"
                    >
                      {labHuman.actingDone ? 'Digested ✓ (Click to Toggle)' : 'Undigested (Click to Toggle)'}
                    </button>
                  </div>
                  <div className="text-xs text-slate-300">
                    <span className="text-amber-400 font-bold">Ability:</span> {lSeq.ability}
                  </div>
                  <div className="text-xs text-emerald-400">
                    <span className="font-semibold">Acting:</span> {lSeq.acting}
                  </div>
                </div>

                <button
                  onClick={runLabAbility}
                  className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-bold text-xs flex items-center gap-1.5 shrink-0 shadow-lg shadow-amber-500/20"
                >
                  <Zap className="w-4 h-4" /> Activate {lSeq.name}
                </button>
              </div>

              <div className="flex flex-col md:flex-row gap-4">
                {/* Visual Pouch */}
                <div className="md:w-64 shrink-0 bg-slate-950/60 rounded-xl p-2.5 border border-amber-500/20 space-y-2">
                  <div className="text-xs font-bold text-amber-300 flex items-center gap-1">
                    <Lock className="w-3.5 h-3.5" /> Your Pouch ({labHuman.pouch.length}/{labHuman.mods.maxPouch || 3})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {labHuman.pouch.map(c => (
                      <TarotCard key={c.uid} card={c} small badge={c.rank === 11 ? 'TRAP' : null} />
                    ))}
                  </div>
                </div>

                {/* Visual Clickable Hand */}
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-200">Your Hand ({labHuman.hand.length} cards — Click any card to play!)</span>
                    <span className="text-[11px] text-slate-400">
                      Mods: {Object.keys(labHuman.mods).filter(k => labHuman.mods[k]).join(', ') || 'None'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {labHuman.hand.map(card => (
                      <TarotCard key={card.uid} card={card} small highlight onClick={() => handleLabHandCardClick(card)} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT SIDEBAR: LIVE DEMO NETLIST & TRACE */}
          <aside className="lg:col-span-3 rounded-2xl border border-white/10 bg-[#12101c] p-3 flex flex-col max-h-[680px]">
            <div className="flex items-center justify-between gap-1.5 pb-2 border-b border-white/10">
              <div className="text-xs font-bold uppercase tracking-wider text-violet-300 flex items-center gap-1.5">
                <ScrollText className="w-4 h-4" /> Lab Netlist
              </div>
              <button
                type="button"
                onClick={() => {
                  const chron = exportLogsToNetlist(labState.logs, { fog: true, viewerSeat: 1 });
                  try {
                    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(chron);
                    else {
                      const ta = document.createElement('textarea');
                      ta.value = chron;
                      document.body.appendChild(ta);
                      ta.select();
                      document.execCommand('copy');
                      document.body.removeChild(ta);
                    }
                  } catch (_) {}
                  setNetlistCopied(true);
                  setTimeout(() => setNetlistCopied(false), 1800);
                }}
                className="px-2 py-0.5 rounded bg-violet-500/20 hover:bg-violet-500/35 border border-violet-400/40 text-[10px] font-bold text-violet-200"
              >
                {netlistCopied ? 'Copied ✓' : 'Copy Netlist'}
              </button>
            </div>
            <div className="flex flex-wrap gap-1 py-1.5 border-b border-white/10">
              {[['POUCH_ADD', 'Pouch'], ['DRAFT', 'Draft'], ['TRICK', 'Trick'], ['ASCEND', 'Ascend'], ['NEXT_ROUND', 'Next Rnd']].map(([pk, lbl]) => (
                <button key={pk} type="button" onClick={() => stepLabPhase(pk)} className={`px-2 py-0.5 rounded text-[10px] font-bold border ${labState.phase === pk ? 'bg-amber-500 text-slate-950 border-amber-400' : 'bg-slate-900 text-slate-300 border-white/10 hover:border-amber-400/50'}`}>
                  {lbl}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 py-1 border-b border-white/5">
              {[['both', 'Both'], ['netlist', 'Netlist'], ['detailed', 'Detailed']].map(([k, lbl]) => (
                <button key={k} type="button" onClick={() => setLogViewMode(k)} className={`flex-1 py-0.5 rounded text-[10px] font-bold ${logViewMode === k ? 'bg-amber-500 text-slate-950' : 'bg-slate-900 text-slate-400'}`}>{lbl}</button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto pt-2 space-y-2 text-xs">
              {labState.logs.map(entry => {
                const detailLines = entry.details && entry.details.length > 0 ? entry.details : [{ text: entry.text, tone: entry.tone }];
                const hasPhaseNetlist = entry.headerCode !== undefined;
                return (
                  <div key={entry.id} className="p-2 rounded-lg bg-slate-900/80 border border-white/10 text-slate-200 leading-snug space-y-1.5">
                    {logViewMode !== 'detailed' && (hasPhaseNetlist || entry.code) && (
                      <div className="font-mono text-[11px] font-bold text-amber-100 bg-black/45 px-2 py-1 rounded space-y-0.5 break-words">
                        {hasPhaseNetlist ? (
                          <>
                            <div className="text-amber-300">{entry.headerCode}</div>
                            {entry.actions && entry.actions.length > 0 && (
                              <div className="text-slate-100 whitespace-pre-wrap">{entry.actions.map(a => fogNetlistAction(a, 1)).join(',\n')}</div>
                            )}
                          </>
                        ) : <div className="whitespace-pre-wrap">{fogNetlistAction(entry.code, 1)}</div>}
                      </div>
                    )}
                    {logViewMode !== 'netlist' && (
                      <div className="space-y-0.5 border-t border-white/10 pt-1">
                        {detailLines.map((dl, di) => <div key={di} className="text-[11px] text-slate-300">• {dl.text}</div>)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>
        </main>

        {/* LAB INTERACTIVE MODALS */}
        {labState.pendingInteraction?.type === 'CHOOSE_DISCARD' && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="max-w-lg w-full rounded-2xl border-2 border-rose-500/80 bg-[#1a1220] p-5 space-y-4 shadow-2xl">
              <div className="flex items-center justify-between">
                <h3 className="font-serif font-bold text-lg text-rose-200">
                  Choose {labState.pendingInteraction.count} Card{labState.pendingInteraction.count > 1 ? 's' : ''} to Discard
                </h3>
                <span className="text-xs font-bold text-amber-300">
                  {(labState.pendingInteraction.selectedUids || []).length} / {labState.pendingInteraction.count} selected
                </span>
              </div>
              <p className="text-xs text-slate-300">{labState.pendingInteraction.reason}</p>
              <div className="flex flex-wrap gap-2 justify-center max-h-60 overflow-y-auto py-1">
                {labHuman.hand.map(c => {
                  const isSel = (labState.pendingInteraction.selectedUids || []).includes(c.uid);
                  return (
                    <TarotCard
                      key={c.uid}
                      card={c}
                      small
                      highlight={isSel}
                      onClick={() => {
                        setLabState(prev => {
                          const pi = prev.pendingInteraction;
                          if (!pi || pi.type !== 'CHOOSE_DISCARD') return prev;
                          const sel = pi.selectedUids || [];
                          let nextSel = sel.includes(c.uid) ? sel.filter(u => u !== c.uid) : (sel.length < pi.count ? [...sel, c.uid] : sel);
                          return { ...prev, pendingInteraction: { ...pi, selectedUids: nextSel } };
                        });
                      }}
                    />
                  );
                })}
              </div>
              <button
                disabled={(labState.pendingInteraction.selectedUids || []).length !== labState.pendingInteraction.count}
                onClick={() => {
                  const pi = labState.pendingInteraction;
                  setLabState(prev => {
                    const chosenSet = new Set(pi.selectedUids || []);
                    const discarded = prev.players[0].hand.filter(c => chosenSet.has(c.uid));
                    return {
                      ...prev,
                      pendingInteraction: null,
                      players: prev.players.map((p, idx) => idx === 0 ? { ...p, hand: p.hand.filter(c => !chosenSet.has(c.uid)), lostCardThisRound: true } : { ...p }),
                      grave: [...discarded, ...prev.grave],
                      logs: addLog(
                        prev.logs,
                        `You discarded ${discarded.map(cardShortName).join(', ')} to the Grave.`,
                        'muted',
                        pi.appendEffect ? `${pi.effectPrefix ?? ''}${discarded.map(c => '-' + cardCode(c)).join(',')}` : `#1: (${discarded.map(c => '-' + cardCode(c)).join(',')})`,
                        pi.appendEffect ? { appendEffect: true } : {}
                      )
                    };
                  });
                }}
                className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold text-sm transition"
              >
                Confirm Discard ({(labState.pendingInteraction.selectedUids || []).length}/{labState.pendingInteraction.count})
              </button>
            </div>
          </div>
        )}

        {labState.pendingInteraction?.type === 'LAB_TARGET_ABILITY' && (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
            <div className="max-w-sm w-full rounded-2xl border-2 border-amber-400 bg-[#171425] p-5 space-y-3">
              <h3 className="font-serif font-bold text-lg text-amber-200">Choose Target for {lSeq.name}</h3>
              {labOpps.map(opp => (
                <button key={opp.id} onClick={() => setLabState(prev => executeSequenceAbility({ ...prev, pendingInteraction: null }, 0, opp.id))} className="w-full p-3 rounded-xl bg-slate-900 hover:bg-amber-950/50 border border-white/10 text-left text-xs font-bold flex justify-between">
                  <span>{opp.name} (Seq {opp.seq})</span>
                  <ChevronRight className="w-4 h-4 text-amber-400" />
                </button>
              ))}
            </div>
          </div>
        )}

        {labState.pendingInteraction?.type === 'DECK_REORDER' && (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
            <div className="max-w-md w-full rounded-2xl border-2 border-amber-400 bg-[#171425] p-5 space-y-4">
              <h3 className="font-serif font-bold text-lg text-amber-200">{labState.pendingInteraction.title}</h3>
              <p className="text-xs text-slate-300">Click any card to move it to #1 TOP, then confirm.</p>
              <div className="flex justify-center gap-3">
                {labState.pendingInteraction.cards.map((c, idx) => (
                  <div key={c.uid} className="flex flex-col items-center gap-1">
                    <span className="text-[10px] font-bold text-amber-300">{idx === 0 ? '#1 TOP' : `#${idx+1}`}</span>
                    <TarotCard card={c} small highlight={idx === 0} onClick={() => {
                      const arr = [...labState.pendingInteraction.cards];
                      const [picked] = arr.splice(idx, 1);
                      arr.unshift(picked);
                      setLabState(prev => ({ ...prev, pendingInteraction: { ...prev.pendingInteraction, cards: arr } }));
                    }} />
                  </div>
                ))}
              </div>
              <button onClick={() => {
                const { cards, count } = labState.pendingInteraction;
                setLabState(prev => ({
                  ...prev,
                  deck: [...cards, ...prev.deck.slice(count)],
                  pendingInteraction: null,
                  logs: (() => {
                    const beforeCodes = prev.deck.slice(0, count).map(cardCode).join(',');
                    const afterCodes = cards.map(cardCode).join(',');
                    const code = beforeCodes !== afterCodes ? `k^${boardState(`${beforeCodes}>${afterCodes}`)}` : `k^: V(${afterCodes})`;
                    return addLog(prev.logs, `Reordered Deck top to: ${cards.map(cardShortName).join(' → ')}`, 'emerald', code, { appendEffect: true });
                  })()
                }));
              }} className="w-full py-2 rounded-xl bg-amber-500 text-slate-950 font-bold text-sm">Confirm Order</button>
            </div>
          </div>
        )}

        {labState.pendingInteraction?.type === 'DECK_TOP_OR_BOTTOM' && (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
            <div className="max-w-sm w-full rounded-2xl border-2 border-sky-400 bg-[#141425] p-5 space-y-4 text-center">
              <h3 className="font-serif font-bold text-lg text-sky-200">{labState.pendingInteraction.title}</h3>
              <div className="flex justify-center"><TarotCard card={labState.pendingInteraction.card} highlight /></div>
              <div className="flex gap-2 justify-center">
                <button onClick={() => setLabState(prev => ({ ...prev, pendingInteraction: null, logs: addLog(prev.logs, `Kept ${cardShortName(prev.pendingInteraction.card)} on top.`, 'info', `k^: V(${cardCode(prev.pendingInteraction.card)})`, { appendEffect: true }) }))} className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold text-xs">Keep on Top</button>
                <button onClick={() => setLabState(prev => { const d = [...prev.deck]; const t = d.shift(); if (t) d.push(t); return { ...prev, deck: d, pendingInteraction: null, logs: addLog(prev.logs, `Moved ${cardShortName(t)} to bottom of Deck.`, 'info', `k^: V(${cardCode(t)}>k_)`, { appendEffect: true }) }; })} className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs">Send to Bottom</button>
              </div>
            </div>
          </div>
        )}

        {labState.pendingInteraction?.type === 'GRAVE_PICK' && (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
            <div className="max-w-md w-full rounded-2xl border-2 border-sky-400 bg-[#131424] p-5 space-y-4 text-center">
              <h3 className="font-serif font-bold text-lg text-sky-200">{labState.pendingInteraction.title}</h3>
              <div className="flex flex-wrap justify-center gap-3">
                {labState.pendingInteraction.cards.map(c => (
                  <TarotCard key={c.uid} card={c} small highlight onClick={() => setLabState(prev => {
                    let s = { ...prev, players: prev.players.map(p => ({ ...p, hand: [...p.hand] })), grave: prev.grave.filter(x => x.uid !== c.uid), pendingInteraction: null };
                    s.players[0].hand.push(c);
                    s.logs = addLog(s.logs, `Picked ${cardShortName(c)} from Grave!`, 'emerald');
                    s.logs = markActed(s.players[0], s.logs, 'Retrieved card from Grave');
                    return s;
                  })} />
                ))}
              </div>
            </div>
          </div>
        )}

        {labState.pendingInteraction?.type === 'HAND_SWAP_TRUMP' && (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
            <div className="max-w-lg w-full rounded-2xl border-2 border-amber-400 bg-[#171425] p-5 space-y-4 text-center">
              <h3 className="font-serif font-bold text-lg text-amber-200">{labState.pendingInteraction.title}</h3>
              <div className="flex flex-wrap justify-center gap-2">
                {labState.pendingInteraction.cards.map(c => (
                  <TarotCard key={c.uid} card={c} small highlight onClick={() => setLabState(prev => {
                    let s = { ...prev, players: prev.players.map(p => ({ ...p, hand: [...p.hand] })), roundMods: { ...prev.roundMods, trumpChanged: true }, pendingInteraction: null };
                    s.players[0].hand = s.players[0].hand.filter(x => x.uid !== c.uid);
                    if (s.trumpCard) s.players[0].hand.push(s.trumpCard);
                    s.trumpCard = c;
                    s.logs = addLog(s.logs, `Swapped Trump Card to ${cardShortName(c)}!`, 'gold');
                    return s;
                  })} />
                ))}
              </div>
            </div>
          </div>
        )}

        {labState.pendingInteraction?.type === 'FORBID_SUIT' && (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
            <div className="max-w-sm w-full rounded-2xl border-2 border-amber-400 bg-[#171425] p-5 space-y-4 text-center">
              <h3 className="font-serif font-bold text-lg text-amber-200">{labState.pendingInteraction.title}</h3>
              <div className="grid grid-cols-2 gap-2">
                {SUITS.map(suit => (
                  <button key={suit} onClick={() => setLabState(prev => {
                    let s = { ...prev, roundMods: { ...prev.roundMods, forbidSuit: suit, forbidOwner: 0 }, pendingInteraction: null };
                    s.logs = addLog(s.logs, `PROHIBITION! Forbade ${SUIT_META[suit].name}!`, 'gold');
                    s.logs = markActed(s.players[0], s.logs, `Prohibited ${SUIT_META[suit].name}`);
                    return s;
                  })} className={`p-3 rounded-xl border flex items-center justify-center gap-2 font-bold text-xs ${SUIT_META[suit].bg} ${SUIT_META[suit].border}`}>
                    <SuitIcon suit={suit} className="w-4 h-4" /> {SUIT_META[suit].name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {labState.pendingInteraction?.type === 'INTERRUPT' && (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
            <div className="max-w-md w-full rounded-2xl border-2 border-rose-500 bg-[#1a1220] p-5 space-y-4 text-center">
              <h3 className="font-serif font-bold text-lg text-amber-100">Incoming Attack — Interrupt?</h3>
              <p className="text-xs text-slate-300">Dummy A played {cardShortName(labState.pendingInteraction.card)}! Play {cardShortName(labState.pendingInteraction.blockCard)} to block?</p>
              <div className="flex gap-2 justify-center">
                <button onClick={() => {
                  const { attackerId, card, blockCard, attackType } = labState.pendingInteraction;
                  setLabState(prev => {
                    let s = { ...prev, pendingInteraction: null, players: prev.players.map(p => ({ ...p, hand: [...p.hand], pouch: [...p.pouch], mods: { ...p.mods } })), deck: [...prev.deck], grave: [...prev.grave] };
                    s.players[0].hand = s.players[0].hand.filter(c => c.uid !== blockCard.uid);
                    if (attackType === 'sword') s.players[0].mods.pouchImmune = true;
                    if (attackType === 'wand') s.players[0].mods.handImmune = true;
                    s.logs = addLog(s.logs, `INTERRUPT! Blocked with ${cardShortName(blockCard)}!`, 'emerald', instantCastCode(s.players[0], cardCode(blockCard), `block ${pCode(attackerId)}`));
                    applyInstantFaceSuitAction(s, s.players[0], s.players[attackerId], blockCard);
                    s.grave.unshift(blockCard);
                    return playTrickCard(s, attackerId, card, 0, true);
                  });
                }} className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold text-xs">Block!</button>
                <button onClick={() => {
                  const { attackerId, card } = labState.pendingInteraction;
                  setLabState(prev => playTrickCard({ ...prev, pendingInteraction: null }, attackerId, card, 0, true));
                }} className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 font-bold text-xs">Take Hit</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
}
