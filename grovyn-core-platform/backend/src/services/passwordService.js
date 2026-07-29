/**
 * P1-04 — password hashing (argon2id) + the timing-oracle mitigation
 * CRITIQUE 017 requires as a non-optional forward spec on D-015.
 *
 * CRITIQUE 017's finding: `authenticate_lookup` (D-015) is a plain indexed
 * lookup — sub-millisecond whether it finds a row or not. Verifying a
 * password with argon2id is deliberately slow (tens of milliseconds, by
 * design — that's what makes offline brute-forcing a stolen hash expensive).
 * If a login handler only calls `argon2.verify()` on the "user found" path,
 * the two failure cases ("no such user" vs "wrong password for a real user")
 * take measurably different wall-clock time — a classic timing side channel
 * that lets an attacker enumerate valid staff emails one probe at a time
 * without ever seeing a different HTTP status or response body.
 *
 * Fix: `dummyVerify()` performs a REAL argon2id verify against a fixed decoy
 * hash on every failure path that did not already perform a real verify
 * (tenant not found, user not found) so the dominant cost (the argon2id
 * computation itself) is paid on every login attempt, hit or miss. This does
 * not make timing PERFECT — a wrong-password attempt still does one extra DB
 * round trip more than a bad-tenant-slug attempt — but it closes the actual
 * finding (0ms miss vs tens-of-ms hit), because DB round trips on localhost/
 * same-DC Postgres are sub-millisecond compared to argon2id's tens of
 * milliseconds, which now runs on every path. Verified for real in
 * `tests/auth.pgtest.mjs` (bounded response-time delta across the three
 * failure branches, not just "a dummy verify call exists in the code").
 */

import argon2 from 'argon2';
import crypto from 'crypto';

const ARGON2_OPTS = { type: argon2.argon2id };

/**
 * Hash a plaintext password for storage in `user.password_hash`. Never store
 * or log the plaintext itself anywhere else in the codebase.
 * @param {string} plaintext
 * @returns {Promise<string>} an encoded argon2id hash (algorithm + params +
 *   salt + digest, self-describing — `argon2.verify` doesn't need the
 *   original options passed back in).
 */
export function hashPassword(plaintext) {
  return argon2.hash(plaintext, ARGON2_OPTS);
}

/**
 * @param {string} hash a stored `user.password_hash` value.
 * @param {string} plaintext the attempted password.
 * @returns {Promise<boolean>}
 */
export function verifyPassword(hash, plaintext) {
  return argon2.verify(hash, plaintext);
}

// Fixed decoy hash for the timing-oracle mitigation. Computed once at module
// load (top-level await; Node 20+ ESM supports this) from a random value that
// is never a real credential and is never compared against anything — its
// only job is to give `dummyVerify()` a real argon2id hash to run the same
// class of computation against on every failure path. Recomputing it per
// process start (rather than a hardcoded literal committed to the repo) means
// there is no risk of ever being mistaken for -- or reused as -- an actual
// account's hash.
const DECOY_HASH = await argon2.hash(crypto.randomBytes(32).toString('hex'), ARGON2_OPTS);

/**
 * Run a real argon2id verify against a fixed decoy hash, discarding the
 * (always-false, by construction -- the decoy plaintext is re-randomized
 * per call so it can never accidentally match) result. Call this on every
 * login failure path that did NOT already call `verifyPassword` for real,
 * so every path through login pays the same dominant cost.
 * @returns {Promise<void>}
 */
export async function dummyVerify() {
  await argon2.verify(DECOY_HASH, crypto.randomBytes(16).toString('hex'));
}
