/**
 * Shift Service — staff coverage vs operating hours. Morning/evening shifts, utilization.
 * Deterministic assignment; uses orders from commissionService.
 */

import * as storeService from './storeService.js';
import * as staffService from './staffService.js';
import * as commissionService from './commissionService.js';

const SHIFT_MORNING = 'morning';
const SHIFT_EVENING = 'evening';

/**
 * Parse "08:00-22:00" to { startHour, endHour } (UTC hour 0-23).
 */
function parseOperatingHours(operatingHours) {
  if (!operatingHours || typeof operatingHours !== 'string') return { startHour: 8, endHour: 22 };
  const match = operatingHours.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!match) return { startHour: 8, endHour: 22 };
  const startHour = Number(match[1]);
  const endHour = Number(match[3]);
  return { startHour, endHour };
}

/**
 * Split operating window into morning (first half) and evening (second half).
 * @param {number} startHour
 * @param {number} endHour
 * @returns {{ morningEndHour: number, eveningStartHour: number }}
 */
function getShiftSplit(startHour, endHour) {
  const mid = startHour + Math.floor((endHour - startHour) / 2);
  return { morningEndHour: mid, eveningStartHour: mid };
}

/**
 * @typedef {Object} ShiftAssignment
 * @property {string} storeId
 * @property {string} shift
 * @property {number} staffCount
 * @property {number} totalCapacityScore
 * @property {string[]} staffIds
 */

/** @type {ShiftAssignment[]} */
let shiftAssignments = [];

/**
 * @typedef {Object} ShiftMetrics
 * @property {string} storeId
 * @property {string} shift
 * @property {number} ordersInShift
 * @property {number} staffCount
 * @property {number} totalCapacityScore
 * @property {number} ordersPerStaff
 * @property {number} utilization
 */

/** @type {ShiftMetrics[]} */
let shiftMetrics = [];

/**
 * Assign staff to shifts: sort by staffId, first half morning, second half evening.
 * Compute staffCount and totalCapacityScore per (store, shift).
 */
function runShiftAssignment() {
  shiftAssignments = [];
  const snapshot = staffService.getStaffSnapshot();
  for (const { storeId, staff } of snapshot) {
    const sorted = [...staff].sort((a, b) => a.staffId.localeCompare(b.staffId));
    const half = Math.ceil(sorted.length / 2);
    const morningStaff = sorted.slice(0, half);
    const eveningStaff = sorted.slice(half);
    const cap = (arr) => arr.reduce((s, m) => s + m.hourlyCapacityScore, 0);
    shiftAssignments.push({
      storeId,
      shift: SHIFT_MORNING,
      staffCount: morningStaff.length,
      totalCapacityScore: Number(cap(morningStaff).toFixed(2)),
      staffIds: morningStaff.map((m) => m.staffId),
    });
    shiftAssignments.push({
      storeId,
      shift: SHIFT_EVENING,
      staffCount: eveningStaff.length,
      totalCapacityScore: Number(cap(eveningStaff).toFixed(2)),
      staffIds: eveningStaff.map((m) => m.staffId),
    });
  }
}

/**
 * Count orders per (store, shift) using store operating hours. UTC hour from createdAt.
 */
function countOrdersPerShift() {
  const orders = commissionService.getOrdersWithCommission();
  const stores = storeService.getAllStores();
  /** @type {Map<string, Map<string, number>>} storeId -> shift -> count */
  const counts = new Map();
  for (const store of stores) {
    counts.set(store.id, new Map([[SHIFT_MORNING, 0], [SHIFT_EVENING, 0]]));
  }
  for (const order of orders) {
    const storeMap = counts.get(order.storeId);
    if (!storeMap) continue;
    const store = storeService.getStoreById(order.storeId);
    const { startHour, endHour } = parseOperatingHours(store?.operatingHours ?? '08:00-22:00');
    const { morningEndHour, eveningStartHour } = getShiftSplit(startHour, endHour);
    const hour = new Date(order.createdAt).getUTCHours();
    if (hour >= startHour && hour < morningEndHour) {
      storeMap.set(SHIFT_MORNING, (storeMap.get(SHIFT_MORNING) ?? 0) + 1);
    } else if (hour >= eveningStartHour && hour < endHour) {
      storeMap.set(SHIFT_EVENING, (storeMap.get(SHIFT_EVENING) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Build shift metrics: ordersInShift, staffCount, totalCapacityScore, ordersPerStaff, utilization.
 */
function runShiftMetrics() {
  const orderCounts = countOrdersPerShift();
  shiftMetrics = [];
  for (const a of shiftAssignments) {
    const ordersInShift = orderCounts.get(a.storeId)?.get(a.shift) ?? 0;
    const totalCapacityScore = a.totalCapacityScore || 1;
    const utilization = Number((ordersInShift / totalCapacityScore).toFixed(4));
    const ordersPerStaff = a.staffCount > 0 ? Number((ordersInShift / a.staffCount).toFixed(2)) : 0;
    shiftMetrics.push({
      storeId: a.storeId,
      shift: a.shift,
      ordersInShift,
      staffCount: a.staffCount,
      totalCapacityScore: a.totalCapacityScore,
      ordersPerStaff,
      utilization,
    });
  }
}

/**
 * Initialize shift service: assign staff, count orders, compute utilization.
 * Must be called after staffService and commissionService are ready.
 */
export function initShiftService() {
  runShiftAssignment();
  runShiftMetrics();
}

/**
 * @returns {ShiftMetrics[]}
 */
export function getShiftMetrics() {
  return shiftMetrics;
}

/**
 * @param {string} storeId
 * @returns {ShiftMetrics[]}
 */
export function getShiftMetricsByStore(storeId) {
  return shiftMetrics.filter((m) => m.storeId === storeId);
}
