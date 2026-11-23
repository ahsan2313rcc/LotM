import { SUITS } from '../data/constants.js';
import { extractCardIdFeatures, CARD_ID_FEATURE_SIZE, NN_SCHEMA_VERSION } from './features.js';

/** Medium = 112×64×51 (schema 2). Hard = 112×160×51 (schema 3, more capacity). */
export const NN_TIERS = {
  medium: { kind: 'medium', schemaVersion: NN_SCHEMA_VERSION, hidSize: 64 },
  hard: { kind: 'hard', schemaVersion: 3, hidSize: 160 }
};

export function isMediumNN(net) {
  return !!(net && net.kind === 'medium');
}

export function isHardNN(net) {
  return !!(net && net.kind === 'hard');
}

export function isCardIdNN(net) {
  return isMediumNN(net) || isHardNN(net);
}

function resolveTier(saved, tierHint) {
  if (tierHint === 'hard' || tierHint === 'medium') return tierHint;
  if (saved?.kind === 'hard' && saved?.schemaVersion === 3 && Array.isArray(saved?.w1) && saved.w1.length === NN_TIERS.hard.hidSize) {
    return 'hard';
  }
  // Legacy serialized kind:'hard' with schema 2 / 64-hid was the old medium net
  return 'medium';
}

function applyPriors(b2) {
  b2[29] = -0.45;
  b2[30] = 0.55;
  b2[31] = -1.4;
  b2[32] = 0.75;
  b2[33] = 0.55;
  b2[34] = 1.0;
  b2[35] = 0.95;
  b2[39] = 1.6;
  b2[40] = 0.8;
  b2[41] = 0.7;
  b2[42] = 0.6;
  b2[43] = 0.6;
  b2[44] = -0.6;
  b2[45] = 1.6;
  b2[46] = 0.8;
  b2[47] = 0.6;
  b2[48] = 1.0;
  b2[49] = 1.8;
}

class CardIdNeuralNet {
  /**
   * @param {object|null} saved
   * @param {'medium'|'hard'|null} tierHint
   */
  constructor(saved = null, tierHint = null) {
    const tier = resolveTier(saved, tierHint);
    const cfg = NN_TIERS[tier];
    this.kind = cfg.kind;
    this.schemaVersion = cfg.schemaVersion;
    this.inSize = CARD_ID_FEATURE_SIZE;
    this.hidSize = cfg.hidSize;
    this.outSize = 51;
    this.lr = tier === 'hard' ? 0.04 : 0.05;
    this.epsilon = 0.1;
    this.rewardBaseline = saved?.rewardBaseline || 0;
    this.gamesTrained = saved?.gamesTrained || 0;
    this.championWinRate = saved?.championWinRate || 0;
    this.updatesCount = saved?.updatesCount || 0;
    this.lastWeightDelta = saved?.lastWeightDelta || 0;

    const valid = !!(
      saved && saved.schemaVersion === this.schemaVersion &&
      Array.isArray(saved.w1) && Array.isArray(saved.w2) && Array.isArray(saved.b1) && Array.isArray(saved.b2) &&
      saved.w1.length === this.hidSize && saved.b1.length === this.hidSize &&
      saved.w2.length === this.outSize && saved.b2.length === this.outSize &&
      saved.w1.every(r => Array.isArray(r) && r.length === this.inSize && r.every(Number.isFinite)) &&
      saved.w2.every(r => Array.isArray(r) && r.length === this.hidSize && r.every(Number.isFinite)) &&
      saved.b1.every(Number.isFinite) && saved.b2.every(Number.isFinite)
    );
    if (valid) {
      this.w1 = saved.w1.map(r => {
        const row = [...r];
        while (row.length < this.inSize) row.push(0);
        return row.slice(0, this.inSize);
      });
      this.b1 = [...saved.b1];
      this.w2 = saved.w2.map(r => [...r]);
      this.b2 = [...saved.b2];
      while (this.w2.length < this.outSize) { this.w2.push(new Array(this.hidSize).fill(0)); this.b2.push(0); }
    } else {
      const scale1 = tier === 'hard' ? 0.08 : 0.12;
      const scale2 = tier === 'hard' ? 0.015 : 0.02;
      const randMat = (r, c, scale) => Array.from({ length: r }, () => Array.from({ length: c }, () => (Math.random() * 2 - 1) * scale));
      this.w1 = randMat(this.hidSize, this.inSize, scale1);
      this.b1 = new Array(this.hidSize).fill(0);
      this.w2 = randMat(this.outSize, this.hidSize, scale2);
      this.b2 = new Array(this.outSize).fill(0);
      applyPriors(this.b2);
    }
    this.bestValRate = saved?.championWinRate || 0;
    this.championSnapshot = this.serialize();
    this.bestValSnapshot = this.serialize();
  }

  serialize() {
    return {
      kind: this.kind,
      schemaVersion: this.schemaVersion,
      hidSize: this.hidSize,
      w1: this.w1.map(r => [...r]),
      b1: [...this.b1],
      w2: this.w2.map(r => [...r]),
      b2: [...this.b2],
      rewardBaseline: this.rewardBaseline,
      gamesTrained: this.gamesTrained,
      championWinRate: this.championWinRate,
      updatesCount: this.updatesCount,
      lastWeightDelta: this.lastWeightDelta
    };
  }

  loadSnapshot(snap) {
    if (!snap || snap.schemaVersion !== this.schemaVersion || !snap.w2 || snap.w2.length !== this.outSize || snap.w1?.length !== this.hidSize) return;
    this.w1 = snap.w1.map(r => {
      const row = [...r];
      while (row.length < this.inSize) row.push(0);
      return row.slice(0, this.inSize);
    });
    this.b1 = [...snap.b1];
    this.w2 = snap.w2.map(r => [...r]);
    this.b2 = [...snap.b2];
    while (this.w2.length < this.outSize) { this.w2.push(new Array(this.hidSize).fill(0)); this.b2.push(0); }
    this.rewardBaseline = snap.rewardBaseline || 0;
  }

  softUpdateFrom(challenger, alpha = 0.01) {
    if (!challenger || challenger.hidSize !== this.hidSize || challenger.outSize !== this.outSize) return;
    const a = Math.max(0.0001, Math.min(1, Number(alpha) || 0.01));
    const keep = 1 - a;
    let sqDelta = 0;
    for (let i = 0; i < this.hidSize; i++) {
      const nb = keep * this.b1[i] + a * challenger.b1[i];
      sqDelta += (nb - this.b1[i]) ** 2;
      this.b1[i] = nb;
      const rT = this.w1[i], rC = challenger.w1[i];
      for (let j = 0; j < this.inSize; j++) {
        const nw = keep * rT[j] + a * rC[j];
        sqDelta += (nw - rT[j]) ** 2;
        rT[j] = nw;
      }
    }
    for (let i = 0; i < this.outSize; i++) {
      const nb = keep * this.b2[i] + a * challenger.b2[i];
      sqDelta += (nb - this.b2[i]) ** 2;
      this.b2[i] = nb;
      const rT = this.w2[i], rC = challenger.w2[i];
      for (let j = 0; j < this.hidSize; j++) {
        const nw = keep * rT[j] + a * rC[j];
        sqDelta += (nw - rT[j]) ** 2;
        rT[j] = nw;
      }
    }
    this.rewardBaseline = keep * this.rewardBaseline + a * (challenger.rewardBaseline || 0);
    this.lastWeightDelta = Math.sqrt(sqDelta);
  }

  forwardHidden(x) {
    const h = new Float32Array(this.hidSize);
    for (let i = 0; i < this.hidSize; i++) {
      let sum = this.b1[i];
      const row = this.w1[i];
      for (let j = 0; j < this.inSize; j++) {
        const xv = x[j];
        if (xv !== 0) sum += row[j] * xv;
      }
      h[i] = Math.tanh(sum);
    }
    return h;
  }

  scoreOut(h, idx) {
    const row = this.w2?.[idx];
    if (!row) return 0;
    let sum = Number.isFinite(this.b2?.[idx]) ? this.b2[idx] : 0;
    for (let j = 0; j < this.hidSize; j++) sum += (row[j] || 0) * (h[j] || 0);
    return Number.isFinite(sum) ? sum : 0;
  }

  cardScoreComponents(h, c, ctx = null) {
    const terms = [];
    let score = 0;
    if (c.type === 'major') {
      const pairIdx = 18 + Math.floor((c.majorId || 0) / 2);
      const sign = (c.majorId % 2 === 0) ? 1 : -1;
      terms.push({ idx: pairIdx, sign });
      score += sign * this.scoreOut(h, pairIdx);
    } else {
      const rIdx = Math.max(0, Math.min(13, (c.rank || 1) - 1));
      const sIdx = 14 + Math.max(0, SUITS.indexOf(c.suit));
      terms.push({ idx: rIdx, sign: 1 }, { idx: sIdx, sign: 1 });
      score += this.scoreOut(h, rIdx) + this.scoreOut(h, sIdx);
    }
    if (ctx) {
      for (let k = 0; k < ctx.length; k++) {
        if (ctx[k] !== 0) {
          terms.push({ idx: 39 + k, sign: ctx[k] });
          score += ctx[k] * this.scoreOut(h, 39 + k);
        }
      }
    }
    return { score, terms };
  }

  selectCard(features, candidateCards, trajectory = null, exploreRate = 0, keySigns = null) {
    if (!candidateCards || candidateCards.length === 0) return null;
    if (candidateCards.length === 1) return candidateCards[0];
    const h = this.forwardHidden(features);
    const comps = candidateCards.map((c, idx) => this.cardScoreComponents(h, c, keySigns ? keySigns[idx] : 0));
    const logits = comps.map(o => o.score);
    const maxL = Math.max(...logits);
    const exps = logits.map(l => Math.exp(Math.max(-10, l - maxL)));
    const sumE = exps.reduce((a, b) => a + b, 0) || 1;
    const probs = exps.map(e => e / sumE);

    // Epsilon-greedy: mostly argmax, rarely on-policy sample (was always-sampling → WR stuck ~10%)
    let chosenPos = 0;
    if (exploreRate > 0 && Math.random() < exploreRate) {
      let r = Math.random(), acc = 0;
      chosenPos = probs.length - 1;
      for (let i = 0; i < probs.length; i++) {
        acc += probs[i];
        if (r <= acc) { chosenPos = i; break; }
      }
    } else {
      for (let i = 1; i < logits.length; i++) if (logits[i] > logits[chosenPos]) chosenPos = i;
    }

    if (trajectory) {
      trajectory.push({ mode: 'factorized_card', x: features, h, termsList: comps.map(o => o.terms), probs, chosenPos, rStep: 0 });
    }
    return candidateCards[chosenPos];
  }

  selectTarget(features, opponents, trajectory = null, exploreRate = 0) {
    if (!opponents || opponents.length === 0) return null;
    if (opponents.length === 1) return opponents[0];
    const h = this.forwardHidden(features);
    const kCount = Math.min(3, opponents.length);
    const idxs = Array.from({ length: kCount }, (_, k) => 36 + k);
    const logits = idxs.map(id => this.scoreOut(h, id));
    const maxL = Math.max(...logits);
    const exps = logits.map(l => Math.exp(Math.max(-10, l - maxL)));
    const sumE = exps.reduce((a, b) => a + b, 0) || 1;
    const probs = exps.map(e => e / sumE);

    let chosenPos = 0;
    if (exploreRate > 0 && Math.random() < exploreRate) {
      let r = Math.random(), acc = 0;
      chosenPos = probs.length - 1;
      for (let i = 0; i < probs.length; i++) {
        acc += probs[i];
        if (r <= acc) { chosenPos = i; break; }
      }
    } else {
      for (let i = 1; i < kCount; i++) if (logits[i] > logits[chosenPos]) chosenPos = i;
    }

    if (trajectory) {
      trajectory.push({ mode: 'factorized_card', x: features, h, termsList: idxs.map(idx => [{ idx, sign: 1 }]), probs, chosenPos, rStep: 0 });
    }
    return opponents[chosenPos];
  }

  actMeta(features, metaIdx, trajectory = null, exploreRate = 0) {
    const outIdx = 29 + metaIdx;
    const h = this.forwardHidden(features);
    const logit = this.scoreOut(h, outIdx);
    const prob = 1 / (1 + Math.exp(-Math.max(-10, Math.min(10, logit))));
    const explore = exploreRate > 0 && Math.random() < exploreRate;
    const chosen = explore ? (Math.random() < 0.5 ? 1 : 0) : (prob >= 0.5 ? 1 : 0);
    if (trajectory) trajectory.push({ mode: 'meta', x: features, h, outIdx, prob, chosen, rStep: 0 });
    return chosen === 1;
  }

  trainEpisode(trajectory, terminalReward) {
    if (!trajectory || trajectory.length === 0) {
      this.gamesTrained++;
      return;
    }
    this.rewardBaseline = this.rewardBaseline * 0.96 + terminalReward * 0.04;
    const gamma = 0.97;
    const T = trajectory.length;
    const returns = new Float32Array(T);
    let G = terminalReward;
    for (let t = T - 1; t >= 0; t--) {
      G = (trajectory[t].rStep || 0) + gamma * G;
      returns[t] = G;
    }

    const stepLr = this.lr / Math.max(8, Math.min(48, Math.sqrt(T) * 3.5));
    const criticLr = stepLr * 1.6;
    const decay = 0.99999;

    for (let t = 0; t < T; t++) {
      const step = trajectory[t];
      const { x, h } = step;
      const vRaw = this.scoreOut(h, 50);
      const vPred = Math.tanh(vRaw) * 2.5;
      const tdErr = Math.max(-2, Math.min(2, returns[t] - vPred));
      const dH = new Float32Array(this.hidSize);

      const dV = Math.max(-1, Math.min(1, tdErr * (1 - Math.tanh(vRaw) ** 2)));
      this.b2[50] = Math.max(-3, Math.min(3, this.b2[50] + criticLr * dV));
      const rowV = this.w2[50];
      for (let j = 0; j < this.hidSize; j++) {
        dH[j] += 0.35 * dV * rowV[j];
        rowV[j] = Math.max(-3, Math.min(3, rowV[j] * decay + criticLr * dV * h[j]));
      }

      if (step.mode === 'factorized_card') {
        const { termsList, probs, chosenPos } = step;
        for (let k = 0; k < termsList.length; k++) {
          const dScore = Math.max(-1, Math.min(1, ((k === chosenPos ? 1 : 0) - probs[k]) * tdErr));
          for (const { idx, sign } of termsList[k]) {
            const dOut = dScore * sign;
            this.b2[idx] = Math.max(-3, Math.min(3, this.b2[idx] + stepLr * dOut));
            const row2 = this.w2[idx];
            for (let j = 0; j < this.hidSize; j++) {
              dH[j] += dOut * row2[j];
              row2[j] = Math.max(-3, Math.min(3, row2[j] * decay + stepLr * dOut * h[j]));
            }
          }
        }
      } else {
        const { outIdx, prob, chosen } = step;
        const dOut = Math.max(-1, Math.min(1, (chosen - prob) * tdErr));
        this.b2[outIdx] = Math.max(-3, Math.min(3, this.b2[outIdx] + stepLr * dOut));
        const row2 = this.w2[outIdx];
        for (let j = 0; j < this.hidSize; j++) {
          dH[j] += dOut * row2[j];
          row2[j] = Math.max(-3, Math.min(3, row2[j] * decay + stepLr * dOut * h[j]));
        }
      }

      for (let i = 0; i < this.hidSize; i++) {
        const g = Math.max(-0.25, Math.min(0.25, stepLr * dH[i] * (1 - h[i] * h[i])));
        if (Math.abs(g) < 1e-6) continue;
        this.b1[i] = Math.max(-3, Math.min(3, this.b1[i] + g));
        const row1 = this.w1[i];
        for (let j = 0; j < this.inSize; j++) {
          const xv = x[j];
          if (xv !== 0) row1[j] = Math.max(-3, Math.min(3, row1[j] * decay + g * xv));
        }
      }
    }
    this.gamesTrained++;
    this.updatesCount = (this.updatesCount || 0) + 1;
  }

  imitateTrajectory(steps, lr = 0.08) {
    if (!steps || steps.length === 0) return;
    for (const st of steps) {
      if (!st || !st.x || st.x.length !== this.inSize) continue;
      const h = this.forwardHidden(st.x);
      const outIdx = 29 + (st.metaIdx ?? 0);
      const logit = this.scoreOut(h, outIdx);
      const prob = 1 / (1 + Math.exp(-Math.max(-10, Math.min(10, logit))));
      const dOut = Math.max(-1, Math.min(1, (st.chosen - prob)));
      this.b2[outIdx] = Math.max(-3, Math.min(3, this.b2[outIdx] + lr * dOut));
      const dH = new Float32Array(this.hidSize);
      const row2 = this.w2[outIdx];
      for (let j = 0; j < this.hidSize; j++) {
        dH[j] += dOut * row2[j];
        row2[j] = Math.max(-3, Math.min(3, row2[j] + lr * dOut * h[j]));
      }
      for (let i = 0; i < this.hidSize; i++) {
        const g = Math.max(-0.3, Math.min(0.3, lr * dH[i] * (1 - h[i] * h[i])));
        if (Math.abs(g) < 1e-6) continue;
        this.b1[i] = Math.max(-3, Math.min(3, this.b1[i] + g));
        const row1 = this.w1[i];
        for (let j = 0; j < this.inSize; j++) {
          const xv = st.x[j];
          if (xv !== 0) row1[j] = Math.max(-3, Math.min(3, row1[j] + g * xv));
        }
      }
    }
  }
}

export { CardIdNeuralNet };
