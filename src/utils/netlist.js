import { PATHWAYS } from '../data/constants.js';
import { cardCode, cardShortName, buildMajorCard } from './cards.js';

function pCode(id) {
  return `#${(id ?? 0) + 1}`;
}

function pzCode(p) {
  return `#${(p?.id ?? 0) + 1}z${p?.pathwayId ?? 0}`;
}

// Instant / interrupt wrapper — full cast lives inside [] :
//   ![#2: X11]  |  ![#2: X1 (#1, #2/B↔#1/B, g^>k_{X1})]  |  ![#2: z3q9 (+2)]
// Bag zone marker is /B (legacy /P still parsed). Hidden fog uses +H / +/H.
function instantCastCode(player, action, effects = null) {
  const seat = typeof player === 'number' ? pCode(player) : pCode(player?.id);
  if (effects) return `![${seat}: ${action} (${effects})]`;
  return `![${seat}: ${action}]`;
}

// Seq ability cast: #2: z3q9  |  copy cast: #2: z0q7=z8q8
function abilityCastCode(actor, target = null, { copy = false, targeted = false } = {}) {
  const base = `${pCode(actor.id)}: z${actor.pathwayId}q${actor.seq}`;
  if (copy && target) return `${base}=z${target.pathwayId}q${target.seq}`;
  if (targeted && target) return `${base}(${pCode(target.id)})`;
  return base;
}

// Digestion board-state token: {#1: q8$}
function digestionCode(player) {
  const seat = typeof player === 'number' ? pCode(player) : pCode(player?.id);
  return `{${seat}: q${player?.seq ?? 0}$}`;
}

// Board-state braces: g^>k_{X1}  |  k^{W8,X14>X14,W8}
function boardState(inner) {
  return `{${inner}}`;
}

// Fold a new effect/code into an existing action token (instants keep effects inside [])
function mergeActionCode(last, code) {
  if (!last) return code;
  if (!code) return last;
  // Instant: ![#2: X1] or ![#2: X1 (existing)]
  const instM = String(last).match(/^!\[(#\d+:\s*[^(\]]+?)(?:\s*\((.*)\))?\]\s*$/);
  if (instM) {
    const head = instM[1].trim();
    const existing = (instM[2] || '').trim();
    // Bare target (#2) upgraded by fuller #2: -W9
    let merged = code;
    if (existing) {
      const singleTgt = existing.match(/^(#\d+)$/);
      if (singleTgt && code.startsWith(singleTgt[1] + ':')) merged = code;
      else merged = `${existing}, ${code}`;
    }
    return `![${head} (${merged})]`;
  }
  // Digestion / board-state sibling tokens stay comma-separated on the same action line
  if (/^\{#\d+:\s*q\d+\$\}$/.test(code) || /^\{#\d+:\s*q\d+\$\}$/.test(last)) {
    return `${last}, ${code}`;
  }
  const singleTgtMatch = String(last).match(/\((#\d+)\)$/);
  if (singleTgtMatch && code.startsWith(singleTgtMatch[1] + ':')) {
    return last.slice(0, -singleTgtMatch[0].length) + `(${code})`;
  }
  if (String(last).endsWith(')')) {
    return `${last.slice(0, -1)}, ${code})`;
  }
  return `${last} (${code})`;
}

// Display-only fog of war: hide opponent private draws / bag tucks from viewer
// Hidden cards: +H (to Hand), +/H (to Bag). Legacy +? / +/?. still accepted by readers.
function fogPrivateOps(text) {
  return String(text || '')
    .replace(/(^|[(\s,])\+\/(?:[SWPC](?:10|[1-9]|[PNQK])|X\d+)/g, '$1+/H')
    .replace(/(^|[(\s,])\+(?!\/)(?:[SWPC](?:10|[1-9]|[PNQK])|X\d+)(?!g)/g, '$1+H');
}

function fogNetlistAction(action, viewerSeat = 1) {
  if (!action) return action;
  let out = String(action);
  // Fog opponent-seat actions: #2: ... (and higher)
  out = out.replace(/#(\d+):\s*([^#!]*)/g, (chunk, seat, body) => {
    if (parseInt(seat, 10) === viewerSeat) return chunk;
    return `#${seat}: ${fogPrivateOps(body)}`;
  });
  // Fog opponent instant casts ![#2: ...]
  out = out.replace(/!\[#(\d+):\s*([^\]]*)\]/g, (full, seat, inner) => {
    if (parseInt(seat, 10) === viewerSeat) return full;
    return `![#${seat}: ${fogPrivateOps(inner)}]`;
  });
  return out;
}

function fogNetlistText(netlist, viewerSeat = 1) {
  return String(netlist || '')
    .split(/\r?\n/)
    .map(line => {
      if (!line.trim()) return ''; // keep blank round-paragraph separators
      if (/^(G=|R\d+=|D\d+=|T\d+=|A\d+=)/.test(line.trim())) return line;
      // Preserve multi-action lines: fog each top-level action.
      // Opening deals (#2: +C8,+S4,…) use commas between cards — fog the whole seat line.
      const parts = splitTopLevelActions(line);
      if (parts.length <= 1) return fogNetlistAction(line, viewerSeat);
      const allSeated = parts.every(p => {
        const t = p.trim();
        return /^#\d+:/.test(t) || /^!\[#\d+:/.test(t) || /^\{#\d+:/.test(t);
      });
      if (!allSeated) return fogNetlistAction(line, viewerSeat);
      return parts.map(p => fogNetlistAction(p, viewerSeat)).join(',\n');
    })
    .join('\n');
}

/** Round key for a log/netlist phase header: 0 = Setup (G=; opening draws inherit via sticky walk), else R/D/T/A number */
function roundKeyFromHeader(headerOrCode) {
  const h = String(headerOrCode || '').trim();
  if (h.startsWith('G=')) return 0;
  const m = h.match(/^[RDTA](\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// Formats spent Bag cards for Ascension netlist, showing exact 1–9 wildcard value used by any 10 (e.g. -/P10=4)
function formatSpentPouchCodes(spentCards, targetSeq, mods = {}) {
  const fixedSum = spentCards.reduce((acc, c) => {
    const isWild = c.rank === 10 || (c.rank === 1 && mods.astronomerWild);
    return acc + (isWild ? 0 : (c.rank || 0));
  }, 0);
  const wildCards = spentCards.filter(c => c.rank === 10 || (c.rank === 1 && mods.astronomerWild));
  const wildAssign = new Map();
  if (wildCards.length > 0) {
    let rem = Math.max(wildCards.length, Math.min(wildCards.length * 9, targetSeq - fixedSum));
    wildCards.forEach((wc, idx) => {
      const left = wildCards.length - idx - 1;
      const val = Math.max(1, Math.min(9, rem - left));
      wildAssign.set(wc.uid, val);
      rem -= val;
    });
  }
  return spentCards.map(c => {
    const base = '-/' + cardCode(c);
    return wildAssign.has(c.uid) ? `${base}=${wildAssign.get(c.uid)}` : base;
  }).join(',');
}

// Parse a shorthand card code (P1, CK, S3, WQ, W10, X0..X21) back into a renderable TarotCard object
function parseCardCode(raw) {
  if (!raw) return null;
  const code = String(raw).trim().replace(/^(\+|\-|\+\/|\-\/)/, '').replace(/(g|s|=\d+)$/, '');
  if (!code || code === '—') return null;
  const majM = code.match(/^X(\d+)$/);
  if (majM) {
    const id = parseInt(majM[1], 10);
    if (PATHWAYS[id]) return { ...buildMajorCard(id), uid: `rep_X${id}_${Math.random().toString(36).slice(2, 7)}` };
  }
  const minM = code.match(/^([SWPC])(10|[1-9]|[PNQK])$/);
  if (minM) {
    const suitMap = { S: 'swords', W: 'wands', P: 'pentacles', C: 'cups' };
    const rankMap = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, P: 11, N: 12, Q: 13, K: 14 };
    const lblMap = { 1: 'A', 11: 'Page', 12: 'Knight', 13: 'Queen', 14: 'King' };
    const suit = suitMap[minM[1]];
    const rank = rankMap[minM[2]];
    return {
      uid: `rep_${code}_${Math.random().toString(36).slice(2, 7)}`,
      type: 'minor',
      suit,
      rank,
      label: lblMap[rank] || String(rank)
    };
  }
  return null;
}

function splitTopLevelActions(line) {
  const cleaned = line.replace(/\s*\|\s*/g, ', ');
  const parts = [];
  let cur = '', depth = 0;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    // Track (), [], and {} so commas inside board-state / effect braces stay intact
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// Reconstructs step-by-step visual board frames from ANY Shorthand Netlist
function parseNetlistToFrames(rawText) {
  const lines = String(rawText || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const frames = [];
  let state = {
    round: 0,
    phase: 'SETUP',
    phaseHeader: '',
    players: [],
    centerDraft: [],
    trumpCard: null,
    trickPlays: [],
    grave: [],
    deckTop: [],
    banner: '',
    winnerId: null
  };

  const cloneState = () => ({
    ...state,
    players: state.players.map(p => ({ ...p, hand: [...p.hand], pouch: [...p.pouch] })),
    centerDraft: [...state.centerDraft],
    trickPlays: [...state.trickPlays],
    grave: [...state.grave],
    deckTop: [...(state.deckTop || [])]
  });

  const pushFrame = (token, desc) => {
    frames.push({
      token,
      desc,
      roundKey: state.round,
      roundLabel: state.round === 0 ? 'Setup' : `Round ${state.round}`,
      phase: state.phase,
      state: cloneState()
    });
  };

  const ensurePlayer = (seatNum, pathwayId = 0) => {
    const id = seatNum - 1;
    while (state.players.length <= id) {
      const idx = state.players.length;
      state.players.push({
        id: idx,
        name: idx === 0 ? 'You (#1)' : `Player #${idx + 1}`,
        pathwayId: idx === id ? pathwayId : idx % 22,
        seq: 9,
        digested: false,
        inactive: false,
        hand: [],
        pouch: []
      });
    }
    if (pathwayId !== null && pathwayId !== undefined) state.players[id].pathwayId = pathwayId;
    return state.players[id];
  };

  const addUniqueCard = (arr, code) => {
    const c = parseCardCode(code);
    if (!c) return null;
    arr.push(c);
    return c;
  };
  const removeCardByCode = (arr, code) => {
    const norm = String(code).replace(/^(\+|\-|\+\/|\-\/)/, '').replace(/(g|s|=\d+)$/, '');
    const idx = arr.findIndex(c => cardCode(c) === norm);
    if (idx !== -1) return arr.splice(idx, 1)[0];
    return null;
  };

  const applyEffectString = (effStr, defaultSeat) => {
    if (!effStr) return;
    const items = splitTopLevelActions(effStr);
    let curSeat = defaultSeat;
    for (const rawItem of items) {
      let item = rawItem.trim();
      // Strip wrapping parentheses sometimes left on tokens: (T=C5)
      if (item.startsWith('(') && item.endsWith(')')) item = item.slice(1, -1).trim();

      const seatPrefix = item.match(/^#(\d+):\s*(.*)$/);
      if (seatPrefix) {
        curSeat = parseInt(seatPrefix[1], 10);
        item = seatPrefix[2].trim();
      }
      const pl = curSeat ? ensurePlayer(curSeat, null) : null;

      // Deck reorder: k^{S6,S10>S10,S6}
      const deckReorder = item.match(/^k\^\{([^}>]+)>([^}]+)\}$/);
      if (deckReorder) {
        state.deckTop = deckReorder[2].split(',').map(x => parseCardCode(x.trim())).filter(Boolean);
        state.banner = `Deck top reordered: ${deckReorder[2]}`;
        continue;
      }
      // Deck peek / bottom move: k^: V(S6) | k^: V(S6>k_) | k_: V(...)
      const deckPeek = item.match(/^k[_^]:\s*V\(([^)]+)\)$/);
      if (deckPeek) {
        const inner = deckPeek[1];
        const bottomMove = inner.match(/^([SWPC](?:10|[1-9]|[PNQK])|X\d+)>k_$/);
        if (bottomMove) {
          state.deckTop = (state.deckTop || []).filter(c => cardCode(c) !== bottomMove[1]);
        } else {
          state.deckTop = inner.split(',').map(x => parseCardCode(x.trim())).filter(Boolean);
        }
        continue;
      }
      // Grave recycle to deck bottom: g^>k_{X1,W8}
      const recycle = item.match(/^g\^>k_\{([^}]+)\}$/);
      if (recycle) {
        for (const code of recycle[1].split(',').map(x => x.trim()).filter(Boolean)) {
          removeCardByCode(state.grave, code);
        }
        continue;
      }
      // Trump set: T=C5
      const tSwap = item.match(/^T=([SWPC](?:10|[1-9]|[PNQK])|X\d+)$/);
      if (tSwap) {
        state.trumpCard = parseCardCode(tSwap[1]);
        continue;
      }
      // Bag swap with card ids: #1/B(S7)↔#2/B(C3) (legacy /P accepted)
      const pouchSwap = item.match(/^#(\d+)\/[BP]\(([SWPC](?:10|[1-9]|[PNQK])|X\d+)\)↔#(\d+)\/[BP]\(([SWPC](?:10|[1-9]|[PNQK])|X\d+)\)$/);
      if (pouchSwap) {
        const a = ensurePlayer(parseInt(pouchSwap[1], 10), null);
        const b = ensurePlayer(parseInt(pouchSwap[3], 10), null);
        const aCard = removeCardByCode(a.pouch, pouchSwap[2]) || parseCardCode(pouchSwap[2]);
        const bCard = removeCardByCode(b.pouch, pouchSwap[4]) || parseCardCode(pouchSwap[4]);
        if (bCard) a.pouch.push(bCard);
        if (aCard) b.pouch.push(aCard);
        continue;
      }
      // Legacy bag swap without cards: #1/B↔#2/B or #1/P↔#2/P
      const pouchSwapBare = item.match(/^#(\d+)\/[BP]↔#(\d+)\/[BP]$/);
      if (pouchSwapBare) continue;
      // Hand exchange with cards: #1↔#2 H(S7↔C3)
      const handSwap2 = item.match(/^#(\d+)↔#(\d+)\s*H\(([SWPC](?:10|[1-9]|[PNQK])|X\d+)↔([SWPC](?:10|[1-9]|[PNQK])|X\d+)\)$/);
      if (handSwap2) {
        const a = ensurePlayer(parseInt(handSwap2[1], 10), null);
        const b = ensurePlayer(parseInt(handSwap2[2], 10), null);
        const codeA = handSwap2[3].trim();
        const codeB = handSwap2[4].trim();
        const aCard = removeCardByCode(a.hand, codeA) || parseCardCode(codeA);
        const bCard = removeCardByCode(b.hand, codeB) || parseCardCode(codeB);
        if (bCard) a.hand.push(bCard);
        if (aCard) b.hand.push(aCard);
        continue;
      }
      // Justice transfer: #2>#3(W7)
      const give = item.match(/^#(\d+)>#(\d+)\(([SWPC](?:10|[1-9]|[PNQK])|X\d+)\)$/);
      if (give) {
        const rich = ensurePlayer(parseInt(give[1], 10), null);
        const poor = ensurePlayer(parseInt(give[2], 10), null);
        const c = removeCardByCode(rich.hand, give[3]) || parseCardCode(give[3]);
        if (c) poor.hand.push(c);
        continue;
      }
      // Judgement return pouch→hand: -/S7>+S7
      const retPH = item.match(/^\-\/([SWPC](?:10|[1-9]|[PNQK])|X\d+)>\+([SWPC](?:10|[1-9]|[PNQK])|X\d+)$/);
      if (retPH && pl) {
        const rem = removeCardByCode(pl.pouch, retPH[1]) || parseCardCode(retPH[1]);
        if (rem) pl.hand.push(rem);
        continue;
      }
      // Paper Figurine bag↔hand: /B↔H(S7↔C3) (legacy /P↔H)
      const fig = item.match(/^\/[BP]↔H\(([SWPC](?:10|[1-9]|[PNQK])|X\d+)↔([SWPC](?:10|[1-9]|[PNQK])|X\d+)\)$/);
      if (fig && pl) {
        const fromP = removeCardByCode(pl.pouch, fig[1]) || parseCardCode(fig[1]);
        const fromH = removeCardByCode(pl.hand, fig[2]) || parseCardCode(fig[2]);
        if (fromH) pl.pouch.push(fromH);
        if (fromP) pl.hand.push(fromP);
        continue;
      }
      // Deterministic moon pouch rewrite: /~(S7,C2)
      const moonAssign = item.match(/^\/~\(([^\)]*)\)$/);
      if (moonAssign && pl) {
        pl.pouch = moonAssign[1].split(',').map(x => parseCardCode(x.trim())).filter(Boolean);
        continue;
      }
      // Mental break marker
      if (item === 'MB()' || item === 'figurine') {
        if (pl && item === 'MB()') pl.inactive = true;
        continue;
      }
      // Symbolic modifiers — no card movement
      if (/^(rotL|all \+1|all \-\/[BP]|opps \-\/[BP]>\+H|inv|noT|immAll|noSuit|WAR|reboot|imm|\+3|\+\/[BP]|T=S|!forbid\([^)]+\))$/.test(item)) {
        continue;
      }
      // Bare pouch shuffle marker without assignment
      if (item === '/~') continue;

      // Deck/grave peek swap: k^S6↔g_C3
      const kgSwap = item.match(/^k\^([SWPC](?:10|[1-9]|[PNQK])|X\d+)↔g_([SWPC](?:10|[1-9]|[PNQK])|X\d+)$/);
      if (kgSwap) {
        removeCardByCode(state.grave, kgSwap[2]);
        addUniqueCard(state.grave, kgSwap[1]);
        state.deckTop = [parseCardCode(kgSwap[2])].filter(Boolean);
        continue;
      }
      // Card sent to deck bottom: S6>k_
      const toBottom = item.match(/^([SWPC](?:10|[1-9]|[PNQK])|X\d+)>k_$/);
      if (toBottom) {
        state.deckTop = (state.deckTop || []).filter(c => cardCode(c) !== toBottom[1]);
        continue;
      }

      // Match individual card ops inside item (+S6, +X2g, -W7s, -/P10=4, -/Cs pouch-steal, +/C4)
      const ops = item.match(/(\+\/|\-\/|\+|\-)([SWPC](?:10|[1-9]|[PNQK])|X\d+)(g|s|=\d+)?/g) || [];
      for (const op of ops) {
        const m = op.match(/^(\+\/|\-\/|\+|\-)([SWPC](?:10|[1-9]|[PNQK])|X\d+)(g|s|=\d+)?$/);
        if (!m || !pl) continue;
        const [, sign, code, suf] = m;
        if (sign === '+/') {
          removeCardByCode(pl.hand, code);
          addUniqueCard(pl.pouch, code);
        } else if (sign === '-/') {
          const rem = removeCardByCode(pl.pouch, code) || parseCardCode(code);
          if (suf === 's' && defaultSeat) {
            const thief = ensurePlayer(defaultSeat, null);
            if (rem) thief.hand.push(rem);
          } else if (rem) {
            state.grave.unshift(rem);
          }
        } else if (sign === '+') {
          if (suf === 'g') removeCardByCode(state.grave, code);
          addUniqueCard(pl.hand, code);
        } else if (sign === '-') {
          const rem = removeCardByCode(pl.hand, code) || parseCardCode(code);
          if (suf === 's' && defaultSeat && defaultSeat !== curSeat) {
            const thief = ensurePlayer(defaultSeat, null);
            if (rem) thief.hand.push(rem);
          } else if (rem) {
            state.grave.unshift(rem);
          }
        }
      }
    }
  };

  for (const line of lines) {
    // 1. Game Start Header: G= #1: z0, #2: z1, #3: z3;
    if (line.startsWith('G=')) {
      const matches = [...line.matchAll(/#(\d+):\s*z(\d+)/g)];
      for (const m of matches) ensurePlayer(parseInt(m[1], 10), parseInt(m[2], 10));
      state.phase = 'SETUP';
      state.phaseHeader = line;
      state.banner = `Match Initialized (${state.players.length} Players — Full 78-Card Deck)`;
      pushFrame(line, state.banner);
      continue;
    }

    // 2. Phase Headers: R{n}=, D{n}=, T{n}=, A{n}=
    const rM = line.match(/^R(\d+)=(?:\s*\(([^)]*)\))?$/);
    if (rM) {
      state.round = parseInt(rM[1], 10);
      state.phase = 'POUCH';
      state.phaseHeader = line;
      state.trickPlays = [];
      state.centerDraft = [];
      state.players.forEach(p => { p.inactive = false; });
      if (rM[2]) {
        for (const im of rM[2].matchAll(/#(\d+)x/g)) {
          const pl = ensurePlayer(parseInt(im[1], 10), null);
          pl.inactive = true;
        }
      }
      state.banner = `Round ${state.round} — Phase 1: Pouch Management`;
      pushFrame(line, state.banner);
      continue;
    }

    const dM = line.match(/^D(\d+)=\s*(.*)$/);
    if (dM) {
      state.round = parseInt(dM[1], 10);
      state.phase = 'DRAFT';
      state.phaseHeader = line;
      state.centerDraft = dM[2].split(',').map(x => parseCardCode(x.trim())).filter(Boolean);
      state.banner = `Round ${state.round} — Draft Reveal (${dM[2]})`;
      pushFrame(line, state.banner);
      continue;
    }

    const tM = line.match(/^T(\d+)=\s*(.*)$/);
    if (tM) {
      state.round = parseInt(tM[1], 10);
      state.phase = 'TRICK';
      state.phaseHeader = line;
      state.centerDraft = [];
      state.trickPlays = [];
      state.trumpCard = parseCardCode(tM[2].trim());
      state.banner = `Round ${state.round} — Trick Phase (Trump: ${state.trumpCard ? cardShortName(state.trumpCard) : tM[2]})`;
      pushFrame(line, state.banner);
      continue;
    }

    const aM = line.match(/^A(\d+)=$/);
    if (aM) {
      state.round = parseInt(aM[1], 10);
      state.phase = 'ASCEND';
      state.phaseHeader = line;
      state.banner = `Round ${state.round} — Phase 3: Ascension`;
      pushFrame(line, state.banner);
      continue;
    }

    // 3a. Opening deal (Setup): keep whole line — commas are card separators, not action separators
    //   #1: +S7,+W3,+C2,+P5,+W9,+S2,+C10
    const openLineM = line.match(/^#(\d+):\s*((?:\+(?:[SWPC](?:10|[1-9]|[PNQK])|X\d+|H))(?:,\+(?:[SWPC](?:10|[1-9]|[PNQK])|X\d+|H))+)$/);
    if (openLineM && state.round === 0) {
      const seat = parseInt(openLineM[1], 10);
      const pl = ensurePlayer(seat, null);
      applyEffectString(openLineM[2], seat);
      const n = openLineM[2].split(',').length;
      state.banner = `${pl.name} opening hand (${n} cards)`;
      pushFrame(line, state.banner);
      continue;
    }

    // 3. Action Line (comma-separated tokens)
    const tokens = splitTopLevelActions(line);
    for (const tok of tokens) {
      let desc = tok;
      // Round end A1&
      if (/^A\d+&$/.test(tok)) {
        state.banner = `Round ${state.round} Complete`;
        desc = state.banner;
        pushFrame(tok, desc);
        continue;
      }
      // Trick end T1& #1: ?0 (+C5) or ?P (...)
      const teM = tok.match(/^T(\d+)&\s*#(\d+):\s*(\?[^\s(]+)(?:\s*\((.*)\))?$/);
      if (teM) {
        const wSeat = parseInt(teM[2], 10);
        const wPl = ensurePlayer(wSeat, null);
        if (teM[4]) applyEffectString(teM[4], wSeat);
        for (const tp of state.trickPlays) state.grave.unshift(tp.card);
        state.trickPlays = [];
        state.trumpCard = null;
        state.banner = `Trick Winner: ${wPl.name} (${teM[3]})`;
        desc = state.banner;
        pushFrame(tok, desc);
        continue;
      }
      // Instant / interrupt: ![#2: X19] or ![#2: X1 (#1, #2/P↔#1/P, g^>k_{X1})]
      const instM = tok.match(/^!\[#(\d+):\s*([^\]]+)\]$/);
      if (instM) {
        const seat = parseInt(instM[1], 10);
        let inner = instM[2].trim();
        const pl = ensurePlayer(seat, null);
        let effects = null;
        const effSplit = inner.match(/^([^(]+?)\s*\((.*)\)\s*$/);
        if (effSplit) {
          inner = effSplit[1].trim();
          effects = effSplit[2];
          applyEffectString(effects, seat);
        }
        const abM = inner.match(/^z(\d+)q(\d+)(?:=z(\d+)q(\d+))?$/);
        const chM = inner.match(/^X(\d+)$/);
        const cardM = inner.match(/^([SWPC](?:10|[1-9]|[PNQK]))$/);
        if (abM) {
          const zId = parseInt(abM[1], 10);
          const sq = parseInt(abM[2], 10);
          pl.pathwayId = zId;
          const sName = PATHWAYS[zId]?.seqs?.[sq]?.name || `Seq ${sq}`;
          state.banner = abM[3]
            ? `${pl.name} instant-copied z${abM[3]}q${abM[4]} via Seq ${sq} ${sName}`
            : `${pl.name} instant-cast Seq ${sq} ${sName}`;
        } else if (chM) {
          const cid = parseInt(chM[1], 10);
          state.banner = `${pl.name} instant-cast Chaos Event ${PATHWAYS[cid]?.arcana || 'X' + cid}`;
        } else if (cardM) {
          const c = parseCardCode(cardM[1]);
          state.banner = `${pl.name} instant-cast ${c ? cardShortName(c) : cardM[1]}`;
        } else {
          state.banner = `${pl.name} Instant: ${inner}`;
        }
        desc = state.banner;
        pushFrame(tok, desc);
        continue;
      }
      // Digestion board-state: {#1: q8$}
      const digTok = tok.match(/^\{#(\d+):\s*q(\d+)\$\}$/);
      if (digTok) {
        const pl = ensurePlayer(parseInt(digTok[1], 10), null);
        pl.digested = true;
        state.banner = `${pl.name} digested Sequence ${digTok[2]}!`;
        desc = state.banner;
        pushFrame(tok, desc);
        continue;
      }
      // Legacy interrupt / Ability / Chaos: < #1z0:!q9 (...) or < #1z0:!X3 (...)
      const intM = tok.match(/^<\s*#(\d+)z(\d+):([^\s(]+)(?:\s*\((.*)\))?$/);
      if (intM) {
        const seat = parseInt(intM[1], 10);
        const zId = parseInt(intM[2], 10);
        const pl = ensurePlayer(seat, zId);
        const act = intM[3];
        if (intM[4]) applyEffectString(intM[4], seat);
        const abM = act.match(/^!q(\d+)$/);
        const chM = act.match(/^!X(\d+)$/);
        if (abM) {
          const sq = parseInt(abM[1], 10);
          const sName = PATHWAYS[zId]?.seqs?.[sq]?.name || `Seq ${sq}`;
          state.banner = `${pl.name} activated Seq ${sq} ${sName}`;
        } else if (chM) {
          const cid = parseInt(chM[1], 10);
          state.banner = `${pl.name} invoked Chaos Event ${PATHWAYS[cid]?.arcana || 'X' + cid}`;
        } else {
          state.banner = `${pl.name} Interrupt: ${act}`;
        }
        desc = state.banner;
        pushFrame(tok, desc);
        continue;
      }
      // Inactive player recovery: #2x (+C1,+C2)
      const inactM = tok.match(/^#(\d+)x(?:\s*\((.*)\))?$/);
      if (inactM) {
        const seat = parseInt(inactM[1], 10);
        const pl = ensurePlayer(seat, null);
        pl.inactive = true;
        if (inactM[2]) applyEffectString(inactM[2], seat);
        state.banner = `${pl.name} Mental Break — inactive this round`;
        desc = state.banner;
        pushFrame(tok, desc);
        continue;
      }
      // Standard player action: #1: ...
      const pM = tok.match(/^#(\d+):\s*(.*)$/);
      if (pM) {
        const seat = parseInt(pM[1], 10);
        const pl = ensurePlayer(seat, null);
        const body = pM[2].trim();
        // Digestion: q8$ (preferred) | legacy {q8$} / {q8} / q8>
        const digM = body.match(/^q(\d+)\$$/) || body.match(/^\{q(\d+)\$$\}/) || body.match(/^\{q(\d+)\}$/) || body.match(/^q(\d+)>$/);
        if (digM) {
          pl.digested = true;
          state.banner = `${pl.name} digested Sequence ${digM[1]}!`;
          desc = state.banner;
          pushFrame(tok, desc);
          continue;
        }
        // Seq ability: z3q9 / copy cast z0q7=z8q8
        const abCastM = body.match(/^z(\d+)q(\d+)(?:=z(\d+)q(\d+))?(?:\((#\d+)\))?(?:\s*\((.*)\))?$/);
        if (abCastM) {
          const zId = parseInt(abCastM[1], 10);
          const sq = parseInt(abCastM[2], 10);
          pl.pathwayId = zId;
          pl.seq = sq;
          if (abCastM[6]) applyEffectString(abCastM[6], seat);
          const sName = PATHWAYS[zId]?.seqs?.[sq]?.name || `Seq ${sq}`;
          state.banner = abCastM[3]
            ? `${pl.name} copied z${abCastM[3]}q${abCastM[4]} via Seq ${sq} ${sName}`
            : `${pl.name} activated Seq ${sq} ${sName}`;
          desc = state.banner;
          pushFrame(tok, desc);
          continue;
        }
        // Ascension @q8 (...) or @q8* (...) or @q0 (WIN)
        const ascM = body.match(/^@q(\d+)(\*?)(?:\s*\((.*)\))?$/);
        if (ascM) {
          const newSeq = parseInt(ascM[1], 10);
          const reckless = ascM[2] === '*';
          pl.seq = newSeq;
          pl.digested = false;
          if (ascM[3]) applyEffectString(ascM[3], seat);
          if (newSeq === 0) {
            state.winnerId = pl.id;
            state.banner = `APOTHEOSIS! ${pl.name} reached Sequence 0 and WON!`;
          } else {
            state.banner = `${pl.name} ${reckless ? 'recklessly ' : ''}ascended to Sequence ${newSeq}`;
          }
          desc = state.banner;
          pushFrame(tok, desc);
          continue;
        }
        // Draft D+C
        const drM = body.match(/^D\+([SWPC](?:10|[1-9]|[PNQK])|X\d+)$/);
        if (drM) {
          removeCardByCode(state.centerDraft, drM[1]);
          const c = addUniqueCard(pl.hand, drM[1]);
          state.banner = `${pl.name} drafted ${c ? cardShortName(c) : drM[1]}`;
          desc = state.banner;
          pushFrame(tok, desc);
          continue;
        }
        // Opening deal / multi-card hand draw: +S7,+W3,+C2 (Setup, before R1=)
        const openDealM = body.match(/^(\+(?:[SWPC](?:10|[1-9]|[PNQK])|X\d+|H)(?:,\+(?:[SWPC](?:10|[1-9]|[PNQK])|X\d+|H))+)$/);
        if (openDealM || (/^\+(?:[SWPC](?:10|[1-9]|[PNQK])|X\d+|H)$/.test(body) && state.phase === 'SETUP' && state.round === 0)) {
          applyEffectString(body, seat);
          const n = body.split(',').length;
          state.banner = `${pl.name} opening hand (${n} card${n === 1 ? '' : 's'})`;
          desc = state.banner;
          pushFrame(tok, desc);
          continue;
        }
        // Pouch add/discard +/C or -/C
        if (/^(\+\/|\-\/)/.test(body)) {
          applyEffectString(body, seat);
          state.banner = `${pl.name} Pouch: ${body}`;
          desc = state.banner;
          pushFrame(tok, desc);
          continue;
        }
        // Trick card play: W6(+3=9) (#2: -S6) or P3 (+S6) or X4 (legacy T-X4 accepted)
        const trM = body.match(/^(?:T-)?([SWPC](?:10|[1-9]|[PNQK])|X\d+)(\([+-]\d+=\d+\))?(?:\s*\((.*)\))?$/);
        if (trM) {
          const playedCard = removeCardByCode(pl.hand, trM[1]) || parseCardCode(trM[1]);
          if (playedCard) state.trickPlays.push({ playerId: pl.id, card: playedCard, tvTag: trM[2] || '' });
          if (trM[3]) applyEffectString(trM[3], seat);
          state.banner = `${pl.name} played ${playedCard ? cardShortName(playedCard) : trM[1]}${trM[2] || ''}`;
          desc = state.banner;
          pushFrame(tok, desc);
          continue;
        }
        // Generic effect token
        applyEffectString(body, seat);
        state.banner = `${pl.name}: ${body}`;
        desc = state.banner;
        pushFrame(tok, desc);
      }
    }
  }
  return frames;
}

const SAMPLE_REPLAY_NETLIST = `G= #1: z0, #2: z1, #3: z3;

#1: +S7,+W3,+C2,+P5,+W9,+S2,+C10
#2: +C8,+S4,+W5,+P2,+C6,+S9,+W8
#3: +P9,+C3,+S6,+W4,+P7,+C5,+S1

R1=
#2: +/S8,
#3: +/C7,
#1: +/S7
D1= W9, P7, S3, C5
#1: D+W9,
#2: D+P7,
#3: D+S3
T1= C5
#1: z0q9 (k^{S6,S10>S10,S6}),
#1: P3 (+S10),
#2: WK (#1: V(W7,S6), #1: -W7s, #1: -S6),
#3: C4 (+X2g),
T1& #1: ?0 (+C5)
A1=
#2: @q8 (-/S8,-/P10=1, +S2),
A1&

R2=
#1: +/C2,
#3: +/S2
D2= P4, S5, W8, C9
#1: D+P4,
#3: D+S5,
#2: D+W8
T2= C9
#1: z0q7 (+3),
#1: W6(+3=9) (#2: -W8),
#3: S5 (#1: -/S7),
#2: P7 (+C3), {#1: q9$},
T2& #1: ?0 (+C9)
A2=
#1: @q8 (-/C2,-/P10=7, +S9),
A2&`;

export {
  pCode,
  pzCode,
  instantCastCode,
  abilityCastCode,
  digestionCode,
  boardState,
  mergeActionCode,
  fogPrivateOps,
  fogNetlistAction,
  fogNetlistText,
  formatSpentPouchCodes,
  parseCardCode,
  splitTopLevelActions,
  parseNetlistToFrames,
  roundKeyFromHeader,
  SAMPLE_REPLAY_NETLIST
};
