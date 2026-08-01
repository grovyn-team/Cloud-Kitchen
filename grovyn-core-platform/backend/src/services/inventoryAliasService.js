/**
 * Integration Task 1 (round 3) — resolves a free-text item name (from a
 * CSV/POS export) to a real `inventory_item` for a branch, via
 * `inventory_item_alias` (exact match, case-insensitive/trimmed) falling
 * back to an exact case-insensitive match on `inventory_item.name` itself
 * (every existing item was seeded an alias of its own name by migration
 * 0016, so in practice these two paths converge for pre-existing items --
 * the fallback exists for an item created without a matching alias row,
 * e.g. via a future path that doesn't call `createAlias` below).
 *
 * Every exported function here takes a tenant-scoped `db`
 * (`../db/dal.js`'s `createScopedDb`) -- RLS confines both tables to the
 * caller's own tenant.
 */

import { and, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';
import { schema } from '../db/dal.js';
import { sanitizeCsvCell } from './csvSanitize.js';

const MAX_ALIAS_LENGTH = 200;

/**
 * Batch-resolves a list of item names (deduplicated internally) for one
 * branch in a small, fixed number of queries -- NOT one query per name, since
 * a CSV import can carry thousands of rows referencing a handful of
 * distinct item names.
 * @param {*} db
 * @param {{branchId: string, itemNames: string[]}} args
 * @returns {Promise<{resolved: Map<string,string>, unmatched: string[]}>}
 *   `resolved` maps the ORIGINAL (not lowercased) name string as it appeared
 *   in the input to the resolved `inventory_item.id`. `unmatched` lists the
 *   distinct input names (original casing) that resolved to nothing.
 */
export async function resolveItemsForBranch(db, { branchId, itemNames }) {
  const distinctNames = [...new Set(itemNames.map((n) => n.trim()).filter(Boolean))];
  if (distinctNames.length === 0) return { resolved: new Map(), unmatched: [] };

  const lowerToOriginal = new Map();
  for (const name of distinctNames) {
    lowerToOriginal.set(name.toLowerCase(), name);
  }
  const lowerNames = [...lowerToOriginal.keys()];

  // Alias match first (exact, case-insensitive) -- this is the primary
  // resolution path a tenant is expected to use once they've mapped their
  // POS export's naming onto their real catalog.
  const aliasRows = await db
    .select({ aliasName: schema.inventoryItemAlias.aliasName, inventoryItemId: schema.inventoryItemAlias.inventoryItemId })
    .from(schema.inventoryItemAlias)
    .where(and(eq(schema.inventoryItemAlias.branchId, branchId), inArray(sql`lower(${schema.inventoryItemAlias.aliasName})`, lowerNames)));

  const resolved = new Map();
  for (const row of aliasRows) {
    const original = lowerToOriginal.get(row.aliasName.toLowerCase());
    if (original) resolved.set(original, row.inventoryItemId);
  }

  const stillUnresolvedLower = lowerNames.filter((n) => !resolved.has(lowerToOriginal.get(n)));
  if (stillUnresolvedLower.length > 0) {
    // Fallback: exact case-insensitive match on the item's own name.
    const itemRows = await db
      .select({ name: schema.inventoryItem.name, id: schema.inventoryItem.id })
      .from(schema.inventoryItem)
      .where(
        and(
          eq(schema.inventoryItem.branchId, branchId),
          isNull(schema.inventoryItem.deletedAt),
          inArray(sql`lower(${schema.inventoryItem.name})`, stillUnresolvedLower)
        )
      );
    for (const row of itemRows) {
      const original = lowerToOriginal.get(row.name.toLowerCase());
      if (original && !resolved.has(original)) resolved.set(original, row.id);
    }
  }

  const unmatched = distinctNames.filter((n) => !resolved.has(n));
  return { resolved, unmatched };
}

/**
 * The branch's full active item list (id + name) -- returned alongside an
 * unmatched-name import error so the user can see what's actually in their
 * catalog and either fix the file or add an alias for one of these ids
 * directly from the error screen, rather than guessing.
 * @param {*} db
 * @param {string} branchId
 * @returns {Promise<{id:string, name:string}[]>}
 */
export async function listAvailableItems(db, branchId) {
  const rows = await db
    .select({ id: schema.inventoryItem.id, name: schema.inventoryItem.name })
    .from(schema.inventoryItem)
    .where(and(eq(schema.inventoryItem.branchId, branchId), isNull(schema.inventoryItem.deletedAt)))
    .orderBy(schema.inventoryItem.name);
  return rows;
}

/**
 * Validate + normalize a `POST /api/v1/inventory/aliases` request body.
 * `inventoryItemId` ownership (belongs to this branch/tenant) is the
 * route's job (needs `db`), same split every other module uses.
 * @returns {{ok:true, value:{aliasName:string}}|{ok:false, errors:string[]}}
 */
export function validateCreateAliasInput(body) {
  const errors = [];
  const b = body && typeof body === 'object' ? body : {};

  const aliasName = typeof b.aliasName === 'string' ? b.aliasName.trim() : '';
  if (!aliasName) errors.push('aliasName is required.');
  else if (aliasName.length > MAX_ALIAS_LENGTH) errors.push(`aliasName must be at most ${MAX_ALIAS_LENGTH} characters.`);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { aliasName: sanitizeCsvCell(aliasName) } };
}

/**
 * Insert one alias in the CURRENT request transaction. Caller has already
 * confirmed `inventoryItemId` belongs to this branch/tenant and `branchId`
 * belongs to this tenant (same two-check discipline every branch-scoped
 * write in this codebase uses).
 */
export async function createAlias(db, { tenantId, branchId, inventoryItemId, aliasName }) {
  const [alias] = await db
    .insert(schema.inventoryItemAlias)
    .values({ tenantId, branchId, inventoryItemId, aliasName })
    .returning();
  return alias;
}

/**
 * RLS-scoped lookup, used by the alias-create route to confirm a real
 * duplicate-alias conflict (unique index violation) vs. some other insert
 * failure, so the route can return a clear 409 instead of a generic 500.
 */
export async function findAliasByBranchAndName(db, { branchId, aliasName }) {
  const [alias] = await db
    .select()
    .from(schema.inventoryItemAlias)
    .where(and(eq(schema.inventoryItemAlias.branchId, branchId), ilike(schema.inventoryItemAlias.aliasName, aliasName)))
    .limit(1);
  return alias || null;
}

export function serializeAlias(alias) {
  return {
    id: alias.id,
    branchId: alias.branchId,
    inventoryItemId: alias.inventoryItemId,
    aliasName: alias.aliasName,
    createdAt: alias.createdAt,
  };
}
