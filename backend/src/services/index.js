/**
 * Service layer entry. All services are initialized with seeded data at boot.
 * Routes only call these; no data access in route handlers.
 */

import * as cityService from './cityService.js';
import * as storeService from './storeService.js';
import * as brandService from './brandService.js';
import * as skuService from './skuService.js';
import * as customerService from './customerService.js';
import * as orderService from './orderService.js';

/**
 * Initialize all services with the given seeded dataset.
 * @param {ReturnType<import('../seed/index.js').runSeed>} seedData
 */
export function initServices(seedData) {
  cityService.initCityService(seedData.cities);
  storeService.initStoreService(seedData.stores);
  brandService.initBrandService(seedData.brands);
  skuService.initSkuService(seedData.skus);
  customerService.initCustomerService(seedData.customers);
  orderService.initOrderService(seedData.orders);
}

export { cityService, storeService, brandService, skuService, customerService, orderService };
