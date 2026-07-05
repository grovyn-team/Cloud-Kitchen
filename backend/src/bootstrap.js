/**
 * Runs seed and initializes all services. Used by server.js (local) and api/index.js (Vercel).
 * Call once before starting the server or exporting the app.
 */
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

export function runBootstrap() {
  let seedData;
  try {
    seedData = runSeed();
  } catch (err) {
    console.error('Seed generation failed:', err.message);
    throw err;
  }

  initServices(seedData);
  storeHealthService.initStoreHealthService(storeService, orderService);
  orderIngestionService.initOrderIngestionService(orderService);
  commissionService.initCommissionService();
  aggregatorInsightService.initAggregatorInsightService();
  inventoryService.initInventoryService(storeService);
  consumptionService.runConsumption();
  inventoryInsightService.initInventoryInsightService();
  staffService.initStaffService(storeService);
  shiftService.initShiftService();
  workforceInsightService.initWorkforceInsightService();
  financeService.initFinanceService();
  profitEngine.initProfitEngine();
  metricsEngine.initMetricsEngine();
  financeInsightService.initFinanceInsightService();
  autopilotService.initAutopilotService();
  executiveBriefService.initExecutiveBriefService();
  alertOrchestratorService.initAlertOrchestratorService();
}
