/**
 * Deterministic synthetic data generator.
 * Uses a fixed seed so every boot and every API call sees the same data.
 * Lives in /seed; no API logic here.
 */

import { createSeededRandom, int, pick, float } from './seededRandom.js';

const CITY_NAMES = ['Mumbai', 'Delhi', 'Bangalore', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune', 'Ahmedabad'];
const COUNTRY = 'India';
const TIMEZONES = ['Asia/Kolkata'];
const STORE_NAME_PARTS = ['Central', 'North', 'South', 'East', 'West', 'Hub', 'Cloud Kitchen'];
const BRAND_NAME_PARTS = ['Spice', 'Bowl', 'Fresh', 'Bite', 'Chef', 'Kitchen', 'Eats', 'Grill'];

/** Simple UUID-like id generator driven by RNG for reproducibility */
function id(rng, prefix = '') {
  const hex = () => int(rng, 0, 15).toString(16);
  const segment = () => hex() + hex() + hex() + hex();
  return prefix ? `${prefix}_${segment()}${segment()}` : `${segment()}${segment()}${segment()}${segment()}`;
}

/** ISO date string from a deterministic "days ago" */
function dateDaysAgo(rng, daysAgoMax) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - int(rng, 0, daysAgoMax));
  return d.toISOString();
}

/** Weighted: 50% in last 14 days (for realistic repeat rate & WoW), 50% in 15–90 days */
function orderDateWeighted(rng) {
  if (float(rng, 0, 1, 4) < 0.5) {
    return dateDaysAgo(rng, 14);
  }
  return dateDaysAgo(rng, 90);
}

/**
 * @param {object} opts
 * @param {number} opts.randomSeed
 * @param {number} opts.cities
 * @param {number} opts.storesPerCity
 * @param {number} opts.brandsPerStore
 * @param {number} opts.skusPerBrand
 * @param {number} opts.customers
 * @param {number} opts.orders
 * @returns {{ cities: import('../models/index.js').City[], stores: import('../models/index.js').Store[], brands: import('../models/index.js').Brand[], skus: import('../models/index.js').SKU[], customers: import('../models/index.js').Customer[], orders: import('../models/index.js').Order[] }}
 */
export function generateSeedData(opts) {
  const rng = createSeededRandom(opts.randomSeed);

  const cities = [];
  const cityIds = [];
  for (let i = 0; i < opts.cities; i++) {
    const name = CITY_NAMES[i % CITY_NAMES.length] + (i >= CITY_NAMES.length ? ` ${i + 1}` : '');
    const city = {
      id: id(rng, 'city'),
      name,
      country: COUNTRY,
      timezone: pick(rng, TIMEZONES),
    };
    cities.push(city);
    cityIds.push(city.id);
  }

  const stores = [];
  const storeIds = [];
  const statuses = ['active', 'active', 'active', 'paused', 'maintenance'];
  for (const cityId of cityIds) {
    for (let s = 0; s < opts.storesPerCity; s++) {
      const name = `${pick(rng, STORE_NAME_PARTS)} ${pick(rng, STORE_NAME_PARTS)}`;
      const store = {
        id: id(rng, 'store'),
        cityId,
        name,
        status: pick(rng, statuses),
        operatingHours: '08:00-22:00',
      };
      stores.push(store);
      storeIds.push(store.id);
    }
  }

  const brands = [];
  const brandIds = [];
  for (const storeId of storeIds) {
    for (let b = 0; b < opts.brandsPerStore; b++) {
      const name = `${pick(rng, BRAND_NAME_PARTS)} ${pick(rng, BRAND_NAME_PARTS)}`;
      const brand = {
        id: id(rng, 'brand'),
        storeId,
        name,
        commissionRate: float(rng, 5, 25, 2),
      };
      brands.push(brand);
      brandIds.push(brand.id);
    }
  }

  const skus = [];
  const skuNames = ['Biryani', 'Curry', 'Naan', 'Rice Bowl', 'Wrap', 'Salad', 'Soup', 'Snack', 'Combo', 'Beverage', 'Dessert', 'Breakfast'];
  for (const brandId of brandIds) {
    for (let k = 0; k < opts.skusPerBrand; k++) {
      const name = `${pick(rng, skuNames)} ${int(rng, 1, 99)}`;
      const cost = float(rng, 50, 200, 2);
      const price = cost * float(rng, 1.3, 2.2, 2);
      skus.push({
        id: id(rng, 'sku'),
        brandId,
        name,
        price: Number(price.toFixed(2)),
        cost: Number(cost.toFixed(2)),
      });
    }
  }

  const customers = [];
  const customerIds = [];
  for (let c = 0; c < opts.customers; c++) {
    const customer = {
      id: id(rng, 'cust'),
      phone: `+91${int(rng, 6000000000, 9999999999)}`,
      createdAt: dateDaysAgo(rng, 365),
    };
    customers.push(customer);
    customerIds.push(customer.id);
  }

  const orders = [];
  for (let o = 0; o < opts.orders; o++) {
    const storeId = pick(rng, storeIds);
    const storeBrands = brands.filter((b) => b.storeId === storeId);
    const brand = pick(rng, storeBrands);
    const totalAmount = float(rng, 150, 2500, 2);
    const commissionAmount = Number((totalAmount * (brand.commissionRate / 100)).toFixed(2));
    orders.push({
      id: id(rng, 'ord'),
      storeId,
      brandId: brand.id,
      customerId: pick(rng, customerIds),
      totalAmount,
      commissionAmount,
      createdAt: orderDateWeighted(rng),
    });
  }

  return { cities, stores, brands, skus, customers, orders };
}
