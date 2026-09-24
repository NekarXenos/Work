/* ============================================================
   Spectrum · audio.js
   Two jobs: BEEP for the BASIC session, and a sample queue for
   the emulated machine's beeper and AY. Nothing starts until the
   visitor actually interacts, because browsers insist on it.
   ============================================================ */

export const SAMPLE_RATE = 44100;

export class Sound {
  constructor() {
    this.ctx = null;
    this.gain = null;
    this.node = null;
    this.ring = new Float32Array(SAMPLE_RATE);   // a second of slack
    this.wp = 0; this.rp = 0;
    this.enabled = true;
    this.volume = 0.22;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC({ sampleRate: SAMPLE_RATE });
    this.gain = this.ctx.createGain();
    this.gain.gain.value = this.volume;
    this.gain.connect(this.ctx.destination);
    return this.ctx;
  }
  /* the streaming half, used while a machine is running */
  startStream() {
    if (this.node || !this.ensure()) return;
    const n = this.ctx.createScriptProcessor(1024, 0, 1);
    n.onaudioprocess = e => {
      const out = e.outputBuffer.getChannelData(0);
      const avail = (this.wp - this.rp + this.ring.length) % this.ring.length;
      if (avail < out.length) { out.fill(0); return; }
      for (let i = 0; i < out.length; i++) {
        out[i] = this.ring[this.rp];
        this.rp = (this.rp + 1) % this.ring.length;
      }
    };
    n.connect(this.gain);
    this.node = n;
  }
  stopStream() {
    if (!this.node) return;
    this.node.disconnect(); this.node.onaudioprocess = null; this.node = null;
    this.wp = this.rp = 0;
  }
  push(samples, count) {
    if (!this.enabled || !this.node) return;
    /* never let the queue grow past a tenth of a second */
    const avail = (this.wp - this.rp + this.ring.length) % this.ring.length;
    if (avail > SAMPLE_RATE / 10) return;
    for (let i = 0; i < count; i++) {
      this.ring[this.wp] = samples[i];
      this.wp = (this.wp + 1) % this.ring.length;
    }
  }
  /* BEEP d, p — the BASIC statement, straight off an oscillator */
  beep(dur, pitch) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const f = 440 * Math.pow(2, (pitch - 9) / 12);
    if (!isFinite(f) || f <= 0 || f > 20000) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = f;
    const t = ctx.currentTime;
    const d = Math.max(0.01, Math.min(10, dur));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(this.volume * 0.8, t + 0.004);
    g.gain.setValueAtTime(this.volume * 0.8, t + d - 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(this.gain);
    o.start(t); o.stop(t + d + 0.02);
  }
  setVolume(v) { this.volume = v; if (this.gain) this.gain.gain.value = v; }
  mute(on) { this.enabled = !on; if (this.gain) this.gain.gain.value = on ? 0 : this.volume; }
}

/* ------------------------------------------------------------
   AY-3-8912, as fitted to the 128K and +2
   ------------------------------------------------------------ */
const AY_CLOCK = 1773400;
export class AY {
  constructor(rate = SAMPLE_RATE) {
    this.rate = rate;
    this.reg = new Uint8Array(16);
    this.sel = 0;
    this.count = [0, 0, 0];
    this.tone = [0, 0, 0];
    this.noiseCount = 0; this.noise = 1; this.noiseOut = 0;
    this.envCount = 0; this.envStep = 0; this.envVol = 0; this.envHold = false;
    this.step = AY_CLOCK / 8 / rate;    // AY steps at clock/8 per tone tick
    this.acc = 0;
  }
  write(v) {
    const r = this.sel & 15;
    this.reg[r] = v;
    if (r === 13) { this.envStep = 0; this.envHold = false; this.envCount = 0; }
  }
  read() { return this.reg[this.sel & 15]; }
  static VOL = (() => {
    const v = new Float32Array(16);
    for (let i = 0; i < 16; i++) v[i] = i === 0 ? 0 : Math.pow(2, (i - 15) / 2) * 0.33;
    return v;
  })();
  envelope() {
    const shape = this.reg[13] & 15;
    const cont = shape & 8, att = shape & 4, alt = shape & 2, hold = shape & 1;
    let s = this.envStep;
    if (!cont) { if (s > 15) { this.envHold = true; return 0; } return att ? s : 15 - s; }
    if (s > 15) {
      if (hold) { this.envHold = true; const last = alt ? (att ? 0 : 15) : (att ? 15 : 0); return last; }
      s &= 15;
      this.envStep = s;
      if (alt) this.envInvert = !this.envInvert;
    }
    let v = att ? s : 15 - s;
    if (alt && this.envInvert) v = 15 - v;
    return v;
  }
  /* one sample, mixing the three channels */
  sample() {
    const r = this.reg;
    for (let c = 0; c < 3; c++) {
      let period = (r[c * 2] | ((r[c * 2 + 1] & 15) << 8)) || 1;
      this.count[c] += this.step;
      while (this.count[c] >= period) { this.count[c] -= period; this.tone[c] ^= 1; }
    }
    let np = (r[6] & 31) || 1;
    this.noiseCount += this.step / 2;
    while (this.noiseCount >= np) {
      this.noiseCount -= np;
      const bit = ((this.noise ^ (this.noise >> 3)) & 1);
      this.noise = (this.noise >> 1) | (bit << 16);
      this.noiseOut = this.noise & 1;
    }
    const ep = ((r[11] | (r[12] << 8)) || 1) * 16;
    if (!this.envHold) {
      this.envCount += this.step;
      while (this.envCount >= ep) { this.envCount -= ep; this.envStep++; }
    }
    const env = this.envelope();
    const mix = r[7];
    let out = 0;
    for (let c = 0; c < 3; c++) {
      const toneOn = !(mix & (1 << c)), noiseOn = !(mix & (8 << c));
      const lvl = r[8 + c];
      const amp = (lvl & 16) ? AY.VOL[env] : AY.VOL[lvl & 15];
      const on = (toneOn ? this.tone[c] : 1) & (noiseOn ? this.noiseOut : 1);
      out += on ? amp : 0;
    }
    return out / 3;
  }
}
