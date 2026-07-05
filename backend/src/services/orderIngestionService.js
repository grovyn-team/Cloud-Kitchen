/**
 * Order Ingestion — normalizes orders from multiple channels into a single internal format.
 * Abstracts where orders come from; downstream services never care about source.
 * Deterministic: no randomness in channel/aggregator assignment.
 */

/** Channel assignment: deterministic by order index so same seed => same mapping */
const CHANNELS = ['AGGREGATOR_A', 'AGGREGATOR_B', 'DIRECT'];

/**
 * @typedef {Object} NormalizedOrder
 * @property {string} orderId
 * @property {string} storeId
 * @property {string} brandId
 * @property {string} customerId
 * @property {number} totalAmount
 * @property {'AGGREGATOR'|'DIRECT'} channel
 * @property {string|null} aggregatorId
 * @property {string} createdAt
 */

/** @type {NormalizedOrder[]} */
let normalizedOrders = [];

/**
 * Mock adapter: map a raw order to a channel and aggregatorId (deterministic by index).
 * @param {import('../models/index.js').Order} rawOrder
 * @param {number} index
 * @returns {{ channel: 'AGGREGATOR'|'DIRECT', aggregatorId: string|null }}
 */
function assignChannel(rawOrder, index) {
  const key = CHANNELS[index % CHANNELS.length];
  if (key === 'DIRECT') {
    return { channel: 'DIRECT', aggregatorId: null };
  }
  return { channel: 'AGGREGATOR', aggregatorId: key };
}

/**
 * Normalize one raw order into the mandatory shape. No randomness.
 * @param {import('../models/index.js').Order} raw
 * @param {{ channel: 'AGGREGATOR'|'DIRECT', aggregatorId: string|null }} assigned
 * @returns {NormalizedOrder}
 */
function toNormalizedOrder(raw, assigned) {
  return {
    orderId: raw.id,
    storeId: raw.storeId,
    brandId: raw.brandId,
    customerId: raw.customerId,
    totalAmount: raw.totalAmount,
    channel: assigned.channel,
    aggregatorId: assigned.aggregatorId,
    createdAt: raw.createdAt,
  };
}

/**
 * Initialize ingestion: pull raw orders from orderService and normalize.
 * Must be called after initServices(seedData).
 * @param {import('./orderService.js')} orderSvc
 */
export function initOrderIngestionService(orderSvc) {
  const raw = orderSvc.getAllOrders();
  normalizedOrders = raw.map((o, i) => {
    const assigned = assignChannel(o, i);
    return toNormalizedOrder(o, assigned);
  });
}

/**
 * @returns {NormalizedOrder[]}
 */
export function getNormalizedOrders() {
  return normalizedOrders;
}

/**
 * Order counts per channel/aggregator (for boot logging). Deterministic.
 * @returns {{ total: number, byAggregator: Record<string, number> }}
 */
export function getIngestionCounts() {
  const byAggregator = { AGGREGATOR_A: 0, AGGREGATOR_B: 0, DIRECT: 0 };
  for (const o of normalizedOrders) {
    const key = o.aggregatorId ?? 'DIRECT';
    byAggregator[key] = (byAggregator[key] ?? 0) + 1;
  }
  return { total: normalizedOrders.length, byAggregator };
}
