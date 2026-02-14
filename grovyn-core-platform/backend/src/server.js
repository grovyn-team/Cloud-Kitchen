/**
 * Server entry. Boots seed, initializes services, then starts HTTP server.
 * Fails loudly if seed generation fails.
 */

import app from './app.js';
import { config } from './config/index.js';
import { runSeed } from './seed/index.js';
import { initServices, storeService, orderService } from './services/index.js';
import * as storeHealthService from './services/storeHealthService.js';
import * as orderIngestionService from './services/orderIngestionService.js';
import * as commissionService from './services/commissionService.js';
import * as aggregatorInsightService from './services/aggregatorInsightService.js';
import * as inventoryService from './services/inventoryService.js';
import * as consumptionService from './services/consumptionService.js';
import * as inventoryInsightService from './services/inventoryInsightService.js';
import * as staffService from './services/staffService.js';
import * as shiftService from './services/shiftService.js';
import * as workforceInsightService from './services/workforceInsightService.js';
import * as financeService from './services/financeService.js';
import * as profitEngine from './services/profitEngine.js';
import * as financeInsightService from './services/financeInsightService.js';
import * as autopilotService from './services/autopilotService.js';
import * as executiveBriefService from './services/executiveBriefService.js';
import * as alertOrchestratorService from './services/alertOrchestratorService.js';
import * as metricsEngine from './engines/metricsEngine.js';

function main() {
  let seedData;
  try {
    seedData = runSeed();
  } catch (err) {
    console.error('Seed generation failed:', err.message);
    process.exit(1);
  }

  initServices(seedData);
  storeHealthService.initStoreHealthService(storeService, orderService);
  orderIngestionService.initOrderIngestionService(orderService);
  commissionService.initCommissionService();
  aggregatorInsightService.initAggregatorInsightService();
  inventoryService.initInventoryService(storeService);
  console.log('Inventory initialized:', inventoryService.getStoresWithInventoryCount(), 'stores');
  console.log('Total ingredients tracked:', inventoryService.getTotalIngredientsTracked());
  consumptionService.runConsumption();
  inventoryInsightService.initInventoryInsightService();
  staffService.initStaffService(storeService);
  console.log('Staff per store:', staffService.getStaffCountPerStore());
  console.log('Total staff:', staffService.getTotalStaffCount());
  shiftService.initShiftService();
  workforceInsightService.initWorkforceInsightService();
  financeService.initFinanceService();
  profitEngine.initProfitEngine();
  metricsEngine.initMetricsEngine();
  console.log('Finance engine initialized');
  financeInsightService.initFinanceInsightService();
  autopilotService.initAutopilotService();
  console.log('AI Autopilot initialized');
  console.log('Insights consumed by module:', autopilotService.getInsightsConsumedByModule());
  executiveBriefService.initExecutiveBriefService();
  alertOrchestratorService.initAlertOrchestratorService();

  const ingestionCounts = orderIngestionService.getIngestionCounts();
  console.log('Orders ingested:', ingestionCounts.total);
  console.log('Orders by channel/aggregator:', ingestionCounts.byAggregator);

  const { cities, stores, brands, skus, customers, orders } = seedData;
  console.log('Seed data loaded:', {
    cities: cities.length,
    stores: stores.length,
    brands: brands.length,
    skus: skus.length,
    customers: customers.length,
    orders: orders.length,
  });

  const PREFERRED_FALLBACK_PORT = 3001; // Vite proxy points here

  function startListening(port) {
    const server = app.listen(port, () => {
      console.log(`Core Data Service listening on port ${port}`);
      console.log(`Health: http://localhost:${port}/api/v1/health`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        if (port !== PREFERRED_FALLBACK_PORT) {
          console.warn(`Port ${port} is already in use. Trying ${PREFERRED_FALLBACK_PORT} (frontend proxy expects this)...`);
          startListening(PREFERRED_FALLBACK_PORT);
          return;
        }
        console.error(`Port ${port} is already in use. Either:`);
        console.error(`  1. Stop the other process: netstat -ano | findstr :${port}`);
        console.error(`  2. Then run again, or set PORT to another value and update frontend vite proxy.`);
      } else {
        console.error('Server error:', err);
      }
      process.exit(1);
    });

    function shutdown(signal) {
      console.log(`${signal} received, closing server...`);
      server.close((err) => {
        if (err) {
          console.error('Error closing server:', err);
          process.exit(1);
        }
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 5000);
    }

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  startListening(config.port);
}

main();
