import { extractObservation, cardId, CARD_VOCAB, META_COUNT, OBS_SIZE } from './tabulaObserve.js';

export const TABULA_SCHEMA = 1;
export const TABULA_HID = 128;
export const TABULA_EMB = 24;

export function isTabulaNN(net) {
  return !!(net && net.kind === 'tabula');
}

function randMat(r, c, scale) {
  return Array.from({ length: r }, () => Array.from({ length: c }, () => (Math.random() * 2 - 1) * scale));
}

function randVec(n, scale) {
  return Array.from({ length: n }, () => (Math.random() * 2 - 1) * scale);
}

/**
 * Tabula-rasa policy: sees observations + scores legal actions.
 * No card-effect priors. Learns online every finished game.
 */
class TabulaNet {
  constructor(saved = null) {
    this.kind = 'tabula';
    this.schemaVersion = TABULA_SCHEMA;
    this.inSize = OBS_SIZE;
    this.hidSize = TABULA_HID;
    this.embSize = TABULA_EMB;
    this.cardVocab = CARD_VOCAB;
    this.metaCount = META_COUNT;
    this.lr = 0.035;
    this.exploreRate = 0.18;
    this.gamesTrained = saved?.gamesTrained || 0;
    this.updatesCount = saved?.updatesCount || 0;
    this.championWinRate = saved?.championWinRate || 0; // rolling win%
    this.rewardBaseline = saved?.rewardBaseline || 0;
    this.lastWeightDelta = saved?.lastWeightDelta || 0;
    this.recentResults = saved?.recentResults ? [...saved.recentResults].slice(-200) : [];
    this.bestValRate = this.championWinRate;
    this.lastValSeq0Pct = saved?.lastValSeq0Pct ?? null;
    this.lastValDrawPct = saved?.lastValDrawPct ?? null;
    this.lastValLossPct = saved?.lastValLossPct ?? null;
    this.lastValAvgRounds = saved?.lastValAvgRounds ?? null;
    this.lastTrainAvgRounds = saved?.lastTrainAvgRounds ?? null;

    const ok = !!(
      saved && saved.schemaVersion === TABULA_SCHEMA && saved.kind === 'tabula' &&
      Array.isArray(saved.w1) && saved.w1.length === this.hidSize &&
      Array.isArray(saved.cardEmb) && saved.cardEmb.length === this.cardVocab &&
      Array.isArray(saved.metaEmb) && saved.metaEmb.length === this.metaCount &&
      Array.isArray(saved.wScore) && saved.wScore.length === (this.hidSize + this.embSize) &&
      Array.isArray(saved.wValue) && saved.wValue.length === this.hidSize
    );

    if (ok) {
      this.w1 = saved.w1.map(r => [...r]);
      this.b1 = [...saved.b1];
      this.cardEmb = saved.cardEmb.map(r => [...r]);
      this.metaEmb = saved.metaEmb.map(r => [...r]);
      this.wScore = [...saved.wScore];
      this.bScore = saved.bScore || 0;
      this.wValue = [...saved.wValue];
      this.bValue = saved.bValue || 0;
    } else {
      // Zero-mean random init — no action priors
      this.w1 = randMat(this.hidSize, this.inSize, 0.08);
      this.b1 = new Array(this.hidSize).fill(0);
      this.cardEmb = randMat(this.cardVocab, this.embSize, 0.05);
      this.metaEmb = randMat(this.metaCount, this.embSize, 0.05);
      this.wScore = randVec(this.hidSize + this.embSize, 0.04);
      this.bScore = 0;
      this.wValue = randVec(this.hidSize, 0.04);
      this.bValue = 0;
    }
    this.championSnapshot = this.serialize();
    this.bestValSnapshot = this.serialize();
  }

  serialize() {
    return {
      kind: 'tabula',
      schemaVersion: this.schemaVersion,
      w1: this.w1.map(r => [...r]),
      b1: [...this.b1],
      cardEmb: this.cardEmb.map(r => [...r]),
      metaEmb: this.metaEmb.map(r => [...r]),
      wScore: [...this.wScore],
      bScore: this.bScore,
      wValue: [...this.wValue],
      bValue: this.bValue,
      gamesTrained: this.gamesTrained,
      updatesCount: this.updatesCount,
      championWinRate: this.championWinRate,
      rewardBaseline: this.rewardBaseline,
      lastWeightDelta: this.lastWeightDelta,
      recentResults: [...this.recentResults].slice(-200),
      lastValSeq0Pct: this.lastValSeq0Pct,
      lastValDrawPct: this.lastValDrawPct,
      lastValLossPct: this.lastValLossPct,
      lastValAvgRounds: this.lastValAvgRounds,
      lastTrainAvgRounds: this.lastTrainAvgRounds
    };
  }

  loadSnapshot(snap) {
    if (!snap || snap.schemaVersion !== TABULA_SCHEMA || snap.kind !== 'tabula') return;
    const n = new TabulaNet(snap);
    this.w1 = n.w1; this.b1 = n.b1;
    this.cardEmb = n.cardEmb; this.metaEmb = n.metaEmb;
    this.wScore = n.wScore; this.bScore = n.bScore;
    this.wValue = n.wValue; this.bValue = n.bValue;
    this.gamesTrained = n.gamesTrained;
    this.updatesCount = n.updatesCount;
    this.championWinRate = n.championWinRate;
    this.rewardBaseline = n.rewardBaseline;
    this.recentResults = n.recentResults;
  }

  softUpdateFrom(other, alpha = 1) {
    if (!isTabulaNN(other)) return;
    const a = Math.max(0, Math.min(1, alpha));
    if (a >= 0.999) {
      this.loadSnapshot(other.serialize());
      return;
    }
    const blend = (dst, src) => {
      for (let i = 0; i < dst.length; i++) {
        if (Array.isArray(dst[i])) {
          for (let j = 0; j < dst[i].length; j++) dst[i][j] = (1 - a) * dst[i][j] + a * src[i][j];
        } else dst[i] = (1 - a) * dst[i] + a * src[i];
      }
    };
    blend(this.w1, other.w1);
    blend(this.b1, other.b1);
    blend(this.cardEmb, other.cardEmb);
    blend(this.metaEmb, other.metaEmb);
    for (let i = 0; i < this.wScore.length; i++) this.wScore[i] = (1 - a) * this.wScore[i] + a * other.wScore[i];
    this.bScore = (1 - a) * this.bScore + a * other.bScore;
    for (let i = 0; i < this.wValue.length; i++) this.wValue[i] = (1 - a) * this.wValue[i] + a * other.wValue[i];
    this.bValue = (1 - a) * this.bValue + a * other.bValue;
  }

  currentExplore() {
    // Decay exploration as experience grows, never to zero
    const g = this.gamesTrained || 0;
    return Math.max(0.05, this.exploreRate * Math.exp(-g / 8000));
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

  valueOf(h) {
    let s = this.bValue;
    for (let i = 0; i < this.hidSize; i++) s += this.wValue[i] * h[i];
    return Math.tanh(s);
  }

  scorePair(h, emb) {
    let s = this.bScore;
    for (let i = 0; i < this.hidSize; i++) s += this.wScore[i] * h[i];
    for (let i = 0; i < this.embSize; i++) s += this.wScore[this.hidSize + i] * emb[i];
    return s;
  }

  embCard(id) {
    const idx = id >= 0 && id < this.cardVocab ? id : 0;
    return this.cardEmb[idx];
  }

  embMeta(idx) {
    const i = Math.max(0, Math.min(this.metaCount - 1, idx | 0));
    return this.metaEmb[i];
  }

  _pickFromLogits(logits, explore) {
    const maxL = Math.max(...logits);
    const exps = logits.map(l => Math.exp(Math.max(-12, Math.min(12, l - maxL))));
    const sum = exps.reduce((a, b) => a + b, 0) || 1;
    const probs = exps.map(e => e / sum);
    let chosen = 0;
    if (explore > 0 && Math.random() < explore) {
      // On-policy categorical sample
      let r = Math.random(), acc = 0;
      chosen = probs.length - 1;
      for (let i = 0; i < probs.length; i++) {
        acc += probs[i];
        if (r <= acc) { chosen = i; break; }
      }
    } else {
      for (let i = 1; i < logits.length; i++) if (logits[i] > logits[chosen]) chosen = i;
    }
    return { chosen, probs };
  }

  /**
   * Choose among candidate cards using only state obs + card identity embeddings.
   * @param {Float32Array|number[]} obsOrStateFeatures - observation vector (OBS_SIZE)
   */
  selectCard(obs, candidates, trajectory = null, exploreRate = 0) {
    if (!candidates?.length) return null;
    if (candidates.length === 1) {
      if (trajectory) {
        const h = this.encode(obs);
        trajectory.push({
          mode: 'action', x: obs, h, embKind: 'card', embId: cardId(candidates[0]),
          probs: [1], chosenPos: 0, embIds: [cardId(candidates[0])], rStep: 0
        });
      }
      return candidates[0];
    }
    const h = this.encode(obs);
    const embIds = candidates.map(c => cardId(c));
    const logits = embIds.map(id => this.scorePair(h, this.embCard(id)));
    const { chosen, probs } = this._pickFromLogits(logits, exploreRate);
    if (trajectory) {
      trajectory.push({
        mode: 'action', x: obs, h, embKind: 'card', embId: embIds[chosen],
        probs, chosenPos: chosen, embIds, rStep: 0
      });
    }
    return candidates[chosen];
  }

  /** Binary meta decision (cast / chaos / …) via meta embedding vs null action. */
  actMeta(obs, metaIdx, trajectory = null, exploreRate = 0) {
    const h = this.encode(obs);
    const yes = this.scorePair(h, this.embMeta(metaIdx));
    const no = this.scorePair(h, this.embMeta((metaIdx + 4) % this.metaCount)) * 0.15; // weak baseline alt
    // Better: score yes vs learned "abstain" using a dedicated slot — use logit → bernoulli
    const logit = yes;
    const prob = 1 / (1 + Math.exp(-Math.max(-10, Math.min(10, logit))));
    const chosen = exploreRate > 0
      ? (Math.random() < (exploreRate * 0.5 + (1 - exploreRate) * prob) ? 1 : 0)
      : (prob >= 0.5 ? 1 : 0);
    if (trajectory) {
      trajectory.push({
        mode: 'meta', x: obs, h, metaIdx, prob, chosen, rStep: 0
      });
    }
    return chosen === 1;
  }

  selectTarget(obs, opponents, trajectory = null, exploreRate = 0) {
    if (!opponents?.length) return null;
    if (opponents.length === 1) return opponents[0];
    const h = this.encode(obs);
    // Encode opponent by public stats into a pseudo-embedding from meta slots + scalars in obs already;
    // score using a synthetic emb built from opp index (0..2) via metaEmb rotated
    const logits = opponents.slice(0, 3).map((_, i) => this.scorePair(h, this.embMeta(i % this.metaCount)));
    const { chosen, probs } = this._pickFromLogits(logits, exploreRate);
    if (trajectory) {
      trajectory.push({
        mode: 'action', x: obs, h, embKind: 'meta', embId: chosen,
        probs, chosenPos: chosen, embIds: opponents.slice(0, 3).map((_, i) => i), rStep: 0
      });
    }
    return opponents[chosen];
  }

  /** Record win/loss into rolling window and update championWinRate. */
  noteGameResult({ won, draw = false, rounds = null }) {
    const code = draw ? 0 : (won ? 1 : -1);
    this.recentResults.push(code);
    if (this.recentResults.length > 200) this.recentResults.shift();
    const played = this.recentResults.filter(r => r !== 0);
    const wins = played.filter(r => r === 1).length;
    this.championWinRate = played.length ? wins / played.length : 0;
    this.bestValRate = this.championWinRate;
    if (rounds != null && won) this.lastTrainAvgRounds = rounds;
    this.championSnapshot = this.serialize();
    this.bestValSnapshot = this.championSnapshot;
  }

  /**
   * Online A2C update from one game trajectory. Called every finished game.
   */
  trainEpisode(trajectory, terminalReward) {
    if (!trajectory?.length) {
      this.gamesTrained++;
      return;
    }
    this.rewardBaseline = this.rewardBaseline * 0.98 + terminalReward * 0.02;
    const gamma = 0.98;
    const T = trajectory.length;
    const returns = new Float32Array(T);
    let G = terminalReward;
    for (let t = T - 1; t >= 0; t--) {
      G = (trajectory[t].rStep || 0) + gamma * G;
      returns[t] = G;
    }

    const stepLr = this.lr / Math.max(6, Math.min(40, Math.sqrt(T) * 2.8));
    const criticLr = stepLr * 1.4;
    let sq = 0;

    for (let t = 0; t < T; t++) {
      const step = trajectory[t];
      const { x, h } = step;
      const vPred = this.valueOf(h);
      const adv = Math.max(-2, Math.min(2, returns[t] - vPred));
      const dH = new Float32Array(this.hidSize);

      // Critic
      const dV = adv * (1 - vPred * vPred);
      this.bValue += criticLr * dV;
      for (let i = 0; i < this.hidSize; i++) {
        dH[i] += 0.4 * dV * this.wValue[i];
        const nw = this.wValue[i] + criticLr * dV * h[i];
        sq += (nw - this.wValue[i]) ** 2;
        this.wValue[i] = Math.max(-3, Math.min(3, nw));
      }

      if (step.mode === 'meta') {
        const dOut = Math.max(-1, Math.min(1, (step.chosen - step.prob) * adv));
        this._backScore(h, this.embMeta(step.metaIdx), dOut, dH, stepLr, sq);
      } else if (step.mode === 'action' && step.probs && step.embIds) {
        for (let k = 0; k < step.embIds.length; k++) {
          const dScore = Math.max(-1, Math.min(1, ((k === step.chosenPos ? 1 : 0) - step.probs[k]) * adv));
          const emb = step.embKind === 'meta' ? this.embMeta(step.embIds[k]) : this.embCard(step.embIds[k]);
          this._backScore(h, emb, dScore, dH, stepLr, sq);
          // Update embedding itself
          const embRow = step.embKind === 'meta' ? this.metaEmb[step.embIds[k] % this.metaCount] : this.cardEmb[Math.max(0, step.embIds[k])];
          if (embRow) {
            for (let e = 0; e < this.embSize; e++) {
              const nw = embRow[e] + stepLr * dScore * this.wScore[this.hidSize + e];
              embRow[e] = Math.max(-2, Math.min(2, nw));
            }
          }
        }
      }

      // Hidden ← observation
      for (let i = 0; i < this.hidSize; i++) {
        const g = Math.max(-0.25, Math.min(0.25, stepLr * dH[i] * (1 - h[i] * h[i])));
        if (Math.abs(g) < 1e-7) continue;
        this.b1[i] = Math.max(-3, Math.min(3, this.b1[i] + g));
        const row = this.w1[i];
        for (let j = 0; j < this.inSize; j++) {
          const xv = x[j];
          if (xv) row[j] = Math.max(-3, Math.min(3, row[j] + g * xv));
        }
      }
    }

    this.lastWeightDelta = Math.sqrt(sq);
    this.gamesTrained++;
    this.updatesCount++;
    this.championSnapshot = this.serialize();
    this.bestValSnapshot = this.championSnapshot;
  }

  _backScore(h, emb, dScore, dH, lr, sqRef) {
    this.bScore = Math.max(-3, Math.min(3, this.bScore + lr * dScore));
    for (let i = 0; i < this.hidSize; i++) {
      dH[i] += dScore * this.wScore[i];
      const nw = this.wScore[i] + lr * dScore * h[i];
      this.wScore[i] = Math.max(-3, Math.min(3, nw));
    }
    for (let i = 0; i < this.embSize; i++) {
      const nw = this.wScore[this.hidSize + i] + lr * dScore * emb[i];
      this.wScore[this.hidSize + i] = Math.max(-3, Math.min(3, nw));
    }
  }

  // Compatibility shim names used by older call sites
  act(obs, headIdx, traj, explore) {
    return this.actMeta(obs, headIdx % this.metaCount, traj, explore);
  }
}

export { TabulaNet, extractObservation };
