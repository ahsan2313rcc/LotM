import { extractBoardFeatures } from './features.js';

class LotmNeuralNet {
  constructor(saved = null) {
    this.inSize = 16;
    this.hidSize = 16;
    this.outSize = 8; // [0:draftMajor, 1:trickAggro, 2:abilityCast, 3:chaos, 4:gamble, 5:recklessAscend, 6:draftAscensionCard, 7:pouchTuck]
    this.lr = 0.45; // Strong per-episode step so alpha-blending (e.g. 0.01) creates real directional weight movement!
    this.epsilon = 0.15; // 15% exploration
    this.gamesTrained = saved?.gamesTrained || 0;
    this.championWinRate = saved?.championWinRate || 0;
    this.updatesCount = saved?.updatesCount || 0;
    this.lastWeightDelta = saved?.lastWeightDelta || 0;

    const validEasy = !!(
      saved && Array.isArray(saved.w1) && Array.isArray(saved.w2) && Array.isArray(saved.b1) && Array.isArray(saved.b2) &&
      saved.w1.length === this.hidSize && saved.b1.length === this.hidSize &&
      saved.w2.length === this.outSize && saved.b2.length === this.outSize &&
      saved.w1.every(r => Array.isArray(r) && r.length === this.inSize && r.every(Number.isFinite)) &&
      saved.w2.every(r => Array.isArray(r) && r.length === this.hidSize && r.every(Number.isFinite)) &&
      saved.b1.every(Number.isFinite) && saved.b2.every(Number.isFinite)
    );
    if (validEasy) {
      this.w1 = saved.w1.map(r => [...r]);
      this.b1 = [...saved.b1];
      this.w2 = saved.w2.map(r => [...r]);
      this.b2 = [...saved.b2];
    } else {
      const randMat = (r, c, scale) => Array.from({ length: r }, () => Array.from({ length: c }, () => (Math.random() * 2 - 1) * scale));
      this.w1 = randMat(this.hidSize, this.inSize, 0.35);
      this.b1 = new Array(this.hidSize).fill(0);
      this.w2 = randMat(this.outSize, this.hidSize, 0.35);
      this.b2 = [0, 0.3, 0.2, 0, -0.5, 0.55, 0.6, 0.75]; // Healthy priors for Easy NN (tuck, ascension draft, tempo ascend)
    }
    this.bestValRate = saved?.championWinRate || 0;
    this.championSnapshot = this.serialize();
    this.bestValSnapshot = this.serialize();
  }

  serialize() {
    return {
      w1: this.w1.map(r => [...r]),
      b1: [...this.b1],
      w2: this.w2.map(r => [...r]),
      b2: [...this.b2],
      gamesTrained: this.gamesTrained,
      championWinRate: this.championWinRate,
      updatesCount: this.updatesCount
    };
  }

  loadSnapshot(snap) {
    if (!snap || !snap.w2 || snap.w2.length !== this.outSize) return;
    this.w1 = snap.w1.map(r => [...r]);
    this.b1 = [...snap.b1];
    this.w2 = snap.w2.map(r => [...r]);
    this.b2 = [...snap.b2];
  }

  // Soft-update (EMA / Polyak): W_ref = (1 - alpha) * W_ref + alpha * W_challenger
  softUpdateFrom(challenger, alpha = 0.01) {
    const a = Math.max(0.0001, Math.min(1, Number(alpha) || 0.01));
    const keep = 1 - a;
    let sqDelta = 0;
    for (let i = 0; i < this.hidSize; i++) {
      const nb = keep * this.b1[i] + a * challenger.b1[i];
      sqDelta += (nb - this.b1[i]) ** 2;
      this.b1[i] = nb;
      for (let j = 0; j < this.inSize; j++) {
        const nw = keep * this.w1[i][j] + a * challenger.w1[i][j];
        sqDelta += (nw - this.w1[i][j]) ** 2;
        this.w1[i][j] = nw;
      }
    }
    for (let i = 0; i < this.outSize; i++) {
      const nb = keep * this.b2[i] + a * challenger.b2[i];
      sqDelta += (nb - this.b2[i]) ** 2;
      this.b2[i] = nb;
      for (let j = 0; j < this.hidSize; j++) {
        const nw = keep * this.w2[i][j] + a * challenger.w2[i][j];
        sqDelta += (nw - this.w2[i][j]) ** 2;
        this.w2[i][j] = nw;
      }
    }
    this.lastWeightDelta = Math.sqrt(sqDelta);
  }

  forward(x) {
    const h = new Array(this.hidSize);
    for (let i = 0; i < this.hidSize; i++) {
      let sum = this.b1[i];
      const row = this.w1[i];
      for (let j = 0; j < this.inSize; j++) sum += row[j] * x[j];
      h[i] = Math.tanh(sum);
    }
    const out = new Array(this.outSize);
    for (let i = 0; i < this.outSize; i++) {
      let sum = this.b2[i];
      const row = this.w2[i];
      for (let j = 0; j < this.hidSize; j++) sum += row[j] * h[j];
      out[i] = 1 / (1 + Math.exp(-Math.max(-10, Math.min(10, sum))));
    }
    return { h, out };
  }

  // Decide action probability: exploreRate = 0.15 in Training, 0 in Simulator & Live Play
  act(features, headIdx, trajectory = null, exploreRate = 0) {
    const { h, out } = this.forward(features);
    const prob = out[headIdx];
    const explore = exploreRate > 0 && Math.random() < exploreRate;
    const chosen = explore ? (Math.random() < 0.5 ? 1 : 0) : (prob >= 0.5 ? 1 : 0);
    if (trajectory) trajectory.push({ x: features, h, out, headIdx, chosen });
    return chosen === 1;
  }

  // Learn from a winning Heuristic AI's POV trajectory (imitation gradient descent)
  imitateTrajectory(trajectory, weight = 0.25) {
    if (!trajectory || trajectory.length === 0) return;
    const stepLr = (this.lr * weight) / Math.max(4, Math.sqrt(trajectory.length));
    for (const step of trajectory) {
      const { x, headIdx, chosen } = step;
      const { h, out } = this.forward(x);
      const dOut = (chosen - out[headIdx]);
      const dH = new Array(this.hidSize).fill(0);
      for (let j = 0; j < this.hidSize; j++) {
        dH[j] = dOut * this.w2[headIdx][j] * (1 - h[j] * h[j]);
        this.w2[headIdx][j] += stepLr * dOut * h[j];
      }
      this.b2[headIdx] += stepLr * dOut;
      for (let i = 0; i < this.hidSize; i++) {
        const g = stepLr * dH[i];
        if (Math.abs(g) < 1e-7) continue;
        this.b1[i] += g;
        const row = this.w1[i];
        for (let k = 0; k < this.inSize; k++) row[k] += g * x[k];
      }
    }
  }

  // Smoothed Policy Gradient with Running Advantage Baseline, Temporal Discounting (gamma=0.96), Clipping & L2 Decay
  trainEpisode(trajectory, reward) {
    if (!trajectory || trajectory.length === 0) return;
    this.rewardBaseline = (this.rewardBaseline ?? 0) * 0.95 + reward * 0.05;
    const adv = Math.max(-2, Math.min(2, reward - this.rewardBaseline));
    const gamma = 0.96;
    const T = trajectory.length;
    const stepLr = this.lr / Math.max(2, Math.min(12, T / 4));
    const decay = 0.9999;

    for (let t = 0; t < T; t++) {
      const { x, h, out, headIdx, chosen } = trajectory[t];
      const discAdv = adv * Math.pow(gamma, T - 1 - t);
      const dOut = Math.max(-1, Math.min(1, (chosen - out[headIdx]) * discAdv));
      const dH = new Array(this.hidSize).fill(0);
      for (let j = 0; j < this.hidSize; j++) {
        dH[j] = dOut * this.w2[headIdx][j] * (1 - h[j] * h[j]);
        this.w2[headIdx][j] = this.w2[headIdx][j] * decay + stepLr * dOut * h[j];
      }
      this.b2[headIdx] += stepLr * dOut;
      for (let i = 0; i < this.hidSize; i++) {
        const g = Math.max(-0.5, Math.min(0.5, stepLr * dH[i]));
        if (Math.abs(g) < 1e-7) continue;
        this.b1[i] += g;
        const row = this.w1[i];
        for (let k = 0; k < this.inSize; k++) row[k] = row[k] * decay + g * x[k];
      }
    }
    this.gamesTrained++;
  }
}

export { LotmNeuralNet };
