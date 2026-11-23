class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }
  init() {
    if (this.muted) return;
    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) this.ctx = new AudioCtx();
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    } catch (_) {}
  }
  playTone(freq, duration = 0.14, type = 'sine', gainVal = 0.08, delay = 0) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(gainVal, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    } catch (_) {}
  }
  cardFlip() { this.playTone(520, 0.07, 'triangle', 0.05); }
  cardPlay() { this.playTone(340, 0.1, 'triangle', 0.07); this.playTone(460, 0.09, 'sine', 0.05, 0.03); }
  swordHit() { this.playTone(180, 0.18, 'sawtooth', 0.06); this.playTone(110, 0.22, 'square', 0.04, 0.05); }
  shieldBlock() { this.playTone(620, 0.14, 'triangle', 0.07); this.playTone(880, 0.18, 'sine', 0.06, 0.05); }
  chaosEvent() {
    this.playTone(146.8, 0.45, 'sawtooth', 0.06);
    this.playTone(220, 0.4, 'triangle', 0.05, 0.08);
    this.playTone(277.2, 0.5, 'sine', 0.06, 0.16);
  }
  ascend() {
    [440, 554.37, 659.25, 880].forEach((f, i) => this.playTone(f, 0.35, 'triangle', 0.07, i * 0.08));
  }
  digest() {
    this.playTone(587.3, 0.16, 'sine', 0.06);
    this.playTone(880, 0.25, 'sine', 0.07, 0.09);
  }
  error() { this.playTone(150, 0.18, 'sawtooth', 0.05); }
}
const sfx = new SoundEngine();

export { SoundEngine, sfx };
