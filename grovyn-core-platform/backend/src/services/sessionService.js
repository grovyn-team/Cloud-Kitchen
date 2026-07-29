/**
 * P1-04 — session token issuance/refresh/revocation.
 *
 * Token shape: a single opaque, high-entropy random value (32 bytes / 256
 * bits from `crypto.randomBytes`, base64url-encoded for transport). Only a
 * SHA-256 hash of it (`session.token_hash`) is ever stored — same discipline
 * as `password_hash`. Unlike a password, this token is machine-generated
 * with 256 bits of entropy, so a FAST cryptographic hash (SHA-256) is the
 * right tool here, not a slow password-hashing KDF: the token's security
 * comes from its entropy (astronomically infeasible to brute force even
 * against a fast hash), not from making guessing expensive. Reusing
 * argon2id here would only cost CPU on every authenticated request for no
 * additional protection.
 *
 * Session lifetime & refresh design (documented here per the task's
 * fast-mode directive -- no DECISIONS_LOG entry for this choice):
 *   - Each session has a single absolute expiry (`SESSION_TTL_MS`, 24h).
 *   - "Refresh" is an EXPLICIT client-initiated action (`POST
 *     /api/v1/auth/refresh`), not implicit sliding expiry on every request.
 *     Rejected alternative: extend `expires_at` on every authenticated
 *     request. That means a background write on every single API call
 *     (real cost at scale) and makes "session refreshed" indistinguishable
 *     from "session merely used" in the audit trail, when the task
 *     explicitly asks for "session refresh" as its own auditable event
 *     (item 9) -- which only makes sense as a distinct action.
 *   - Refresh ROTATES the token: `refreshSession` generates a brand-new
 *     random token and OVERWRITES `token_hash` + `expires_at` on the SAME
 *     session row (same `id`, so `staff_branch_access`/audit history keeps
 *     one stable session identity). The OLD token is immediately unusable
 *     (its hash no longer matches any row) the instant refresh succeeds --
 *     this bounds how long a leaked/stolen token stays valid to, at most,
 *     one refresh cycle, rather than the full 24h window every time.
 *   - Revocation (`revokeSession`, used by logout) sets `revoked_at` --
 *     soft-revoke, not a row delete, consistent with D-008/D-013's
 *     retention model (a revoked session stays reconstructable for
 *     incident forensics).
 */

import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { schema } from '../db/dal.js';

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * @param {ReturnType<import('../db/dal.js').createScopedDb>} db a tenant-
 *   scoped DAL instance (from `runInTenantContext`/`withTenantContext`).
 * @param {{ tenantId: string, userId: string }} params
 * @returns {Promise<{ sessionId: string, token: string, expiresAt: Date }>}
 */
export async function createSession(db, { tenantId, userId }) {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const [row] = await db
    .insert(schema.session)
    .values({ tenantId, userId, tokenHash, expiresAt })
    .returning({ id: schema.session.id });

  return { sessionId: row.id, token, expiresAt };
}

/**
 * Rotate an existing session's token in place (same row/id, new secret + new
 * expiry). Caller (the `/auth/refresh` handler) is responsible for having
 * already verified the session is valid (not expired/revoked) before calling
 * this.
 * @param {ReturnType<import('../db/dal.js').createScopedDb>} db
 * @param {string} sessionId
 * @returns {Promise<{ token: string, expiresAt: Date }>}
 */
export async function refreshSession(db, sessionId) {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db
    .update(schema.session)
    .set({ tokenHash, expiresAt })
    .where(eq(schema.session.id, sessionId));

  return { token, expiresAt };
}

/**
 * Soft-revoke a session (logout). Idempotent: revoking an already-revoked
 * session is a harmless no-op update.
 * @param {ReturnType<import('../db/dal.js').createScopedDb>} db
 * @param {string} sessionId
 */
export async function revokeSession(db, sessionId) {
  await db
    .update(schema.session)
    .set({ revokedAt: new Date() })
    .where(eq(schema.session.id, sessionId));
}
