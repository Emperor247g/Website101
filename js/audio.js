/**
 * Tiny synthesized sound kit. No audio files are needed: wooden clicks,
 * movement knocks and chimes are generated with WebAudio.
 */

export class SoundManager {
  constructor() {
    this.enabled = true;
    this.volume = 0.55;
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      this.stopAll();
    } else {
      this.unlock();
    }
  }

  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
  }

  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      this.ctx = new AudioContextClass();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this._createNoiseBuffer();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  stopAll() {
    if (this.master) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.015);
      const oldMaster = this.master;
      window.setTimeout(() => {
        if (this.master === oldMaster) {
          oldMaster.gain.value = this.volume;
        }
      }, 120);
    }
  }

  _createNoiseBuffer() {
    const duration = 0.7;
    const length = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.55 + white * 0.45;
      data[i] = last;
    }
    this.noiseBuffer = buffer;
  }

  _now() {
    return this.ctx.currentTime;
  }

  _tone({ freq = 440, endFreq = null, duration = 0.12, gain = 0.12, type = 'sine', when = 0 }) {
    if (!this.ctx || !this.enabled) return;
    const t = this._now() + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + duration);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.03);
  }

  _noise({ duration = 0.08, gain = 0.1, frequency = 1200, q = 0.8, when = 0, type = 'lowpass' }) {
    if (!this.ctx || !this.enabled || !this.noiseBuffer) return;
    const t = this._now() + when;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, t);
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(filter).connect(g).connect(this.master);
    source.start(t);
    source.stop(t + duration + 0.02);
  }

  ui() {
    this.unlock();
    this._noise({ duration: 0.035, gain: 0.028, frequency: 2500, when: 0, type: 'highpass' });
    this._tone({ freq: 760, endFreq: 540, duration: 0.045, gain: 0.025, type: 'triangle' });
  }

  select() {
    this.unlock();
    this._noise({ duration: 0.055, gain: 0.055, frequency: 1700, q: 1.4 });
    this._tone({ freq: 510, endFreq: 380, duration: 0.07, gain: 0.045, type: 'triangle' });
    this._tone({ freq: 1180, endFreq: 920, duration: 0.09, gain: 0.018, type: 'sine' });
  }

  move() {
    this.unlock();
    this._noise({ duration: 0.13, gain: 0.11, frequency: 780, q: 0.9 });
    this._tone({ freq: 158, endFreq: 78, duration: 0.15, gain: 0.14, type: 'sine' });
    this._tone({ freq: 330, endFreq: 210, duration: 0.08, gain: 0.03, type: 'triangle' });
  }

  capture() {
    this.unlock();
    this._noise({ duration: 0.07, gain: 0.16, frequency: 1900, q: 0.6 });
    this._noise({ duration: 0.16, gain: 0.1, frequency: 520, q: 1.1, when: 0.025 });
    this._tone({ freq: 210, endFreq: 70, duration: 0.19, gain: 0.19, type: 'sine' });
    this._tone({ freq: 880, endFreq: 430, duration: 0.08, gain: 0.035, type: 'square' });
  }

  promote() {
    this.unlock();
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, index) => {
      this._tone({
        freq,
        duration: 0.52,
        gain: 0.08,
        type: 'sine',
        when: index * 0.075,
      });
      this._tone({
        freq: freq * 2.01,
        duration: 0.3,
        gain: 0.018,
        type: 'triangle',
        when: index * 0.075,
      });
    });
    this._noise({ duration: 0.4, gain: 0.02, frequency: 5000, type: 'highpass' });
  }

  win() {
    this.unlock();
    const sequence = [392, 523.25, 659.25, 783.99, 1046.5];
    sequence.forEach((freq, index) => {
      this._tone({ freq, duration: 0.6, gain: 0.09, type: 'sine', when: index * 0.11 });
      this._tone({ freq: freq / 2, duration: 0.7, gain: 0.035, type: 'triangle', when: index * 0.11 });
    });
  }

  lose() {
    this.unlock();
    const sequence = [392, 349.23, 293.66, 220];
    sequence.forEach((freq, index) => {
      this._tone({ freq, endFreq: freq * 0.94, duration: 0.58, gain: 0.075, type: 'sine', when: index * 0.16 });
      this._tone({ freq: freq / 2, duration: 0.6, gain: 0.025, type: 'triangle', when: index * 0.16 });
    });
  }

  draw() {
    this.unlock();
    [329.63, 392, 329.63].forEach((freq, index) => {
      this._tone({ freq, duration: 0.42, gain: 0.055, type: 'sine', when: index * 0.15 });
    });
  }

  undo() {
    this.unlock();
    this._noise({ duration: 0.08, gain: 0.05, frequency: 900 });
    this._tone({ freq: 300, endFreq: 520, duration: 0.14, gain: 0.045, type: 'triangle' });
  }

  invalid() {
    this.unlock();
    this._tone({ freq: 120, endFreq: 92, duration: 0.13, gain: 0.06, type: 'sine' });
    this._noise({ duration: 0.08, gain: 0.025, frequency: 300 });
  }
}
