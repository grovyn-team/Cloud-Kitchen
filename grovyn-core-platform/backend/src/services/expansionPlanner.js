/**
 * Expansion Planner — readiness, location ranking, financial projection, Grovyn Autopilot impact, risks.
 * Used by Scale Simulator / expansion API only.
 */

import { expansionLocations } from '../data/expansionLocations.js';

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  })
    .format(amount)
    .replace('₹', '');
}

function calculateAvgMargin(stores, metrics) {
  if (!metrics || !metrics.last7) return 12;
  return metrics.last7.netMarginPct ?? 12;
}

function getCriticalAlertFrequency(alerts) {
  if (!Array.isArray(alerts)) return 0;
  const critical = alerts.filter((a) => a.severity === 'critical');
  return Math.round(critical.length / 3);
}

/**
 * Assess if business is ready to scale
 */
export function calculateReadinessScore(stores, metrics, alerts) {
  const score = {
    total: 0,
    maxScore: 100,
    criteria: [],
    blockers: [],
    warnings: [],
  };

  const avgMargin = calculateAvgMargin(stores, metrics);
  if (avgMargin >= 15) {
    score.total += 20;
    score.criteria.push({ name: 'Performance', status: 'pass', value: `${avgMargin.toFixed(1)}% margin` });
  } else {
    score.blockers.push(`Net margin is ${avgMargin.toFixed(1)}% (need >15%)`);
    score.criteria.push({ name: 'Performance', status: 'fail', value: `${avgMargin.toFixed(1)}% margin` });
  }

  const criticalAlertsPerMonth = getCriticalAlertFrequency(alerts);
  if (criticalAlertsPerMonth < 5) {
    score.total += 20;
    score.criteria.push({ name: 'Stability', status: 'pass', value: `${criticalAlertsPerMonth} alerts/mo` });
  } else {
    score.blockers.push(`${criticalAlertsPerMonth} critical alerts/month (need <5)`);
    score.criteria.push({ name: 'Stability', status: 'fail', value: `${criticalAlertsPerMonth} alerts/mo` });
  }

  const repeatRate = metrics?.last14?.repeatRate ?? 0;
  if (repeatRate >= 25) {
    score.total += 20;
    score.criteria.push({ name: 'Retention', status: 'pass', value: `${repeatRate.toFixed(1)}% repeat` });
  } else {
    score.warnings.push(`14-day repeat rate is ${repeatRate.toFixed(1)}% (target >25%)`);
    score.criteria.push({ name: 'Retention', status: 'warning', value: `${repeatRate.toFixed(1)}% repeat` });
    score.total += 10;
  }

  if (avgMargin > 10) {
    score.total += 20;
    score.criteria.push({ name: 'Capital', status: 'pass', value: 'Sufficient runway' });
  } else {
    score.warnings.push('Limited capital runway - ensure financing before expansion');
    score.criteria.push({ name: 'Capital', status: 'warning', value: 'Limited runway' });
    score.total += 10;
  }

  const storeCount = Array.isArray(stores) ? stores.length : 0;
  if (storeCount < 7) {
    score.total += 20;
    score.criteria.push({ name: 'Team', status: 'pass', value: 'Current team can manage' });
  } else {
    score.warnings.push('Consider hiring operations manager for >7 stores');
    score.criteria.push({ name: 'Team', status: 'warning', value: 'Hire ops manager' });
    score.total += 15;
  }

  score.recommendation = score.total >= 80 ? 'ready' : score.total >= 60 ? 'caution' : 'not_ready';
  return score;
}

/**
 * Rank expansion locations by opportunity score
 */
export function rankLocations(currentStores, allLocations) {
  const locs = Array.isArray(allLocations) ? allLocations : expansionLocations;
  return locs
    .map((loc) => {
      const demandScore = Math.min(100, (loc.demandDensity / 500) * 100);
      const competitionScore = Math.max(0, 100 - loc.competitorCount * 4);
      const cannibalizationScore = Math.max(0, 100 - loc.cannibalizationRisk * 5);
      const rentScore = Math.max(0, 100 - (loc.avgRentPerSqFt - 50) * 2);
      const deliveryScore = loc.deliveryEfficiencyScore ?? 70;

      const opportunityScore =
        demandScore * 0.35 +
        competitionScore * 0.25 +
        cannibalizationScore * 0.2 +
        rentScore * 0.1 +
        deliveryScore * 0.1;

      return {
        ...loc,
        opportunityScore: Math.round(opportunityScore),
        demandScore: Math.round(demandScore),
        competitionScore: Math.round(competitionScore),
        cannibalizationScore: Math.round(cannibalizationScore),
      };
    })
    .sort((a, b) => b.opportunityScore - a.opportunityScore);
}

/**
 * Project financials for new stores with ramp-up
 */
export function projectFinancials(newStoreCount, avgStoreMetrics, selectedLocations) {
  const setupCostPerStore = {
    equipment: 1000000,
    renovation: 400000,
    deposit: 250000,
    inventory: 250000,
    total: 1900000,
  };

  const totalSetupCost = setupCostPerStore.total * newStoreCount;
  const targetMonthlyGMVPerStore = avgStoreMetrics?.avgMonthlyRevenue ?? 450000;
  const monthlyProjections = [];

  for (let month = 1; month <= 12; month++) {
    const rampMultiplier = month <= 3 ? [0.3, 0.5, 0.7][month - 1] : 1.0;
    const monthlyGMV = targetMonthlyGMVPerStore * newStoreCount * rampMultiplier;

    const cogs = monthlyGMV * 0.6;
    const commission = monthlyGMV * 0.25;
    const rent = 100000 * newStoreCount;
    const utilities = 17500 * newStoreCount;
    const staff = 175000 * newStoreCount;
    const totalCosts = cogs + commission + rent + utilities + staff;
    const netProfit = monthlyGMV - totalCosts;
    const cumulativeProfit =
      month === 1 ? netProfit : monthlyProjections[month - 2].cumulative + netProfit;

    monthlyProjections.push({
      month,
      revenue: Math.round(monthlyGMV),
      cogs: Math.round(cogs),
      commission: Math.round(commission),
      fixedCosts: Math.round(rent + utilities + staff),
      totalCosts: Math.round(totalCosts),
      netProfit: Math.round(netProfit),
      cumulative: Math.round(cumulativeProfit),
      rampMultiplier,
    });
  }

  let breakevenMonth = null;
  let cumulativeAfterSetup = -totalSetupCost;
  for (let i = 0; i < monthlyProjections.length; i++) {
    cumulativeAfterSetup += monthlyProjections[i].netProfit;
    if (cumulativeAfterSetup >= 0 && breakevenMonth == null) {
      breakevenMonth = i + 1;
      break;
    }
  }

  return {
    setupCosts: setupCostPerStore,
    totalSetupCost,
    monthlyProjections,
    breakevenMonth: breakevenMonth ?? 'Beyond 12 months',
    year1Revenue: monthlyProjections.reduce((sum, m) => sum + m.revenue, 0),
    year1NetProfit: monthlyProjections.reduce((sum, m) => sum + m.netProfit, 0),
  };
}

/**
 * Calculate Grovyn Autopilot value (feature-linked)
 */
export function calculateGrovynImpact(newStoreCount, projectedGMV) {
  const monthlyGMV = projectedGMV / 12;

  return [
    {
      feature: 'Commission Alerts',
      description: 'Detect platform fee spikes across all stores',
      calculation: `1.2% of ${formatCurrency(monthlyGMV)}`,
      monthlyValue: Math.round(monthlyGMV * 0.012),
      annualValue: Math.round(monthlyGMV * 0.012 * 12),
    },
    {
      feature: 'Low-Margin SKU Detection',
      description: 'Flag and optimize money-losing items before they scale',
      calculation: `2.1% margin improvement on ${formatCurrency(monthlyGMV)}`,
      monthlyValue: Math.round(monthlyGMV * 0.021),
      annualValue: Math.round(monthlyGMV * 0.021 * 12),
    },
    {
      feature: 'AI Repeat Engine',
      description: 'Automated win-back campaigns for dormant customers',
      calculation: `5.8% repeat lift = ${formatCurrency(monthlyGMV * 0.058)}`,
      monthlyValue: Math.round(monthlyGMV * 0.058),
      annualValue: Math.round(monthlyGMV * 0.058 * 12),
    },
    {
      feature: 'Centralized Dashboard',
      description: 'Manage more stores without additional ops manager',
      calculation: newStoreCount >= 3 ? 'Avoid hiring ops manager' : 'Improved efficiency',
      monthlyValue: newStoreCount >= 3 ? 60000 : 25000,
      annualValue: newStoreCount >= 3 ? 720000 : 300000,
    },
    {
      feature: 'Real-time Inventory Alerts',
      description: 'Reduce wastage across multiple locations',
      calculation: '3.2% COGS reduction',
      monthlyValue: Math.round(monthlyGMV * 0.6 * 0.032),
      annualValue: Math.round(monthlyGMV * 0.6 * 0.032 * 12),
    },
  ];
}

/**
 * Assess expansion risks
 */
export function assessRisks(newStoreCount, selectedLocations, currentMetrics) {
  const locations = Array.isArray(selectedLocations) ? selectedLocations : [];
  const avgCompetition =
    locations.length > 0
      ? locations.reduce((sum, loc) => sum + (loc.competitorCount ?? 0), 0) / locations.length
      : 10;
  const avgCannibalization =
    locations.length > 0
      ? locations.reduce((sum, loc) => sum + (loc.cannibalizationRisk ?? 0), 0) / locations.length
      : 8;

  const operationalRisk = newStoreCount > 3 ? 60 : newStoreCount > 1 ? 40 : 20;
  const avgMargin = currentMetrics?.avgMargin ?? 15;
  const capitalRisk = avgMargin < 15 ? 70 : avgMargin < 20 ? 40 : 20;

  const marketSaturation = Math.min(100, avgCompetition * 5);
  const cannibalization = avgCannibalization * 10;

  const overall = Math.round(
    marketSaturation * 0.25 +
      cannibalization * 0.2 +
      operationalRisk * 0.3 +
      capitalRisk * 0.25
  );

  return {
    overall: Math.min(100, overall),
    breakdown: {
      marketSaturation: Math.round(marketSaturation),
      cannibalization: Math.round(cannibalization),
      operational: operationalRisk,
      capital: capitalRisk,
    },
  };
}

/**
 * Generate scenario presets
 */
export function generateScenarios(rankedLocations) {
  const locs = rankedLocations || [];
  return {
    conservative: {
      name: 'Conservative',
      newStores: 1,
      timeline: 3,
      locations: locs.slice(0, 1),
      description: 'Test one high-opportunity location first',
    },
    moderate: {
      name: 'Moderate',
      newStores: 3,
      timeline: 9,
      locations: locs.slice(0, 3),
      description: 'Phased rollout over 9 months',
    },
    aggressive: {
      name: 'Aggressive',
      newStores: 5,
      timeline: 12,
      locations: locs.slice(0, 5),
      description: 'Rapid expansion to capture market',
    },
  };
}

export { expansionLocations };
