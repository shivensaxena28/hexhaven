// Subtle sound effects synthesized with the Web Audio API — no audio assets
// needed, and everything stays original. Muting is remembered per device.

let ctx = null;
let muted = localStorage.getItem('hexhaven:muted') === '1';

export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  localStorage.setItem('hexhaven:muted', m ? '1' : '0');
}

function audio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone({ freq = 440, dur = 0.12, type = 'sine', gain = 0.08, when = 0, slide = 0 }) {
  if (muted) return;
  try {
    const ac = audio();
    const t0 = ac.currentTime + when;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch { /* audio unavailable */ }
}

export const sounds = {
  dice() {
    tone({ freq: 2200, dur: 0.03, type: 'square', gain: 0.03 });
    tone({ freq: 1800, dur: 0.03, type: 'square', gain: 0.03, when: 0.06 });
    tone({ freq: 2600, dur: 0.04, type: 'square', gain: 0.03, when: 0.12 });
  },
  build() {
    tone({ freq: 220, dur: 0.09, type: 'triangle', gain: 0.1 });
    tone({ freq: 330, dur: 0.12, type: 'triangle', gain: 0.08, when: 0.07 });
  },
  gain() {
    tone({ freq: 660, dur: 0.1, gain: 0.05 });
    tone({ freq: 880, dur: 0.14, gain: 0.05, when: 0.08 });
  },
  robber() {
    tone({ freq: 160, dur: 0.3, type: 'sawtooth', gain: 0.05, slide: -60 });
  },
  chat() {
    tone({ freq: 990, dur: 0.06, gain: 0.03 });
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.22, gain: 0.07, when: i * 0.13 }));
  },
};

// Fire the right sound for a new log entry.
export function soundForLog(entry) {
  switch (entry.t) {
    case 'roll': return sounds.dice();
    case 'road': case 'settlement': case 'city': case 'buy-dev': return sounds.build();
    case 'gain': return sounds.gain();
    case 'robber': case 'monopoly': return sounds.robber();
    case 'win': return sounds.win();
    default: return undefined;
  }
}
