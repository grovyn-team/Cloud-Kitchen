/**
 * Demo-data seeder — populates ONE demo tenant with realistic data across
 * every module, so every page in the frontend has something meaningful on
 * it. Goes through the REAL service layer (`../src/services/*.js`) for
 * everything a request would normally exercise -- validation, the sales ->
 * inventory decrement path, alias resolution, low-stock notification
 * triggers -- so a bug in seeding is a bug in the product, not a script
 * shortcut hiding one.
 *
 * The two things that structurally CANNOT go through the service layer (raw
 * SQL instead, via the BYPASSRLS migrator connection): the tenant row itself
 * and its first bootstrap ADMIN. Same precedent as `seed-pgtest-fixtures.mjs`
 * -- there is no tenant context to run a service call under before a
 * tenant/admin exist (RLS's `tenant_self_access` policy on the `tenant`
 * table itself requires `app.current_tenant` to already equal the row being
 * read/written). Every other write in this script runs under
 * `runInTenantContext` against the real `grovyn_app` pool, calling the same
 * service functions `routes/*.js` call.
 *
 * SAFETY (do not weaken these checks):
 *   - Refuses to run unless `ALLOW_DEMO_SEED=true` is set.
 *   - Refuses outright if the target database has ANY tenant that isn't
 *     this demo tenant -- this must never run against a database holding
 *     real tenant data. This check runs before `--reset` is even
 *     considered, and is not bypassable by any flag.
 *
 * IDEMPOTENCY: sales/customers/notifications have no natural business key to
 * upsert against, so "safe to re-run" here means: a second run against an
 * already-seeded demo tenant, without `--reset`, is a no-op (prints a
 * message, exits 0) rather than duplicating data. `--reset` drops the demo
 * tenant's data (and the tenant row itself) and rebuilds from scratch. Data
 * shape is generated from a fixed seeded RNG, so a `--reset` rebuild
 * produces the same distribution every time, not fresh randomness.
 *
 * Usage:
 *   ALLOW_DEMO_SEED=true node scripts/seed-demo.mjs [--reset]
 *
 * (DATABASE_APP_URL / DATABASE_MIGRATOR_URL are read from `backend/.env` via
 * `dotenv/config`, same as the server itself -- set them there, or export
 * them directly, either works.)
 */

import 'dotenv/config';
import pg from 'pg';
import { pool as appPool } from '../src/db/pool.js';
import { runInTenantContext } from '../src/middleware/tenantContext.js';
import { hashPassword } from '../src/services/passwordService.js';
import { schema } from '../src/db/dal.js';
import * as branchManagementService from '../src/services/branchManagementService.js';
import * as staffManagementService from '../src/services/staffManagementService.js';
import * as inventoryManagementService from '../src/services/inventoryManagementService.js';
import * as inventoryAliasService from '../src/services/inventoryAliasService.js';
import * as customerManagementService from '../src/services/customerManagementService.js';
import * as saleService from '../src/services/saleService.js';
import * as gstRateService from '../src/services/gstRateService.js';
import { logAuditEvent } from '../src/services/auditService.js';

// ---------------------------------------------------------------------------
// Config / safety gates
// ---------------------------------------------------------------------------

const RESET = process.argv.includes('--reset');

if (process.env.ALLOW_DEMO_SEED !== 'true') {
  console.error(
    'Refusing to run: set ALLOW_DEMO_SEED=true to confirm this is a dev/staging database.\n' +
      'Usage: ALLOW_DEMO_SEED=true node scripts/seed-demo.mjs [--reset]'
  );
  process.exit(1);
}

const MIGRATOR_URL = process.env.DATABASE_MIGRATOR_URL;
if (!MIGRATOR_URL) {
  console.error('DATABASE_MIGRATOR_URL must be set (BYPASSRLS role -- see backend/.env.example).');
  process.exit(1);
}
if (!process.env.DATABASE_APP_URL) {
  console.error('DATABASE_APP_URL must be set (src/db/pool.js requires it at import time).');
  process.exit(1);
}

const DEMO_TENANT_ID = '99999999-9999-9999-9999-999999999999';
const DEMO_SLUG = 'demo-kitchen';
const DEMO_TENANT_NAME = 'Grovyn Demo Kitchen';
const ADMIN_EMAIL = 'admin@demokitchen.in';
const ADMIN_PASSWORD = 'DemoAdmin123!';
const STAFF_PASSWORD = 'DemoStaff123!';

// Fixed seed -> a `--reset` rebuild reproduces the same data shape every
// time, not fresh randomness each run (mulberry32, tiny + dependency-free).
function mulberry32(seed) {
  let a = seed;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260804);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const pickWeighted = (pairs) => {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [value, w] of pairs) {
    r -= w;
    if (r <= 0) return value;
  }
  return pairs[pairs.length - 1][0];
};
function shuffledSample(arr, count) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}
const round2 = (n) => Math.round(n * 100) / 100;

function dateStr(d) {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Demo dataset definitions
// ---------------------------------------------------------------------------

const BRANCHES = [
  {
    key: 'koramangala',
    name: 'Koramangala Kitchen',
    city: 'Bengaluru',
    state: 'Karnataka',
    address: '7th Block, Koramangala',
    postalCode: '560095',
    phone: '+91 80 4567 1201',
    staffEmail: 'staff.koramangala@demokitchen.in',
    staffName: 'Ananya Rao',
    baseOrdersPerDay: 7,
    trend: 0.45, // strong, visibly growing
    ticketMultiplier: 1.15,
  },
  {
    key: 'andheri',
    name: 'Andheri Kitchen',
    city: 'Mumbai',
    state: 'Maharashtra',
    address: 'Andheri West, SV Road',
    postalCode: '400058',
    phone: '+91 22 4567 1202',
    staffEmail: 'staff.andheri@demokitchen.in',
    staffName: 'Rohit Mehta',
    baseOrdersPerDay: 3.2,
    trend: 0.0, // middling, flat
    ticketMultiplier: 1.0,
  },
  {
    key: 'noida',
    name: 'Sector 18 Kitchen',
    city: 'Noida',
    state: 'Uttar Pradesh',
    address: 'Sector 18 Market',
    postalCode: '201301',
    phone: '+91 120 4567 1203',
    staffEmail: 'staff.noida@demokitchen.in',
    staffName: 'Priya Singh',
    baseOrdersPerDay: 1.6,
    trend: -0.5, // struggling, visibly declining
    ticketMultiplier: 0.85,
  },
];

// Shared menu template -- each branch gets its own `inventory_item` rows
// (branch-scoped), but all branches sell the same catalog, same as a real
// chain. `lowStock: true` marks the two items per branch seeded already at
// or below their threshold, so a low-stock notification exists from minute
// one without needing to simulate depletion.
const MENU = [
  { name: 'Butter Chicken', altName: 'Butter Chicken (F)', unit: 'plate', cost: 120, sell: 320, lowStock: true },
  { name: 'Paneer Tikka Masala', altName: 'Paneer Tikka', unit: 'plate', cost: 90, sell: 280 },
  { name: 'Dal Makhani', altName: 'Dal Makhani (B)', unit: 'bowl', cost: 45, sell: 190 },
  { name: 'Garlic Naan', altName: 'Naan (Garlic)', unit: 'piece', cost: 12, sell: 45 },
  { name: 'Tandoori Roti', altName: 'Roti (T)', unit: 'piece', cost: 6, sell: 25 },
  { name: 'Veg Biryani', altName: 'Biryani (Veg)', unit: 'plate', cost: 70, sell: 220 },
  { name: 'Chicken Biryani', altName: 'Biryani (Chicken)', unit: 'plate', cost: 110, sell: 280 },
  { name: 'Chicken 65', altName: 'Chicken 65 (S)', unit: 'plate', cost: 95, sell: 260, lowStock: true },
  { name: 'Veg Manchurian', altName: 'Manchurian (Veg)', unit: 'plate', cost: 60, sell: 200 },
  { name: 'Gulab Jamun', altName: 'Gulab Jamun (2pc)', unit: 'piece', cost: 8, sell: 40 },
  { name: 'Masala Chai', altName: 'Chai', unit: 'cup', cost: 8, sell: 30 },
  { name: 'Cold Coffee', altName: 'Iced Coffee', unit: 'glass', cost: 25, sell: 90 },
  { name: 'Papad', altName: 'Papad (R)', unit: 'piece', cost: 5, sell: 20 },
  { name: 'Raita', altName: 'Raita (B)', unit: 'bowl', cost: 20, sell: 60 },
  { name: 'Fried Rice', altName: 'Fried Rice (Veg)', unit: 'plate', cost: 55, sell: 180 },
];

const CUSTOMER_FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Diya', 'Ishaan', 'Saanvi', 'Kabir', 'Ananya', 'Reyansh', 'Myra', 'Arjun', 'Sara', 'Vihaan', 'Anika', 'Krishna'];
const CUSTOMER_LAST = ['Sharma', 'Verma', 'Iyer', 'Patel', 'Nair', 'Gupta', 'Reddy', 'Khan', 'Joshi', 'Chatterjee'];
const CUSTOMER_CATEGORIES = ['VIP', 'Regular', 'Walk-in', 'Corporate', 'Dormant'];
const PAYMENT_WEIGHTS = [
  ['upi', 45],
  ['cash', 25],
  ['card', 20],
  ['netbanking', 6],
  ['other', 2],
  ['mixed', 2],
];

// ---------------------------------------------------------------------------
// Step 1: safety check + reset (migrator connection -- cross-tenant by
// design, see check-tenant-gst-rates.mjs for the same pattern/rationale)
// ---------------------------------------------------------------------------

const migratorPool = new pg.Pool({ connectionString: MIGRATOR_URL, max: 1 });

async function assertOnlyDemoTenant() {
  const { rows } = await migratorPool.query(`SELECT id, slug, name FROM tenant WHERE deleted_at IS NULL`);
  const foreign = rows.filter((t) => t.id !== DEMO_TENANT_ID);
  if (foreign.length > 0) {
    console.error(
      `Refusing to run: this database has ${foreign.length} non-demo tenant(s):\n` +
        foreign.map((t) => `  - ${t.id}  ${t.slug}  "${t.name}"`).join('\n') +
        '\nThis script only runs against a database whose only tenant is the demo tenant.'
    );
    process.exit(1);
  }
  return rows.some((t) => t.id === DEMO_TENANT_ID);
}

async function resetDemoTenant() {
  console.log('--reset: dropping existing demo tenant data...');
  const client = await migratorPool.connect();
  try {
    await client.query('BEGIN');
    const tenantScopedTables = [
      'sale_line_item',
      'inventory_movement',
      'inventory_item_alias',
      'notification',
      'sale',
      'inventory_item',
      'customer',
      'tax_period_summary',
      'tax_rate',
      'staff_branch_access',
      'session',
      'audit_log',
      '"user"',
      'branch',
    ];
    for (const table of tenantScopedTables) {
      await client.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [DEMO_TENANT_ID]);
    }
    await client.query(`DELETE FROM tenant WHERE id = $1`, [DEMO_TENANT_ID]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function bootstrapTenantAndAdmin() {
  const adminHash = await hashPassword(ADMIN_PASSWORD);
  await migratorPool.query(
    `INSERT INTO tenant (id, name, slug, branch_limit, seat_limit)
     VALUES ($1, $2, $3, 10, 20)`,
    [DEMO_TENANT_ID, DEMO_TENANT_NAME, DEMO_SLUG]
  );
  await migratorPool.query(
    `INSERT INTO "user" (tenant_id, email, name, password_hash, role)
     VALUES ($1, $2, 'Demo Admin', $3, 'ADMIN')`,
    [DEMO_TENANT_ID, ADMIN_EMAIL, adminHash]
  );
}

// ---------------------------------------------------------------------------
// Step 2: everything else, through the real service layer
// ---------------------------------------------------------------------------

async function seedTenantContents(db) {
  const tenantId = DEMO_TENANT_ID;
  const staffCreds = [];

  // --- Branches + staff (one branch each, real branch-access grants) -----
  for (const b of BRANCHES) {
    const branch = await branchManagementService.createBranch(db, {
      tenantId,
      name: b.name,
      address: b.address,
      city: b.city,
      state: b.state,
      postalCode: b.postalCode,
      phone: b.phone,
      openingHours: '11:00-23:00',
      timezone: 'Asia/Kolkata',
    });
    b.branchId = branch.id;

    const passwordHash = await hashPassword(STAFF_PASSWORD);
    const staff = await staffManagementService.createStaff(db, {
      tenantId,
      email: b.staffEmail,
      name: b.staffName,
      passwordHash,
      role: 'STAFF',
    });
    await staffManagementService.insertBranchGrants(db, { tenantId, userId: staff.id, branchIds: [branch.id] });
    b.staffUserId = staff.id;
    staffCreds.push({ branch: b.name, email: b.staffEmail, password: STAFF_PASSWORD });
  }

  // --- GST rate, with one mid-period change ------------------------------
  // Sales span the last 90 days; the change lands roughly at the midpoint so
  // the tax summary demonstrates a real effective-dated split.
  const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const windowStart = new Date(today);
  windowStart.setUTCDate(windowStart.getUTCDate() - 89);
  const rateChangeDate = new Date(windowStart);
  rateChangeDate.setUTCDate(rateChangeDate.getUTCDate() + 45);

  await gstRateService.setEffectiveGstRate(db, { tenantId, ratePercent: 5, effectiveFrom: '2000-01-01' });
  await gstRateService.setEffectiveGstRate(db, { tenantId, ratePercent: 12, effectiveFrom: dateStr(rateChangeDate) });
  console.log(`GST rate: 5% up to ${dateStr(rateChangeDate)}, 12% from ${dateStr(rateChangeDate)}.`);

  // --- Inventory: catalog + aliases per branch ----------------------------
  for (const b of BRANCHES) {
    b.items = [];
    for (const menuItem of MENU) {
      const initialStock = menuItem.lowStock ? 8 : 500;
      const lowStockThreshold = menuItem.lowStock ? 15 : 40;
      const { item } = await inventoryManagementService.createItem(db, {
        tenantId,
        branchId: b.branchId,
        actorUserId: b.staffUserId,
        name: menuItem.name,
        sku: null,
        unit: menuItem.unit,
        lowStockThreshold,
        costPerUnit: menuItem.cost,
        initialStock,
      });
      await logAuditEvent(db, {
        tenantId,
        actorUserId: b.staffUserId,
        action: 'inventory.create',
        entityType: 'inventory_item',
        entityId: item.id,
        after: inventoryManagementService.serializeItem(item),
      });
      const alias = await inventoryAliasService.createAlias(db, {
        tenantId,
        branchId: b.branchId,
        inventoryItemId: item.id,
        aliasName: menuItem.altName,
      });
      b.items.push({ ...menuItem, itemId: item.id, aliasId: alias.id });
    }
    console.log(`${b.name}: ${b.items.length} inventory items + aliases created.`);
  }

  // --- Customers per branch -----------------------------------------------
  for (const b of BRANCHES) {
    b.customerIds = [];
    for (let i = 0; i < 15; i++) {
      const name = `${pick(CUSTOMER_FIRST)} ${pick(CUSTOMER_LAST)}`;
      const category = pick(CUSTOMER_CATEGORIES);
      const customer = await customerManagementService.createCustomer(db, {
        tenantId,
        branchId: b.branchId,
        name,
        phone: `+91 9${Math.floor(100000000 + rng() * 899999999)}`,
        email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.in`,
        category,
        rating: 1 + Math.floor(rng() * 5),
        notes: category === 'VIP' ? 'Regular large-party bookings.' : null,
      });
      await logAuditEvent(db, {
        tenantId,
        actorUserId: b.staffUserId,
        action: 'customer.create',
        entityType: 'customer',
        entityId: customer.id,
        after: customerManagementService.serializeCustomer(customer),
      });
      b.customerIds.push(customer.id);
    }
    console.log(`${b.name}: ${b.customerIds.length} customers created.`);
  }

  // --- 90 days of sales, weekday/weekend variation + per-branch trend -----
  for (const b of BRANCHES) {
    let salesCount = 0;
    let revenueTotal = 0;
    for (let dayIndex = 0; dayIndex < 90; dayIndex++) {
      const day = new Date(windowStart);
      day.setUTCDate(day.getUTCDate() + dayIndex);
      const saleDate = dateStr(day);
      const dow = day.getUTCDay(); // 0=Sun .. 6=Sat

      const trendFactor = 1 + b.trend * (dayIndex / 89);
      const weekendFactor = dow === 0 || dow === 5 || dow === 6 ? 1.4 : dow === 1 ? 0.85 : 1.0;
      const jitter = 0.75 + rng() * 0.5;
      const orderCount = Math.max(0, Math.round(b.baseOrdersPerDay * trendFactor * weekendFactor * jitter));

      for (let o = 0; o < orderCount; o++) {
        const lineCount = 1 + Math.floor(rng() * 4);
        const chosenItems = shuffledSample(b.items, Math.min(lineCount, b.items.length));
        const lineItems = chosenItems.map((it) => ({
          itemName: it.name,
          sku: null,
          quantity: 1 + Math.floor(rng() * 3),
          unitPrice: round2(it.sell * b.ticketMultiplier * (0.95 + rng() * 0.1)),
          inventoryItemId: it.itemId,
        }));
        const paymentMethod = pickWeighted(PAYMENT_WEIGHTS);

        const sale = await saleService.createSale(db, {
          tenantId,
          branchId: b.branchId,
          createdByUserId: b.staffUserId,
          saleDate,
          paymentMethod,
          lineItems,
        });
        await logAuditEvent(db, {
          tenantId,
          actorUserId: b.staffUserId,
          action: 'sale.create',
          entityType: 'sale',
          entityId: sale.id,
          after: saleService.serializeSaleDetail(sale),
        });
        salesCount++;
        revenueTotal += Number(sale.totalAmount);
      }

      if (dayIndex % 15 === 0 || dayIndex === 89) {
        console.log(`${b.name}: day ${dayIndex + 1}/90 (${saleDate}), ${orderCount} orders today.`);
      }
    }
    console.log(`${b.name}: ${salesCount} sales seeded, ~INR ${Math.round(revenueTotal).toLocaleString('en-IN')} revenue.`);
  }

  // --- A few manual staff stock edits, so audit_log has real actors -------
  for (const b of BRANCHES) {
    const healthyItem = b.items.find((it) => !it.lowStock);
    for (const [delta, reason] of [
      [-5, 'Wastage - spoiled stock during prep'],
      [40, 'Weekly restock delivery'],
    ]) {
      const before = await inventoryManagementService.getItemById(db, { id: healthyItem.itemId });
      const { item: after } = await inventoryManagementService.updateItem(db, {
        tenantId,
        actorUserId: b.staffUserId,
        item: before,
        changes: {},
        stockAdjustment: { quantityDelta: delta, reason },
      });
      await logAuditEvent(db, {
        tenantId,
        actorUserId: b.staffUserId,
        action: 'inventory.update',
        entityType: 'inventory_item',
        entityId: after.id,
        before: inventoryManagementService.serializeItem(before),
        after: inventoryManagementService.serializeItem(after),
      });
    }
  }
  console.log('Manual staff stock edits recorded (audit_log has real actors).');

  // --- Pending staff inventory requests + a couple of admin notifications -
  const lowStockRequests = BRANCHES.slice(0, 2);
  for (const b of lowStockRequests) {
    const lowItem = b.items.find((it) => it.lowStock);
    await db.insert(schema.notification).values({
      tenantId,
      branchId: b.branchId,
      type: 'inventory_request',
      title: `Stock request: ${lowItem.name}`,
      message: `Running low on ${lowItem.name} ahead of the weekend rush -- can we get an emergency restock?`,
      actorUserId: b.staffUserId,
      relatedEntityType: 'inventory_item',
      relatedEntityId: lowItem.itemId,
      status: 'unread',
    });
  }

  await db.insert(schema.notification).values({
    tenantId,
    branchId: BRANCHES[1].branchId,
    type: 'anomaly',
    title: 'Unusual payment method mix detected',
    message: `${BRANCHES[1].name} saw a spike in cash transactions this week versus its usual UPI-heavy mix -- worth a manual reconciliation check.`,
    actorUserId: null,
    relatedEntityType: null,
    relatedEntityId: null,
    status: 'unread',
  });
  await db.insert(schema.notification).values({
    tenantId,
    branchId: BRANCHES[2].branchId,
    type: 'other',
    title: 'Revenue trending down for 3 consecutive weeks',
    message: `${BRANCHES[2].name}'s weekly revenue has declined for three straight weeks -- may be worth a site visit.`,
    actorUserId: null,
    relatedEntityType: null,
    relatedEntityId: null,
    status: 'unread',
  });
  console.log('Pending staff inventory requests + admin notifications created.');

  return { staffCreds };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const exists = await assertOnlyDemoTenant();

  if (exists && !RESET) {
    console.log(`Demo tenant "${DEMO_SLUG}" already exists. Re-run with --reset to rebuild it from scratch.`);
    return;
  }
  if (exists && RESET) {
    await resetDemoTenant();
  }

  console.log('Bootstrapping demo tenant + admin (raw SQL, migrator connection -- see module doc for why)...');
  await bootstrapTenantAndAdmin();

  console.log('Seeding branches, staff, inventory, customers, and 90 days of sales through the real service layer...');
  console.log('This can take a few minutes -- it is issuing the same queries a real user session would, sequentially.');
  const { staffCreds } = await runInTenantContext(appPool, DEMO_TENANT_ID, seedTenantContents);

  console.log('\n=== Demo tenant seeded ===');
  console.log(`Tenant slug: ${DEMO_SLUG}`);
  console.log(`Admin login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log('Staff logins:');
  for (const s of staffCreds) {
    console.log(`  - ${s.branch}: ${s.email} / ${s.password}`);
  }
  console.log('Log in at the frontend with the tenant slug above plus any of these email/password pairs.');
}

main()
  .catch((err) => {
    console.error('Seeding failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await migratorPool.end();
    await appPool.end();
  });
