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
 * GET /api/v1/autopilot/alerts
 */
export function getAlerts(req, res) {
  const data = alertOrchestratorService.getActiveAlerts();
  res.json({ data, meta: { count: data.length } });
}
