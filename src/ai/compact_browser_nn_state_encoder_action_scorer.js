/**
 * CompactAscentNet — Zero-dependency browser net (Small ~38K / Medium ~222K actor params).
 *
 * Topology (matches python_train/nets.py CandidatePolicy actor + fogged value):
 *   State Encoder : obsDim -> h1 (tanh) -> h2 (tanh)   Small: 180→128→64  Medium: 650→256→128
 *   Action Scorer : [h2 + actDim] -> actHid (tanh) -> 1 logit
 *   Value Critic  : h2 -> 1 (linear; same as PyTorch vf — CTDE critic stays train-only)
 *
 * Loads weights exported by python_train/ppo_train.py (format compact_ascent_v1).
 * PyTorch nn.Linear weight is [out, in] — same row-major layout used here.
 */

function randMatrix(rows, cols, scale) {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => (Math.random() * 2 - 1) * scale)
  );
}

function zeros(n) {
  return new Array(n).fill(0);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function isPolicyNet(net) {
  return !!(net && (net.kind === 'policy' || net.format === 'compact_ascent_v1' || typeof net.selectAction === 'function'));
}

export class CompactAscentNet {
  constructor(config = {}) {
    this.kind = 'policy';
    this.format = 'compact_ascent_v1';
    this.tier = config.tier || config.name || (config.obsDim > 180 ? 'medium' : 'small');
    this.obsDim = config.obsDim ?? 180;
    this.actDim = config.actDim ?? 32;
    this.h1Dim = config.h1Dim ?? 128;
    this.h2Dim = config.h2Dim ?? 64;
    this.actHidDim = config.actHidDim ?? 64;
    this.lr = config.lr ?? 3e-4;
    this.gamma = config.gamma ?? 0.99;
    this.clipEps = config.clipEps ?? 0.2;
    this.gamesTrained = config.gamesTrained ?? 0;
    this.championWinRate = config.championWinRate ?? 0;
    this.ascentScore = config.ascentScore ?? 0;

    if (config.weights) {
      this.loadWeights(config.weights);
    } else {
      const s1 = Math.sqrt(1 / this.obsDim);
      const s2 = Math.sqrt(1 / this.h1Dim);
      const sa = Math.sqrt(1 / (this.h2Dim + this.actDim));
      const sv = Math.sqrt(1 / this.h2Dim);
      this.w1 = randMatrix(this.h1Dim, this.obsDim, s1);
      this.b1 = zeros(this.h1Dim);
      this.w2 = randMatrix(this.h2Dim, this.h1Dim, s2);
      this.b2 = zeros(this.h2Dim);

      this.wa1 = randMatrix(this.actHidDim, this.h2Dim + this.actDim, sa);
      this.ba1 = zeros(this.actHidDim);
      this.wa2 = randMatrix(1, this.actHidDim, 0.05);
      this.ba2 = [0];

      this.wv = randMatrix(1, this.h2Dim, sv);
      this.bv = [0];
    }
  }

  encodeState(obs) {
    const h1 = new Float32Array(this.h1Dim);
    for (let i = 0; i < this.h1Dim; i++) {
      let sum = this.b1[i];
      const row = this.w1[i];
      for (let j = 0; j < this.obsDim; j++) {
        const xv = obs[j] || 0;
        if (xv !== 0) sum += row[j] * xv;
      }
      h1[i] = Math.tanh(sum);
    }

    const h2 = new Float32Array(this.h2Dim);
    for (let i = 0; i < this.h2Dim; i++) {
      let sum = this.b2[i];
      const row = this.w2[i];
      for (let j = 0; j < this.h1Dim; j++) sum += row[j] * h1[j];
      h2[i] = Math.tanh(sum);
    }

    let vRaw = this.bv[0];
    const rv = this.wv[0];
    for (let j = 0; j < this.h2Dim; j++) vRaw += rv[j] * h2[j];
    // Linear value — matches PyTorch CandidatePolicy.vf (no tanh wrap)
    return { h1, h2, vRaw, value: vRaw };
  }

  scoreAction(h2, actVec) {
    const ah = new Float32Array(this.actHidDim);
    for (let i = 0; i < this.actHidDim; i++) {
      let sum = this.ba1[i];
      const row = this.wa1[i];
      for (let j = 0; j < this.h2Dim; j++) sum += row[j] * h2[j];
      for (let k = 0; k < this.actDim; k++) {
        const av = actVec[k] || 0;
        if (av !== 0) sum += row[this.h2Dim + k] * av;
      }
      ah[i] = Math.tanh(sum);
    }
    let logit = this.ba2[0];
    const r2 = this.wa2[0];
    for (let j = 0; j < this.actHidDim; j++) logit += r2[j] * ah[j];
    return { logit: clamp(logit, -15, 15), ah };
  }

  /**
   * Choose one legal action from `actionVecs` (array of Float32Array/number[] of length `actDim`).
   * Set `stochastic = true` during self-play training, `false` for greedy live play.
   */
  selectAction(obs, actionVecs, { stochastic = false, temperature = 1.0, trajectory = null } = {}) {
    if (!actionVecs || actionVecs.length === 0) return { index: -1, prob: 1, value: 0 };
    if (actionVecs.length === 1) return { index: 0, prob: 1, value: this.encodeState(obs).value };

    const enc = this.encodeState(obs);
    const scored = actionVecs.map(av => this.scoreAction(enc.h2, av));
    const invT = 1 / Math.max(0.05, temperature);
    let maxL = -Infinity;
    for (const s of scored) if (s.logit * invT > maxL) maxL = s.logit * invT;

    const exps = scored.map(s => Math.exp(clamp(s.logit * invT - maxL, -20, 0)));
    const sumE = exps.reduce((a, b) => a + b, 0) || 1;
    const probs = exps.map(e => e / sumE);

    let chosenIdx = 0;
    if (stochastic) {
      let r = Math.random();
      let acc = 0;
      chosenIdx = probs.length - 1;
      for (let i = 0; i < probs.length; i++) {
        acc += probs[i];
        if (r <= acc) { chosenIdx = i; break; }
      }
    } else {
      for (let i = 1; i < probs.length; i++) {
        if (probs[i] > probs[chosenIdx]) chosenIdx = i;
      }
    }

    if (trajectory) {
      trajectory.push({
        obs: Float32Array.from(obs),
        actionVecs: actionVecs.map(av => Float32Array.from(av)),
        chosenIdx,
        oldProb: Math.max(1e-6, probs[chosenIdx]),
        value: enc.value,
        reward: 0
      });
    }

    return { index: chosenIdx, prob: probs[chosenIdx], probs, value: enc.value };
  }

  /**
   * Browser-side Masked PPO update on a completed episode trajectory.
   */
  trainTrajectoryPPO(trajectory, terminalReward, epochs = 2) {
    if (!trajectory || trajectory.length === 0) return;
    const T = trajectory.length;
    const returns = new Float32Array(T);
    const advs = new Float32Array(T);

    // GAE (lambda = 0.95)
    let gae = 0;
    for (let t = T - 1; t >= 0; t--) {
      const r = (trajectory[t].reward || 0) + (t === T - 1 ? terminalReward : 0);
      const nextV = t === T - 1 ? 0 : trajectory[t + 1].value;
      const delta = r + this.gamma * nextV - trajectory[t].value;
      gae = delta + this.gamma * 0.95 * gae;
      advs[t] = gae;
      returns[t] = gae + trajectory[t].value;
    }

    // Normalize advantages
    let meanA = 0;
    for (let t = 0; t < T; t++) meanA += advs[t];
    meanA /= T;
    let varA = 0;
    for (let t = 0; t < T; t++) varA += (advs[t] - meanA) ** 2;
    const stdA = Math.sqrt(varA / T + 1e-8);
    for (let t = 0; t < T; t++) advs[t] = clamp((advs[t] - meanA) / stdA, -3, 3);

    const stepLr = this.lr / Math.max(1, Math.sqrt(T / 16));
    const criticLr = stepLr * 1.5;

    for (let ep = 0; ep < epochs; ep++) {
      for (let t = 0; t < T; t++) {
        const st = trajectory[t];
        const enc = this.encodeState(st.obs);
        const scored = st.actionVecs.map(av => this.scoreAction(enc.h2, av));

        let maxL = -Infinity;
        for (const s of scored) if (s.logit > maxL) maxL = s.logit;
        const exps = scored.map(s => Math.exp(clamp(s.logit - maxL, -20, 0)));
        const sumE = exps.reduce((a, b) => a + b, 0) || 1;
        const probs = exps.map(e => e / sumE);

        const ratio = probs[st.chosenIdx] / st.oldProb;
        const adv = advs[t];
        const clipped =
          (adv > 0 && ratio > 1 + this.clipEps) ||
          (adv < 0 && ratio < 1 - this.clipEps);
        const pgScale = clipped ? 0 : clamp(ratio * adv, -2.5, 2.5);

        const dh2 = new Float32Array(this.h2Dim);

        // 1. Critic gradient (linear value head)
        const vErr = clamp(returns[t] - enc.value, -2, 2);
        const dVRaw = vErr;
        this.bv[0] = clamp(this.bv[0] + criticLr * dVRaw, -4, 4);
        for (let j = 0; j < this.h2Dim; j++) {
          dh2[j] += 0.5 * dVRaw * this.wv[0][j];
          this.wv[0][j] = clamp(this.wv[0][j] + criticLr * dVRaw * enc.h2[j], -4, 4);
        }

        // 2. Actor gradient across all legal candidates
        if (pgScale !== 0) {
          for (let k = 0; k < scored.length; k++) {
            const dLogit = clamp(((k === st.chosenIdx ? 1 : 0) - probs[k]) * pgScale, -1.5, 1.5);
            const ah = scored[k].ah;
            const av = st.actionVecs[k];
            this.ba2[0] = clamp(this.ba2[0] + stepLr * dLogit, -4, 4);
            for (let i = 0; i < this.actHidDim; i++) {
              const dAh = dLogit * this.wa2[0][i] * (1 - ah[i] * ah[i]);
              this.wa2[0][i] = clamp(this.wa2[0][i] + stepLr * dLogit * ah[i], -4, 4);
              this.ba1[i] = clamp(this.ba1[i] + stepLr * dAh, -4, 4);
              const row = this.wa1[i];
              for (let j = 0; j < this.h2Dim; j++) {
                dh2[j] += dAh * row[j];
                row[j] = clamp(row[j] + stepLr * dAh * enc.h2[j], -4, 4);
              }
              for (let m = 0; m < this.actDim; m++) {
                if (av[m] !== 0) row[this.h2Dim + m] = clamp(row[this.h2Dim + m] + stepLr * dAh * av[m], -4, 4);
              }
            }
          }
        }

        // 3. Backprop through State Encoder (h2 -> h1 -> obs)
        const dh1 = new Float32Array(this.h1Dim);
        for (let i = 0; i < this.h2Dim; i++) {
          const g2 = clamp(dh2[i] * (1 - enc.h2[i] * enc.h2[i]), -0.5, 0.5);
          this.b2[i] = clamp(this.b2[i] + stepLr * g2, -4, 4);
          const row = this.w2[i];
          for (let j = 0; j < this.h1Dim; j++) {
            dh1[j] += g2 * row[j];
            row[j] = clamp(row[j] + stepLr * g2 * enc.h1[j], -4, 4);
          }
        }
        for (let i = 0; i < this.h1Dim; i++) {
          const g1 = clamp(dh1[i] * (1 - enc.h1[i] * enc.h1[i]), -0.5, 0.5);
          if (Math.abs(g1) < 1e-6) continue;
          this.b1[i] = clamp(this.b1[i] + stepLr * g1, -4, 4);
          const row = this.w1[i];
          for (let j = 0; j < this.obsDim; j++) {
            const xv = st.obs[j];
            if (xv !== 0) row[j] = clamp(row[j] + stepLr * g1 * xv, -4, 4);
          }
        }
      }
    }
    this.gamesTrained++;
  }

  serialize() {
    return {
      format: 'compact_ascent_v1',
      kind: 'policy',
      tier: this.tier,
      obsDim: this.obsDim,
      actDim: this.actDim,
      h1Dim: this.h1Dim,
      h2Dim: this.h2Dim,
      actHidDim: this.actHidDim,
      gamesTrained: this.gamesTrained,
      championWinRate: this.championWinRate || 0,
      ascentScore: this.ascentScore || 0,
      weights: {
        w1: this.w1, b1: this.b1,
        w2: this.w2, b2: this.b2,
        wa1: this.wa1, ba1: this.ba1,
        wa2: this.wa2, ba2: this.ba2,
        wv: this.wv, bv: this.bv
      }
    };
  }

  loadWeights(w) {
    if (!w?.w1 || !w?.wa1) throw new Error('compact_ascent_v1 weights missing w1/wa1');
    this.w1 = w.w1.map(r => [...r]); this.b1 = [...w.b1];
    this.w2 = w.w2.map(r => [...r]); this.b2 = [...w.b2];
    this.wa1 = w.wa1.map(r => [...r]); this.ba1 = [...w.ba1];
    this.wa2 = w.wa2.map(r => [...r]); this.ba2 = [...w.ba2];
    this.wv = w.wv.map(r => [...r]); this.bv = [...w.bv];
  }

  loadSnapshot(snap) {
    if (!snap) return;
    if (snap.weights) this.loadWeights(snap.weights);
    if (snap.gamesTrained != null) this.gamesTrained = snap.gamesTrained;
    if (snap.championWinRate != null) this.championWinRate = snap.championWinRate;
    if (snap.ascentScore != null) this.ascentScore = snap.ascentScore;
    if (snap.tier) this.tier = snap.tier;
  }

  static fromJSON(json) {
    return new CompactAscentNet({
      tier: json.tier || json.name,
      obsDim: json.obsDim,
      actDim: json.actDim,
      h1Dim: json.h1Dim,
      h2Dim: json.h2Dim,
      actHidDim: json.actHidDim,
      gamesTrained: json.gamesTrained || 0,
      championWinRate: json.championWinRate || 0,
      ascentScore: json.ascentScore || 0,
      weights: json.weights
    });
  }
}