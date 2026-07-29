/**
 * P2-05 backend (2026-07-30) — extracted from `saleService.js`'s original
 * `branchExistsInTenant`, verbatim logic, moved here so the Inventory module
 * (`inventoryService.js`) can reuse the exact same tenant-ownership check
 * instead of re-implementing it. `saleService.js` re-exports the same
 * function under its original name so no existing call site
 * (`routes/sales.js`, `tests/sales.pgtest.mjs`) needed to change. This is a
 * pure relocation, not a behavior change -- "don't duplicate logic if you
 * can extract it, but don't over-refactor Sales' code either" per this
 * task's own instruction, so nothing else in `saleService.js` was touched.
 *
 * Defense-in-depth, application-layer closure of a real schema gap
 * (documented originally in `saleService.js`, carried forward here):
 * `sale.branch_id` / `inventory_item.branch_id` / every other Phase-2/3/3.5/6
 * table's `branch_id` are composite `(branch_id, tenant_id)` FKs against
 * `branch(id, tenant_id)` as of `drizzle/0009_lovely_morgan_stark.sql` (DBA
 * follow-up), which closes the write-time gap -- but this function is a
 * SEPARATE, still-needed check: it confirms a client-supplied `branchId`
 * belongs to the CALLER'S tenant via a query RLS itself scopes, so an ADMIN
 * can't reference another tenant's real branch id in a write just because
 * `isBranchAllowed()` alone returns `true` unconditionally for any ADMIN
 * regardless of which tenant actually owns `branchId` (RLS on `branch`
 * transparently confines the result to the caller's own tenant -- a foreign
 * tenant's branch id returns zero rows here, exactly as if it didn't exist).
 * **Every handler that accepts a client-supplied `branchId` calls this in
 * addition to `isBranchAllowed`, for every role, not just STAFF.**
 */
import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '../db/dal.js';

export async function branchExistsInTenant(db, branchId) {
  const [row] = await db
    .select({ id: schema.branch.id })
    .from(schema.branch)
    .where(and(eq(schema.branch.id, branchId), isNull(schema.branch.deletedAt)))
    .limit(1);
  return Boolean(row);
}
