# CRITIQUE 004 — D-006: Deployment (Docker/Dokploy, long-lived pool)

**Verdict: Endorse with changes — Significant.**

## 1. The decision, restated
The runtime/pool model — which *unblocks* D-002 (ORM) and D-001's RLS pooling
strategy — more than a hosting-vendor choice. Reverses the repo's Vercel/Netlify
demo residue.

## 2. Goal alignment
Infrastructure serving **O2/O4** — persistence and RLS both need a stable pool.
Legitimate: it names the capability it unblocks.

## 3. Strongest case for
A long-lived Postgres pool is right for Prisma *and* for RLS-via-`SET LOCAL`
(stable transaction-scoped connections); self-hosting kills the serverless
connection-storm the phase plan flagged; and it ends the Vercel/Netlify
ambiguity.

## 4. Strongest case against
Self-hosting shifts real ops burden — backups, TLS, Postgres patching,
monitoring, retention storage lifecycle — onto the team that a managed platform
would absorb. A single box is a single point of failure for O1's "one screen,
always up."

## 5. The cost nobody mentioned
**Backups/DR for 6-year financial retention (D-008) is now the team's problem**
and nobody owns it. The O4 compliance claim is hollow without a *tested* restore.

## 6. Reversibility
App layer is mostly **two-way** (12-factor runs anywhere) if platform specifics
don't leak. The self-host-vs-managed *ops* decision is stickier once real data +
backups live on the box.

## 7. What would have to be true for this to be wrong
That managed Postgres + a managed platform would better serve an enterprise
buyer's residency/ops expectations. Revisit if a client contractually requires it.

## 8. Required changes
1. Add **P7-02**: backup / restore / offsite DR for the retention obligation,
   with a **named human owner**.
2. **Delete the Vercel/Netlify residue** in the same change — one deployment
   story, not two.
3. Run the **P1-00 spike**: the long-lived pool makes Prisma safe, but
   RLS-through-Prisma plumbing still argues for seriously evaluating Drizzle.
