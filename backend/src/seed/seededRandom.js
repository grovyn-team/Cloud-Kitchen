/**
 * Deterministic pseudo-random number generator (Mulberry32).
 * Same seed => same sequence of numbers => same synthetic data every run.
 */

/**
 * @param {number} seed - Integer seed (e.g. 42). Must be fixed for reproducibility.
 * @returns {() => number} Function that returns next value in [0, 1)
 */
export function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    let t = (state += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {() => number} rng
 * @param {number} min - Inclusive
 * @param {number} max - Inclusive
 * @returns {number}
 */
export function int(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * @param {() => number} rng
 * @param {Array<T>} arr
 * @returns {T}
 * @template T
 */
export function pick(rng, arr) {
  return arr[int(rng, 0, arr.length - 1)];
}

/**
 * @param {() => number} rng
 * @param {number} min
 * @param {number} max
 * @param {number} [decimals]
 * @returns {number}
 */
export function float(rng, min, max, decimals = 2) {
  const v = min + rng() * (max - min);
  return decimals === 0 ? Math.round(v) : Number(v.toFixed(decimals));
}
