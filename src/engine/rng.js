// Deterministic PRNG (mulberry32). The engine keeps the PRNG state inside the
// game state so every client that replays the same actions computes the same
// randomness, and unit tests are reproducible.

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Advance the numeric rng state once and return {value in [0,1), nextState}.
export function nextRand(state) {
  let a = state | 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, nextState: a };
}

// Draw a random integer in [0, n) against a mutable holder {state}.
export function randInt(holder, n) {
  const { value, nextState } = nextRand(holder.state);
  holder.state = nextState;
  return Math.floor(value * n);
}

export function shuffled(holder, array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(holder, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function newSeed() {
  return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) | 0;
}
