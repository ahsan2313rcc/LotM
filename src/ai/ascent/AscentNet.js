import { OBS_SIZE } from './obs.js';
import { MODE_COUNT, CARD_COUNT, SEAT_ABILITY_HEADS, ABILITY_SLOTS, seqAbilitySlot } from './zones.js';

export const ASCENT_SCHEMA = 2;
export const ASCENT_HID = 192;

function randMat(r, c, scale) {
  return Array.from({ length: r }, () => Array.from({ length: c }, () => (Math.random() * 2 - 1) * scale));
}
function randVec(n, scale) {
  return Array.from({ length: n }, () => (Math.random() * 2 - 1) * scale);
}

/**
 * Multi-head ascent policy. Learning uses returns-to-go + value baseline
 * (same shape as Medium CardIdNeuralNet) — not per-step terminal bias.
 */
export class AscentNet {
  constructor(saved = null) {
    this.kind = 'ascent';
    this.schemaVersion = ASCENT_SCHEMA;
    this.inSize = OBS_SIZE;
    this.hidSize = ASCENT_HID;
    this.lr = 0.02;
    this.exploreRate = 0.1;
    this.gamesTrained = saved?.gamesTrained || 0;
    this.updatesCount = saved?.updatesCount || 0;
    this.ascentScore = saved?.ascentScore || 0;
    this.championWinRate = saved?.championWinRate || 0;
    this.rewardBaseline = saved?.rewardBaseline || 0;
    this.ascentSparDepth = Math.max(1, Math.min(6, Number(saved?.ascentSparDepth) || 2));
    this.bestSparWin = saved?.bestSparWin || 0;
    this.bestValSnapshot = saved?.bestValSnapshot || null;

    const ok = !!(
      saved && saved.kind === 'ascent' &&
      Array.isArray(saved.w1) && saved.w1.length === this.hidSize &&
      Array.isArray(saved.wMode) && saved.wMode.length === MODE_COUNT &&
      Array.isArray(saved.wCard) && saved.wCard.length === CARD_COUNT &&
      Array.isArray(saved.wSelfAbil) && saved.wSelfAbil.length === SEAT_ABILITY_HEADS &&
      Array.isArray(saved.wOppAbil) && saved.wOppAbil.length === SEAT_ABILITY_HEADS
    );

    if (ok) {
      this.w1 = saved.w1.map(r => [...r]);
      this.b1 = [...saved.b1];
      this.wMode = saved.wMode.map(r => [...r]);
      this.bMode = [...saved.bMode];
      this.wCard = saved.wCard.map(r => [...r]);
      this.bCard = [...saved.bCard];
      this.wTarget = saved.wTarget.map(r => [...r]);
      this.bTarget = [...saved.bTarget];
      this.wSelfAbil = saved.wSelfAbil.map(r => [...r]);
      this.bSelfAbil = [...saved.bSelfAbil];
      this.wOppAbil = saved.wOppAbil.map(r => [...r]);
      this.bOppAbil = [...saved.bOppAbil];
      this.wValue = [...saved.wValue];
      this.bValue = saved.bValue || 0;
    } else {
      const s1 = 0.05, s2 = 0.025;
      this.w1 = randMat(this.hidSize, this.inSize, s1);
      this.b1 = new Array(this.hidSize).fill(0);
      this.wMode = randMat(MODE_COUNT, this.hidSize, s2);
      this.bMode = new Array(MODE_COUNT).fill(0);
      this.wCard = randMat(CARD_COUNT, this.hidSize, s2);
      this.bCard = new Array(CARD_COUNT).fill(0);
      this.wTarget = randMat(3, this.hidSize, s2);
      this.bTarget = new Array(3).fill(0);
      this.wSelfAbil = randMat(SEAT_ABILITY_HEADS, this.hidSize, s2);
      this.bSelfAbil = new Array(SEAT_ABILITY_HEADS).fill(0);
      this.wOppAbil = randMat(SEAT_ABILITY_HEADS, this.hidSize, s2);
      this.bOppAbil = new Array(SEAT_ABILITY_HEADS).fill(0);
      this.wValue = randVec(this.hidSize, s2);
      this.bValue = 0;
      this.bMode[10] = 0.4; // ASCEND prior
    }
  }

  serialize() {
    return {
      kind: 'ascent',
      schemaVersion: this.schemaVersion,
      w1: this.w1.map(r => [...r]),
      b1: [...this.b1],
      wMode: this.wMode.map(r => [...r]),
      bMode: [...this.bMode],
      wCard: this.wCard.map(r => [...r]),
      bCard: [...this.bCard],
      wTarget: this.wTarget.map(r => [...r]),
      bTarget: [...this.bTarget],
      wSelfAbil: this.wSelfAbil.map(r => [...r]),
      bSelfAbil: [...this.bSelfAbil],
      wOppAbil: this.wOppAbil.map(r => [...r]),
      bOppAbil: [...this.bOppAbil],
      wValue: [...this.wValue],
      bValue: this.bValue,
      gamesTrained: this.gamesTrained,
      updatesCount: this.updatesCount,
      ascentScore: this.ascentScore,
      rewardBaseline: this.rewardBaseline,
      ascentSparDepth: this.ascentSparDepth,
      championWinRate: this.championWinRate || 0,
      bestSparWin: this.bestSparWin || 0,
      bestValSnapshot: this.bestValSnapshot || null
    };
  }

  loadSnapshot(snap) {
    if (!snap) return;
    const n = new AscentNet(snap);
    Object.assign(this, {
      w1: n.w1, b1: n.b1,
      wMode: n.wMode, bMode: n.bMode,
      wCard: n.wCard, bCard: n.bCard,
      wTarget: n.wTarget, bTarget: n.bTarget,
      wSelfAbil: n.wSelfAbil, bSelfAbil: n.bSelfAbil,
      wOppAbil: n.wOppAbil, bOppAbil: n.bOppAbil,
      wValue: n.wValue, bValue: n.bValue,
      rewardBaseline: n.rewardBaseline
    });
  }

  currentExplore() {
    const g = this.gamesTrained || 0;
    return Math.max(0.015, this.exploreRate * Math.exp(-g / 1800));
  }

  encode(obs) {
    const h = new Float32Array(this.hidSize);
    for (let i = 0; i < this.hidSize; i++) {
      let s = this.b1[i];
      const row = this.w1[i];
      for (let j = 0; j < this.inSize; j++) {
        const v = obs[j];
        if (v) s += row[j] * v;
      }
      h[i] = Math.tanh(s);
    }
    return h;
  }

  _logits(h, w, b) {
    const out = new Float32Array(w.length);
    for (let i = 0; i < w.length; i++) {
      let s = b[i];
      const row = w[i];
      for (let j = 0; j < this.hidSize; j++) s += row[j] * h[j];
      out[i] = s;
    }
    return out;
  }

  valueOf(h) {
    let s = this.bValue;
    for (let i = 0; i < this.hidSize; i++) s += this.wValue[i] * h[i];
    return Math.tanh(s);
  }

  scoreActions(obs, legalActions, exploreRate = 0) {
    const h = this.encode(obs);
    const value = this.valueOf(h);
    if (!legalActions?.length) return { bestIdx: 0, scores: [], value, h, probs: [] };

    const modeL = this._logits(h, this.wMode, this.bMode);
    const cardL = this._logits(h, this.wCard, this.bCard);
    const tgtL = this._logits(h, this.wTarget, this.bTarget);
    const selfA = this._logits(h, this.wSelfAbil, this.bSelfAbil);

    const scores = legalActions.map(a => {
      let s = modeL[a.mode] || 0;
      if (a.cardId != null && a.cardId >= 0) s += cardL[a.cardId] || 0;
      if (a.targetIdx != null && a.targetIdx >= 0) s += tgtL[a.targetIdx % 3] || 0;
      if (a.mode === 6 && a.abilitySlot != null) s += selfA[a.abilitySlot] || 0;
      if (a.mode === 7) s += selfA[ABILITY_SLOTS] || 0;
      return s;
    });

    const maxS = Math.max(...scores);
    const exps = scores.map(x => Math.exp(Math.max(-12, Math.min(12, x - maxS))));
    const sum = exps.reduce((a, b) => a + b, 0) || 1;
    const probs = exps.map(e => e / sum);

    let bestIdx = 0;
    if (exploreRate > 0 && Math.random() < exploreRate) {
      let r = Math.random(), acc = 0;
      bestIdx = probs.length - 1;
      for (let i = 0; i < probs.length; i++) {
        acc += probs[i];
        if (r <= acc) { bestIdx = i; break; }
      }
    } else {
      for (let i = 1; i < scores.length; i++) if (scores[i] > scores[bestIdx]) bestIdx = i;
    }
    return { bestIdx, scores, probs, value, h };
  }

  oppThreatScore(obs, slotOrMajor) {
    const h = this.encode(obs);
    const oppA = this._logits(h, this.wOppAbil, this.bOppAbil);
    if (slotOrMajor === 'major') return oppA[ABILITY_SLOTS];
    return oppA[slotOrMajor] || 0;
  }

  trainOnChoice(obs, legalActions, chosenIdx, advantage, stepLr) {
    if (!legalActions?.length || chosenIdx < 0) return;
    const h = this.encode(obs);
    const { probs } = this.scoreActions(obs, legalActions, 0);
    const adv = Math.max(-2, Math.min(2, advantage));
    const lr = stepLr;
    const decay = 0.99997;
    const a = legalActions[chosenIdx];
    const dH = new Float32Array(this.hidSize);

    const bumpHead = (w, b, idx, coeff) => {
      if (idx == null || idx < 0 || idx >= w.length) return;
      const d = Math.max(-1, Math.min(1, coeff * adv));
      b[idx] = Math.max(-3, Math.min(3, b[idx] + lr * d));
      const row = w[idx];
      for (let j = 0; j < this.hidSize; j++) {
        dH[j] += d * row[j];
        row[j] = Math.max(-3, Math.min(3, row[j] * decay + lr * d * h[j]));
      }
    };

    const coeff = (1 - (probs[chosenIdx] || 0));
    bumpHead(this.wMode, this.bMode, a.mode, coeff);
    if (a.cardId != null) bumpHead(this.wCard, this.bCard, a.cardId, coeff);
    if (a.targetIdx != null) bumpHead(this.wTarget, this.bTarget, a.targetIdx % 3, coeff);
    if (a.mode === 6 && a.abilitySlot != null) bumpHead(this.wSelfAbil, this.bSelfAbil, a.abilitySlot, coeff);
    if (a.mode === 7) bumpHead(this.wSelfAbil, this.bSelfAbil, ABILITY_SLOTS, coeff);

    const v = this.valueOf(h);
    const dV = Math.max(-1, Math.min(1, adv * (1 - v * v)));
    const criticLr = lr * 1.4;
    this.bValue = Math.max(-3, Math.min(3, this.bValue + criticLr * dV));
    for (let i = 0; i < this.hidSize; i++) {
      dH[i] += 0.35 * dV * this.wValue[i];
      this.wValue[i] = Math.max(-3, Math.min(3, this.wValue[i] * decay + criticLr * dV * h[i]));
    }

    for (let i = 0; i < this.hidSize; i++) {
      const g = Math.max(-0.2, Math.min(0.2, lr * dH[i] * (1 - h[i] * h[i])));
      if (Math.abs(g) < 1e-7) continue;
      this.b1[i] = Math.max(-3, Math.min(3, this.b1[i] + g));
      const row = this.w1[i];
      for (let j = 0; j < this.inSize; j++) {
        const xv = obs[j];
        if (xv) row[j] = Math.max(-3, Math.min(3, row[j] * decay + g * xv));
      }
    }
  }

  noteEpisode({ ascendedSteps, rounds, won, oppAscended }) {
    const speed = ascendedSteps / Math.max(1, rounds);
    const deny = Math.max(0, 1 - (oppAscended || 0) / 9);
    const terminal = won ? 1 : (won === false ? -0.4 : 0);
    const score = speed * 2 + deny * 0.35 + terminal;
    // Heavier EMA so the plotted score stops thrashing
    this.ascentScore = this.ascentScore * 0.98 + score * 0.02;
    this.gamesTrained++;
  }

  /**
   * Proper returns-to-go + normalized advantages (Medium-style).
   * One updatesCount bump per episode — not per step.
   */
  trainEpisode(trajectory, terminalReward) {
    if (!trajectory?.length) return;
    const steps = trajectory.filter(s => s?.kind === 'ascent' && s.legal && s.obs && s.idx >= 0);
    if (!steps.length) return;

    const T = steps.length;
    const gamma = 0.97;
    const returns = new Float32Array(T);
    let G = terminalReward;
    for (let t = T - 1; t >= 0; t--) {
      G = (steps[t].rStep || 0) + gamma * G;
      returns[t] = G;
    }

    // Value-baseline advantages, then normalize within episode
    const advs = new Float32Array(T);
    let sum = 0;
    for (let t = 0; t < T; t++) {
      const h = this.encode(steps[t].obs);
      const v = this.valueOf(h) * 2.0;
      advs[t] = returns[t] - v;
      sum += advs[t];
    }
    const mean = sum / T;
    let varSum = 0;
    for (let t = 0; t < T; t++) {
      advs[t] -= mean;
      varSum += advs[t] * advs[t];
    }
    const std = Math.sqrt(varSum / T) + 1e-3;

    const stepLr = this.lr / Math.max(10, Math.min(40, Math.sqrt(T) * 3));
    let used = 0;
    for (let t = 0; t < T; t++) {
      const adv = Math.max(-2, Math.min(2, advs[t] / std));
      if (Math.abs(adv) < 0.08) continue;
      this.trainOnChoice(steps[t].obs, steps[t].legal, steps[t].idx, adv, stepLr);
      used++;
    }
    this.rewardBaseline = this.rewardBaseline * 0.96 + terminalReward * 0.04;
    this.updatesCount = (this.updatesCount || 0) + 1;
    return used;
  }

  /** Keep best weights when rolling spar win improves. */
  maybeSaveBest(sparWin01) {
    if (sparWin01 == null || sparWin01 < this.bestSparWin + 0.02) return false;
    this.bestSparWin = sparWin01;
    const snap = this.serialize();
    delete snap.bestValSnapshot;
    this.bestValSnapshot = snap;
    return true;
  }

  /** Roll back if live play collapses vs saved best. */
  maybeRollback(sparWin01) {
    if (!this.bestValSnapshot || sparWin01 == null) return false;
    if (sparWin01 >= this.bestSparWin - 0.12) return false;
    this.loadSnapshot(this.bestValSnapshot);
    return true;
  }

  noteGameResult({ won, draw = false }) {
    if (!draw && won) this.championWinRate = Math.min(1, (this.championWinRate || 0) * 0.92 + 0.08);
    else if (!draw) this.championWinRate = (this.championWinRate || 0) * 0.92;
  }
}

export function abilitySlotForPlayer(p) {
  return seqAbilitySlot(p?.seq ?? 9);
}
