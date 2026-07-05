/**
 * Staff Service — who works where and in what role. Seeded at boot, deterministic.
 * No payroll or HR systems; operational model only.
 */

import { createSeededRandom, int, float, pick } from '../seed/seededRandom.js';
import { config } from '../config/index.js';

const ROLES = ['CHEF', 'PACKER', 'SUPERVISOR'];
const EXPERIENCE_LEVELS = ['junior', 'mid', 'senior'];

/** Minimum per store: 2 CHEF, 2 PACKER, 1 SUPERVISOR. Remaining slots 6–10 total. */
const MIN_CHEF = 2;
const MIN_PACKER = 2;
const MIN_SUPERVISOR = 1;
const STAFF_COUNT_MIN = 6;
const STAFF_COUNT_MAX = 10;

/**
 * @typedef {Object} StaffMember
 * @property {string} staffId
 * @property {string} storeId
 * @property {'CHEF'|'PACKER'|'SUPERVISOR'} role
 * @property {'junior'|'mid'|'senior'} experienceLevel
 * @property {number} hourlyCapacityScore
 */

/** @type {Map<string, StaffMember[]>} storeId -> staff list */
const staffByStore = new Map();

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return h >>> 0;
}

/**
 * Initialize staff per store: 6–10 staff, at least 2 CHEF, 2 PACKER, 1 SUPERVISOR.
 * Must be called after initServices.
 * @param {import('./storeService.js')} storeSvc
 */
export function initStaffService(storeSvc) {
  const stores = storeSvc.getAllStores();
  const seed = config.seed.randomSeed;

  for (const store of stores) {
    const rng = createSeededRandom((hashString(store.id) + seed) >>> 0);
    const totalStaff = int(rng, STAFF_COUNT_MIN, STAFF_COUNT_MAX);
    const mandatory = [
      ...Array(MIN_CHEF).fill('CHEF'),
      ...Array(MIN_PACKER).fill('PACKER'),
      ...Array(MIN_SUPERVISOR).fill('SUPERVISOR'),
    ];
    const remaining = totalStaff - mandatory.length;
    const rolePool = ['CHEF', 'PACKER', 'PACKER', 'SUPERVISOR']; // bias for packers
    const roles = [...mandatory];
    for (let i = 0; i < remaining; i++) {
      roles.push(pick(rng, rolePool));
    }
    // Shuffle deterministically (Fisher–Yates with rng)
    for (let i = roles.length - 1; i > 0; i--) {
      const j = int(rng, 0, i);
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }

    const list = [];
    for (let idx = 0; idx < roles.length; idx++) {
      const role = roles[idx];
      const experienceLevel = pick(rng, EXPERIENCE_LEVELS);
      const hourlyCapacityScore = float(rng, 0.8, 1.2, 2);
      list.push({
        staffId: `staff_${store.id}_${idx}`,
        storeId: store.id,
        role,
        experienceLevel,
        hourlyCapacityScore,
      });
    }
    staffByStore.set(store.id, list);
  }
}

/**
 * @param {string} storeId
 * @returns {StaffMember[]}
 */
export function getStaffByStore(storeId) {
  return staffByStore.get(storeId) ?? [];
}

/**
 * Snapshot for API: store-wise staff list.
 * @returns {Array<{ storeId: string, staff: StaffMember[] }>}
 */
export function getStaffSnapshot() {
  const out = [];
  for (const [storeId, staff] of staffByStore) {
    out.push({ storeId, staff });
  }
  return out;
}

/**
 * Total staff count (for boot logging).
 * @returns {number}
 */
export function getTotalStaffCount() {
  let n = 0;
  for (const staff of staffByStore.values()) n += staff.length;
  return n;
}

/**
 * Staff count per store (for boot logging).
 * @returns {Record<string, number>}
 */
export function getStaffCountPerStore() {
  const out = {};
  for (const [storeId, staff] of staffByStore) {
    out[storeId] = staff.length;
  }
  return out;
}
