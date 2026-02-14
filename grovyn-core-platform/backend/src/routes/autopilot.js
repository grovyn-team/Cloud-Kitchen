/**
 * Autopilot APIs. Validate input, call services, return JSON. No business logic.
 */

import * as autopilotService from '../services/autopilotService.js';
import * as executiveBriefService from '../services/executiveBriefService.js';
import * as alertOrchestratorService from '../services/alertOrchestratorService.js';

/**
 * GET /api/v1/autopilot/status
 */
export function getAutopilotStatus(req, res) {
  const insightsByModule = autopilotService.getInsightsConsumedByModule();
  const total = autopilotService.getTotalInsightsConsumed();
  const topCount = autopilotService.getTopPriorities().length;
  res.json({
    autopilotActive: true,
    totalInsightsConsumed: total,
    topPrioritiesCount: topCount,
    insightsConsumedByModule: insightsByModule,
  });
}

/**
 * GET /api/v1/autopilot/executive-brief
 */
export function getExecutiveBrief(req, res) {
  const brief = executiveBriefService.getExecutiveBrief();
  res.json(brief ?? {});
}

/**
 * GET /api/v1/autopilot/alerts — RBAC: STAFF sees only alerts for assigned stores.
 */
export function getAlerts(req, res) {
  let data = alertOrchestratorService.getActiveAlerts();
  if (req.user && req.user.role === 'STAFF' && req.user.storeIds?.length) {
    const idSet = new Set(req.user.storeIds);
    data = data.filter((a) =>
      a.entities?.some((e) => e.type === 'STORE' && idSet.has(e.id))
    );
  }
  res.json({ data, meta: { count: data.length } });
}
