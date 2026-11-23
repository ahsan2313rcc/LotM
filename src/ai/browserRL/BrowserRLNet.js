/**
 * Browser-trainable RL nets: Small (16→8), Medium (40→20), Large (100→40).
 *
 * Training idea:
 *  - Visit a fogged state → explore ALL legal actions across visits (memory).
 *  - Against a fixed opponent (usually heuristic D6), keep the action with best return.
 *  - Frozen champion ("self image") is used at play/eval; promoted when memory finds a better move
 *    or when validation win-rate improves.
 *  - Dense rewards: +ascendReward on own ascend, −ascendReward on opponent ascend.
 */
import {
  TIER_DIMS,
  extractObs,
  encodeAction,
  hashState,
  actionKey,
  memoryActionKey,
  cardUidId
} from './featuresRL.js';
import { findValidAscensionSubset } from '../../utils/rules.js';
import {
  scoreDraftCard,
  scoreTrickCard,
  scoreTuckCard,
  pickBestByScore
} from './heuristicScore.js';

function randMat(rows, cols, scale) {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => (Math.random() * 2 - 1) * scale)
  );
}

function cloneMat(m) {
  return m.map(r => r.slice());
}

/** No hard RAM ceiling — memory grows with training. */
export const MEMORY_RAM_CAP = Infinity;
/** Prefer keeping all states on serialize; localStorage may still split/compact on quota. */
export const MEMORY_PERSIST_CAP = Infinity;

export function isBrowserRLNet(net) {
  return !!(net && net.kind === 'browser_rl_v1');
}

export function makeBrowserRLNet(tier = 'small', saved = null) {
  return new BrowserRLNet(tier, saved);
}

function compactEntry(mem) {
  if (!mem) return null;
  const explored = mem.explored || {};
  const top = Object.entries(explored)
    .sort((a, b) => (b[1]?.n || 0) - (a[1]?.n || 0) || (b[1]?.return || 0) - (a[1]?.return || 0))
    .slice(0, 12);
  return {
    bestKey: mem.bestKey || null,
    bestReturn: Number.isFinite(mem.bestReturn) ? mem.bestReturn : -Infinity,
    explored: Object.fromEntries(top)
  };
}

function entryVisits(mem) {
  if (!mem?.explored) return 0;
  let n = 0;
  for (const v of Object.values(mem.explored)) n += v?.n || 0;
  return n;
}

export class BrowserRLNet {
  constructor(tier = 'small', saved = null) {
    const t = tier === 'large' || tier === 'medium' ? tier : 'small';
    const dims = TIER_DIMS[t];
    this.kind = 'browser_rl_v1';
    this.tier = t;
    this.inSize = dims.inSize;
    this.hidSize = dims.hidSize;
    this.outSize = dims.outSize;
    this.obsDim = this.inSize;
    this.actDim = this.outSize;
    this.lr = t === 'large' ? 0.12 : t === 'medium' ? 0.2 : 0.35;
    this.epsilon = 0.12;
    this.ascendReward = 0.08;
    this.gamesTrained = saved?.gamesTrained || 0;
    this.updatesCount = saved?.updatesCount || 0;
    this.championWinRate = saved?.championWinRate || 0;
    this.bestValRate = saved?.bestValRate || 0;
    this.lifetimeWins = saved?.lifetimeWins || 0;
    this.lifetimeLosses = saved?.lifetimeLosses || 0;
    this.lifetimeDraws = saved?.lifetimeDraws || 0;
    this.lifetimeRoundSum = saved?.lifetimeRoundSum || 0;
    this.memorySize = 0;
    this.rewardBaseline = saved?.rewardBaseline || 0;
    this.lastWeightDelta = 0;

    const ok =
      saved &&
      saved.kind === 'browser_rl_v1' &&
      saved.tier === t &&
      Array.isArray(saved.w1) &&
      saved.w1.length === this.hidSize &&
      Array.isArray(saved.w2) &&
      saved.w2.length === this.outSize;

    if (ok) {
      this.w1 = cloneMat(saved.w1);
      this.b1 = saved.b1.slice();
      this.w2 = cloneMat(saved.w2);
      this.b2 = saved.b2.slice();
    } else {
      this.w1 = randMat(this.hidSize, this.inSize, 0.3);
      this.b1 = new Array(this.hidSize).fill(0);
      this.w2 = randMat(this.outSize, this.hidSize, 0.3);
      this.b2 = new Array(this.outSize).fill(0);
      if (t === 'small') this.b2 = [0, 0.2, 0.15, 0.25, 0.4, -0.2, 0.35, -0.3];
    }

    // State → { explored: {actionKey: {return, n}}, bestKey, bestReturn }
    this.memory = new Map();
    this._loadMemoryArray(saved?.memory);
    if (saved?.memoryExtra && Array.isArray(saved.memoryExtra)) this._loadMemoryArray(saved.memoryExtra);

    this.championSnapshot = this.serialize({ includeMemory: false });
    if (saved?.championSnapshot) this.championSnapshot = saved.championSnapshot;
    if (saved?.bestValSnapshot) this.bestValSnapshot = saved.bestValSnapshot;
  }

  _loadMemoryArray(arr) {
    if (!arr || !Array.isArray(arr)) return;
    for (const row of arr) {
      if (!row) continue;
      const k = Array.isArray(row) ? row[0] : row.key;
      const v = Array.isArray(row) ? row[1] : row.value;
      if (k == null || !v) continue;
      const prev = this.memory.get(k);
      if (!prev) {
        this.memory.set(k, {
          bestKey: v.bestKey || null,
          bestReturn: Number.isFinite(v.bestReturn) ? v.bestReturn : -Infinity,
          explored: { ...(v.explored || {}) }
        });
      } else {
        // Merge when loading split weight/memory blobs
        for (const [ak, av] of Object.entries(v.explored || {})) {
          const old = prev.explored[ak];
          if (!old || (av?.n || 0) >= (old.n || 0)) prev.explored[ak] = av;
        }
        if ((v.bestReturn || -Infinity) > (prev.bestReturn || -Infinity)) {
          prev.bestReturn = v.bestReturn;
          prev.bestKey = v.bestKey;
        }
      }
    }
    this.memorySize = this.memory.size;
  }

  /** Prefer high-visit / high-return states when an optional limit is set (quota fallback). */
  _rankedMemoryEntries(limit = Infinity) {
    const entries = Array.from(this.memory.entries());
    if (Number.isFinite(limit) && limit < entries.length) {
      entries.sort((a, b) => {
        const va = entryVisits(a[1]);
        const vb = entryVisits(b[1]);
        if (vb !== va) return vb - va;
        return (b[1]?.bestReturn || -Infinity) - (a[1]?.bestReturn || -Infinity);
      });
      return entries.slice(0, Math.max(0, limit)).map(([k, v]) => [k, compactEntry(v)]);
    }
    return entries.map(([k, v]) => [k, compactEntry(v)]);
  }

  serialize({ includeMemory = true, memoryLimit = Infinity } = {}) {
    const snap = {
      kind: 'browser_rl_v1',
      format: 'browser_rl_v1',
      tier: this.tier,
      inSize: this.inSize,
      hidSize: this.hidSize,
      outSize: this.outSize,
      obsDim: this.inSize,
      actDim: this.outSize,
      w1: cloneMat(this.w1),
      b1: this.b1.slice(),
      w2: cloneMat(this.w2),
      b2: this.b2.slice(),
      gamesTrained: this.gamesTrained,
      updatesCount: this.updatesCount,
      championWinRate: this.championWinRate,
      bestValRate: this.bestValRate || 0,
      lifetimeWins: this.lifetimeWins || 0,
      lifetimeLosses: this.lifetimeLosses || 0,
      lifetimeDraws: this.lifetimeDraws || 0,
      lifetimeRoundSum: this.lifetimeRoundSum || 0,
      rewardBaseline: this.rewardBaseline || 0,
      ascendReward: this.ascendReward,
      championSnapshot: this.championSnapshot
        ? { ...this.championSnapshot, memory: undefined, memoryExtra: undefined }
        : null,
      bestValSnapshot: this.bestValSnapshot
        ? { ...this.bestValSnapshot, memory: undefined, memoryExtra: undefined }
        : null
    };
    snap.memorySize = this.memory.size;
    if (includeMemory) {
      snap.memory = this._rankedMemoryEntries(memoryLimit);
    }
    return snap;
  }

  /** Weights-only + tiny meta (for localStorage when quota is tight). */
  serializeWeightsOnly() {
    return this.serialize({ includeMemory: false });
  }

  loadSnapshot(snap, { restoreMemory = false } = {}) {
    if (!snap || snap.tier !== this.tier || !snap.w2) return;
    this.w1 = cloneMat(snap.w1);
    this.b1 = snap.b1.slice();
    this.w2 = cloneMat(snap.w2);
    this.b2 = snap.b2.slice();
    if (snap.gamesTrained != null) this.gamesTrained = snap.gamesTrained;
    if (snap.updatesCount != null) this.updatesCount = snap.updatesCount;
    if (snap.championWinRate != null) this.championWinRate = snap.championWinRate;
    if (snap.bestValRate != null) this.bestValRate = snap.bestValRate;
    if (snap.lifetimeWins != null) this.lifetimeWins = snap.lifetimeWins;
    if (snap.lifetimeLosses != null) this.lifetimeLosses = snap.lifetimeLosses;
    if (snap.lifetimeDraws != null) this.lifetimeDraws = snap.lifetimeDraws;
    if (snap.lifetimeRoundSum != null) this.lifetimeRoundSum = snap.lifetimeRoundSum;
    if (snap.rewardBaseline != null) this.rewardBaseline = snap.rewardBaseline;
    if (restoreMemory && snap.memory) {
      this.memory = new Map();
      this._loadMemoryArray(snap.memory);
    }
  }

  recordMatchOutcome({ win = false, loss = false, draw = false, rounds = null } = {}) {
    if (win) this.lifetimeWins = (this.lifetimeWins || 0) + 1;
    if (loss) this.lifetimeLosses = (this.lifetimeLosses || 0) + 1;
    if (draw) this.lifetimeDraws = (this.lifetimeDraws || 0) + 1;
    if (rounds != null && Number.isFinite(rounds)) {
      this.lifetimeRoundSum = (this.lifetimeRoundSum || 0) + Number(rounds);
    }
    const played = (this.lifetimeWins || 0) + (this.lifetimeLosses || 0) + (this.lifetimeDraws || 0);
    if (played > 0) this.championWinRate = this.lifetimeWins / played;
  }

  lifetimeAvgRounds() {
    const played = (this.lifetimeWins || 0) + (this.lifetimeLosses || 0) + (this.lifetimeDraws || 0);
    if (played <= 0 || !(this.lifetimeRoundSum > 0)) return null;
    return this.lifetimeRoundSum / played;
  }

  /**
   * Frozen self-image for eval/play.
   * @param {{ shareMemory?: boolean }} opts  shareMemory=true → use learner's best-move table (read-only)
   */
  cloneChampion({ shareMemory = true } = {}) {
    const net = new BrowserRLNet(this.tier, this.championSnapshot || this.serialize({ includeMemory: false }));
    if (shareMemory) {
      net.memory = this.memory; // same Map — greedy val/play uses locked best moves
      net.memorySize = this.memory.size;
    }
    return net;
  }

  /** Only call after validation proves improvement — never during explore updates. */
  promoteChampion(alpha = 1) {
    const a = Math.max(0.05, Math.min(1, alpha));
    if (a >= 0.999) {
      this.championSnapshot = this.serialize({ includeMemory: false });
    } else {
      const champ = new BrowserRLNet(this.tier, this.championSnapshot);
      champ.softUpdateFrom(this, a);
      this.championSnapshot = champ.serialize({ includeMemory: false });
    }
    this.updatesCount++;
  }

  /** Restore weights from last validated snapshot (keeps memory). */
  rollbackToBestVal() {
    if (!this.bestValSnapshot) return false;
    this.loadSnapshot(this.bestValSnapshot, { restoreMemory: false });
    this.championSnapshot = this.serialize({ includeMemory: false });
    return true;
  }

  softUpdateFrom(challenger, alpha = 0.05) {
    const a = Math.max(0.001, Math.min(1, alpha));
    const keep = 1 - a;
    let sq = 0;
    for (let i = 0; i < this.hidSize; i++) {
      const nb = keep * this.b1[i] + a * challenger.b1[i];
      sq += (nb - this.b1[i]) ** 2;
      this.b1[i] = nb;
      for (let j = 0; j < this.inSize; j++) {
        const nw = keep * this.w1[i][j] + a * challenger.w1[i][j];
        sq += (nw - this.w1[i][j]) ** 2;
        this.w1[i][j] = nw;
      }
    }
    for (let i = 0; i < this.outSize; i++) {
      const nb = keep * this.b2[i] + a * challenger.b2[i];
      sq += (nb - this.b2[i]) ** 2;
      this.b2[i] = nb;
      for (let j = 0; j < this.hidSize; j++) {
        const nw = keep * this.w2[i][j] + a * challenger.w2[i][j];
        sq += (nw - this.w2[i][j]) ** 2;
        this.w2[i][j] = nw;
      }
    }
    this.lastWeightDelta = Math.sqrt(sq);
  }

  forward(x) {
    const h = new Array(this.hidSize);
    for (let i = 0; i < this.hidSize; i++) {
      let s = this.b1[i];
      const row = this.w1[i];
      for (let j = 0; j < this.inSize; j++) s += row[j] * x[j];
      h[i] = Math.tanh(s);
    }
    const out = new Array(this.outSize);
    for (let i = 0; i < this.outSize; i++) {
      let s = this.b2[i];
      const row = this.w2[i];
      for (let j = 0; j < this.hidSize; j++) s += row[j] * h[j];
      out[i] = 1 / (1 + Math.exp(-Math.max(-12, Math.min(12, s))));
    }
    return { h, out };
  }

  scoreAction(out, actionFeat) {
    let s = 0;
    for (let i = 0; i < this.outSize; i++) s += out[i] * (actionFeat[i] || 0);
    return s;
  }

  /**
   * D6-strength tactical prior. Scaled so it dominates a raw net until memory/imitations lock.
   * Medium/Large use full D6 scores; Small uses a lighter blend.
   */
  _tacticalBonus(state, seat, kind, card, targetRel) {
    const p = state.players?.[seat];
    if (!p) return 0;
    const depth = 6;
    const scale = this.tier === 'small' ? 0.045 : 0.085; // map ~±40 heuristic → useful score
    let b = 0;
    if (kind === 'ascend') {
      b += findValidAscensionSubset(p.pouch || [], p.seq, p.mods || {}) ? 2.2 : -1.5;
      return b;
    }
    if (kind === 'draft' && card) b += scoreDraftCard(card, p, state, depth) * scale;
    else if ((kind === 'tuck' || kind === 'pouch') && card) b += scoreTuckCard(card, p, depth) * scale;
    else if ((kind === 'play' || kind === 'trick' || kind === 'discard') && card) {
      b += scoreTrickCard(card, p, state, depth) * scale;
    } else if (kind === 'ability') {
      b += p.actingDone ? 0.15 : 0.55;
    } else if (kind === 'chaos' && card?.type === 'major') {
      const cid = card.majorId ?? 0;
      const selfHarm = (cid === 13 && (p.pouch?.length || 0) >= 2) || (cid === 12 && (p.hand?.length || 0) <= 3);
      b += selfHarm ? -1.2 : 0.45;
    } else if (kind === 'gamble') {
      b -= 0.35;
    } else if (kind === 'pass') {
      b -= 0.1;
    }
    if (targetRel === 0) b += 0.05;
    return b;
  }

  /**
   * Seed / reinforce memory with a Depth-6 teacher action (does not require exploration).
   * Used so Medium/Large start near D6 strength instead of ~30% random-net play.
   */
  noteTeacher(state, seat, kind, card, targetId = null, { strength = 0.85 } = {}) {
    const sh = hashState(this.tier, state, seat);
    const key = memoryActionKey(kind, card, targetId, state);
    let mem = this.memory.get(sh);
    if (!mem) {
      mem = { explored: {}, bestKey: key, bestReturn: strength, locked: false, teacherKey: key };
      this.memory.set(sh, mem);
      this.memorySize = this.memory.size;
      return;
    }
    mem.teacherKey = key;
    const prev = mem.explored[key] || { return: -Infinity, n: 0 };
    const n = prev.n + 1;
    const avg = prev.n ? (prev.return * prev.n + strength) / n : strength;
    mem.explored[key] = { return: avg, n };
    // Teacher installs best unless a locked learned action already beats it clearly
    if (!mem.locked || !mem.bestKey) {
      mem.bestKey = key;
      mem.bestReturn = Math.max(mem.bestReturn || -Infinity, avg);
    } else if (key === mem.bestKey) {
      mem.bestReturn = Math.max(mem.bestReturn, avg);
    }
    this.memorySize = this.memory.size;
  }

  /**
   * Build scored candidates for card / meta decisions.
   * items: [{ kind, card, targetId, targetRel, ... }]
   */
  rankCandidates(state, seat, items, handLimitMode = '10-7') {
    const x = extractObs(this.tier, state, seat, handLimitMode);
    const { h, out } = this.forward(x);
    const sh = hashState(this.tier, state, seat);
    const mem = this.memory.get(sh);
    const ranked = items.map((it, idx) => {
      const feat = encodeAction(this.tier, {
        kind: it.kind,
        card: it.card,
        targetRel: it.targetRel,
        phase: state.phase,
        ascendReady: it.kind === 'ascend' ? 1 : 0,
        threat: it.threat || 0,
        risk: it.risk || 0
      });
      const key = memoryActionKey(it.kind, it.card, it.targetId, state);
      const fineKey = actionKey(it.kind, it.card, it.targetId);
      let score = this.scoreAction(out, feat) + this._tacticalBonus(state, seat, it.kind, it.card, it.targetRel);
      if (mem?.bestKey === key) score += 3.5; // hard preference for locked best
      if (mem?.explored?.[key]) score += 0.2 * Math.tanh(mem.explored[key].return || 0);
      return { ...it, idx, key, fineKey, score, feat, x, h, out };
    });
    ranked.sort((a, b) => b.score - a.score);
    return { ranked, x, h, out, stateHash: sh, mem };
  }

  /**
   * Exhaustive / memory-aware pick among candidates.
   * training=true → explore unseen coarse actions; eval/play → always locked best when known.
   */
  pickCandidate(state, seat, items, { training = false, exploreRate = 0, handLimitMode = '10-7', trajectory = null } = {}) {
    if (!items?.length) return null;
    const { ranked, stateHash, mem } = this.rankCandidates(state, seat, items, handLimitMode);

    const pickBestLocked = () => {
      if (!mem?.bestKey) return null;
      const matches = ranked.filter(r => r.key === mem.bestKey);
      return matches[0] || null; // already score-sorted
    };

    let chosen = ranked[0];
    if (training) {
      // Mostly follow teacher/best; only occasionally explore unseen keys (keeps WR from collapsing)
      const exploreRoll = Math.random() < Math.max(0.08, exploreRate || 0.12);
      if (!mem?.locked && exploreRoll) {
        const unexplored = ranked.filter(r => !mem?.explored?.[r.key]);
        if (unexplored.length) {
          unexplored.sort((a, b) => (a.key < b.key ? -1 : 1));
          chosen = unexplored[0];
        } else {
          if (mem && mem.bestKey) mem.locked = true;
          chosen = pickBestLocked() || ranked[0];
        }
      } else {
        chosen = pickBestLocked() || (mem?.teacherKey ? (ranked.find(r => r.key === mem.teacherKey) || ranked[0]) : ranked[0]);
      }
      // If every coarse action has been tried at least once, lock
      if (mem && !mem.locked) {
        const keys = new Set(ranked.map(r => r.key));
        const seen = [...keys].every(k => mem.explored?.[k]);
        if (seen && mem.bestKey) mem.locked = true;
      }
    } else {
      // Eval / play: memory best → teacher → D6-biased net rank
      chosen = pickBestLocked()
        || (mem?.teacherKey ? ranked.find(r => r.key === mem.teacherKey) : null)
        || ranked[0];
    }

    if (trajectory) {
      trajectory.push({
        x: chosen.x,
        h: chosen.h,
        out: chosen.out,
        feat: chosen.feat,
        key: chosen.key,
        fineKey: chosen.fineKey,
        stateHash,
        kind: chosen.kind,
        cardId: chosen.card ? cardUidId(chosen.card) : -1,
        targetId: chosen.targetId ?? null,
        exploring: !!(training && mem && !mem.locked && !mem.explored?.[chosen.key])
      });
    }
    return chosen;
  }

  /** Yes/no meta head via synthetic candidates. */
  decideYesNo(state, seat, kind, { training = false, exploreRate = 0, trajectory = null, handLimitMode = '10-7' } = {}) {
    const p = state.players?.[seat];
    // D6-style prior for meta actions
    let teacherYes = false;
    if (kind === 'ascend') {
      teacherYes = !!(p && (p.actingDone || p.seq === 1 || (p.hand?.length || 0) >= (p.seq <= 3 ? 2 : 4) || (p.seq <= 3)));
    } else if (kind === 'ability') {
      teacherYes = true;
    } else if (kind === 'chaos') {
      const maj = (p?.hand || []).find(c => c.type === 'major');
      const cid = maj?.majorId;
      const selfHarm = cid != null && ((cid === 13 && (p.pouch?.length || 0) >= 2) || (cid === 12 && (p.hand?.length || 0) <= 3) || (cid === 18 && !!findValidAscensionSubset(p.pouch || [], p.seq, p.mods || {})));
      teacherYes = !selfHarm && ((p?.hand?.length || 0) >= 3 || [9, 17, 19, 21].includes(cid));
    } else if (kind === 'tuck') {
      teacherYes = true;
    } else if (kind === 'gamble') {
      teacherYes = false;
    } else if (kind === 'draft') {
      teacherYes = true;
    }
    if (training && p) {
      this.noteTeacher(state, seat, teacherYes ? kind : 'pass', null, null, { strength: 0.88 });
    }
    // Eval: follow locked memory else D6 teacher
    if (!training) {
      const sh = hashState(this.tier, state, seat);
      const mem = this.memory.get(sh);
      if (mem?.locked && mem.bestKey) {
        return mem.bestKey.startsWith(`${kind}:`) || mem.bestKey === kind || mem.bestKey.startsWith(kind);
      }
      return teacherYes;
    }
    const items = [
      { kind, card: null, targetId: null, targetRel: -1 },
      { kind: 'pass', card: null, targetId: null, targetRel: -1 }
    ];
    const pick = this.pickCandidate(state, seat, items, { training, exploreRate, trajectory, handLimitMode });
    return pick?.kind === kind;
  }

  selectCard(state, seat, candidates, phaseTag = 'trick', opts = {}) {
    if (!candidates?.length) return null;
    const kind =
      phaseTag === 'draft' ? 'draft'
        : phaseTag === 'pouch' ? 'tuck'
          : phaseTag === 'discard' ? 'discard'
            : 'play';
    const p = state.players?.[seat];
    const d6Pick = () => {
      if (!p) return candidates[0];
      if (kind === 'draft') return pickBestByScore(candidates, c => scoreDraftCard(c, p, state, 6));
      if (kind === 'tuck' || kind === 'pouch') return pickBestByScore(candidates, c => scoreTuckCard(c, p, 6));
      return pickBestByScore(candidates, c => scoreTrickCard(c, p, state, 6));
    };
    const teacher = d6Pick();
    // Seed memory with Depth-6 teacher so Medium/Large start near D6 (~50%), not random (~30%)
    if (opts.training && teacher) {
      this.noteTeacher(state, seat, kind, teacher, null, { strength: 0.92 });
    }

    // Eval/play: pure D6 unless this coarse state has a LOCKED learned upgrade
    if (!opts.training) {
      const sh = hashState(this.tier, state, seat);
      const mem = this.memory.get(sh);
      if (mem?.locked && mem.bestKey) {
        const items = candidates.map(card => ({ kind, card, targetId: null, targetRel: -1 }));
        const { ranked } = this.rankCandidates(state, seat, items, opts.handLimitMode || '10-7');
        const match = ranked.find(r => r.key === mem.bestKey);
        if (match?.card) return match.card;
      }
      return teacher || candidates[0];
    }

    const items = candidates.map(card => ({ kind, card, targetId: null, targetRel: -1 }));
    const pick = this.pickCandidate(state, seat, items, { ...opts, handLimitMode: opts.handLimitMode || '10-7' });
    return pick?.card || teacher || candidates[0];
  }

  /**
   * Update memory with episode return.
   * Does NOT touch champion weights (that only happens on validation promotion).
   * Locked states keep their bestKey unless a challenger beats it by a clear margin with samples.
   */
  updateMemoryFromTrajectory(trajectory, episodeReturn) {
    if (!trajectory?.length) return { improved: 0 };
    let improved = 0;
    const T = trajectory.length;
    for (let t = 0; t < T; t++) {
      const step = trajectory[t];
      const ret = episodeReturn * Math.pow(0.97, T - 1 - t);
      let mem = this.memory.get(step.stateHash);
      if (!mem) {
        mem = { explored: {}, bestKey: null, bestReturn: -Infinity, locked: false };
        this.memory.set(step.stateHash, mem);
      }
      const prev = mem.explored[step.key] || { return: -Infinity, n: 0 };
      const n = prev.n + 1;
      const avg = prev.n ? (prev.return * prev.n + ret) / n : ret;
      mem.explored[step.key] = { return: avg, n };

      // Protect D6 teacher: episode noise must clearly beat teacher before replacing
      const teacherFloor = mem.teacherKey ? 0.75 : -Infinity;
      const incumbent = Math.max(mem.bestReturn || -Infinity, teacherFloor);
      const margin = mem.locked ? 0.2 : (mem.teacherKey ? 0.25 : 0.05);
      const minN = mem.locked || mem.teacherKey ? 4 : 1;
      if (step.key === mem.teacherKey) {
        // Keep teacher as best while learning; don't demote on a few losses
        if (!mem.locked) {
          mem.bestKey = mem.teacherKey;
          mem.bestReturn = Math.max(mem.bestReturn || -Infinity, 0.7);
        }
      } else if (n >= minN && avg > incumbent + margin) {
        mem.bestReturn = avg;
        mem.bestKey = step.key;
        improved++;
      } else if (!mem.bestKey) {
        mem.bestKey = step.key;
        mem.bestReturn = avg;
        improved++;
      }
    }
    this.memorySize = this.memory.size;
    return { improved };
  }

  /** Supervised pull toward remembered best + policy gradient on episode return. */
  trainEpisode(trajectory, reward) {
    if (!trajectory?.length) return;
    this.updateMemoryFromTrajectory(trajectory, reward);
    this.rewardBaseline = this.rewardBaseline * 0.95 + reward * 0.05;
    const adv = Math.max(-2.5, Math.min(2.5, reward - this.rewardBaseline));
    const gamma = 0.96;
    const T = trajectory.length;
    const stepLr = this.lr / Math.max(2, Math.min(16, T / 3));
    const decay = 0.99985;

    for (let t = 0; t < T; t++) {
      const step = trajectory[t];
      const { x, feat } = step;
      const { h, out } = this.forward(x);
      const disc = adv * Math.pow(gamma, T - 1 - t);
      // Target: boost features of chosen / memory-best action
      const mem = this.memory.get(step.stateHash);
      const targetFeat = feat.slice();
      if (mem?.bestKey && mem.bestKey !== step.key) {
        // mild pull toward best remembered encoding via chosen feat still (we only have chosen feat)
      }
      const dOut = new Array(this.outSize);
      for (let i = 0; i < this.outSize; i++) {
        const target = Math.max(0, Math.min(1, (targetFeat[i] || 0) * (0.5 + 0.5 * Math.tanh(disc))));
        dOut[i] = Math.max(-1, Math.min(1, (target - out[i]) * (0.35 + Math.abs(disc))));
      }
      const dH = new Array(this.hidSize).fill(0);
      for (let i = 0; i < this.outSize; i++) {
        for (let j = 0; j < this.hidSize; j++) {
          dH[j] += dOut[i] * this.w2[i][j] * (1 - h[j] * h[j]);
          this.w2[i][j] = this.w2[i][j] * decay + stepLr * dOut[i] * h[j];
        }
        this.b2[i] += stepLr * dOut[i];
      }
      for (let i = 0; i < this.hidSize; i++) {
        const g = Math.max(-0.4, Math.min(0.4, stepLr * dH[i]));
        if (Math.abs(g) < 1e-8) continue;
        this.b1[i] += g;
        const row = this.w1[i];
        for (let k = 0; k < this.inSize; k++) row[k] = row[k] * decay + g * x[k];
      }
    }
    this.gamesTrained++;
  }

  /** Imitation toward heuristic / teacher trajectory keys. */
  imitateTrajectory(trajectory, weight = 0.3) {
    if (!trajectory?.length) return;
    const stepLr = (this.lr * weight) / Math.max(4, Math.sqrt(trajectory.length));
    for (const step of trajectory) {
      const { x, feat } = step;
      if (!feat) continue;
      const { h, out } = this.forward(x);
      const dOut = feat.map((f, i) => (f - out[i]));
      const dH = new Array(this.hidSize).fill(0);
      for (let i = 0; i < this.outSize; i++) {
        for (let j = 0; j < this.hidSize; j++) {
          dH[j] += dOut[i] * this.w2[i][j] * (1 - h[j] * h[j]);
          this.w2[i][j] += stepLr * dOut[i] * h[j];
        }
        this.b2[i] += stepLr * dOut[i];
      }
      for (let i = 0; i < this.hidSize; i++) {
        const g = stepLr * dH[i];
        if (Math.abs(g) < 1e-8) continue;
        this.b1[i] += g;
        for (let k = 0; k < this.inSize; k++) this.w1[i][k] += g * x[k];
      }
    }
  }
}
