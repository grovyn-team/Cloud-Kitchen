/**
 * Action Engine — "What Should I Do Today?" top 3 recommendations from active insights.
 */

import * as metricsEngine from './metricsEngine.js';
import * as insightEngine from './insightEngine.js';

const PRIORITY_ORDER = [
  'churn rescue',
  'reorder capture',
  'direct channel shift',
  'sku repricing',
  'repeat drop investigation',
  'dormant win-back',
];

const INSIGHT_TO_ACTION = {
  'Churn Risk': { action: 'churn rescue', effort: '30 min', outcome: 'Re-engage high-LTV customers before they churn.' },
  'Reorder Prediction': { action: 'reorder capture', effort: '15 min', outcome: 'Send targeted offer to likely reorder segment.' },
  'Commission Rising': { action: 'direct channel shift', effort: '1 hour', outcome: 'Shift traffic to direct channel to protect margin.' },
  'Low-Margin SKUs': { action: 'sku repricing', effort: '30 min', outcome: 'Reprice or promote higher-margin items.' },
  'Repeat Rate Drop': { action: 'repeat drop investigation', effort: '30 min', outcome: 'Identify causes and run retention campaign.' },
  'Dormant Segment Size': { action: 'dormant win-back', effort: '1 hour', outcome: 'Win-back campaign to recover 15% of dormant base.' },
};

const ACTION_ICONS = {
  'churn rescue': '🚨',
  'reorder capture': '🔄',
  'direct channel shift': '📈',
  'sku repricing': '📦',
  'repeat drop investigation': '📉',
  'dormant win-back': '💤',
};

export function getTopActions() {
  const metrics = metricsEngine.getFullMetrics();
  const insights = insightEngine.generateInsights(metrics);

  const candidates = [];
  for (const ins of insights) {
    const mapping = INSIGHT_TO_ACTION[ins.title];
    if (!mapping) continue;
    const rank = PRIORITY_ORDER.indexOf(mapping.action);
    if (rank === -1) continue;
    candidates.push({
      rank,
      insightId: ins.id,
      title: ins.title,
      action: mapping.action,
      effort: mapping.effort,
      outcome: mapping.outcome,
      icon: ACTION_ICONS[mapping.action] || '📌',
    });
  }

  candidates.sort((a, b) => a.rank - b.rank);
  const top3 = candidates.slice(0, 3);
  return top3.map((c, i) => ({
    priority: i + 1,
    icon: c.icon,
    effort: c.effort,
    insightId: c.insightId,
    actionText: getActionText(c.action, c.title),
    expectedOutcome: c.outcome,
  }));
}

function getActionText(action, title) {
  const texts = {
    'churn rescue': 'Contact high-value customers inactive 14+ days with a win-back offer.',
    'reorder capture': 'Run a short campaign targeting customers likely to reorder this week.',
    'direct channel shift': 'Promote direct ordering (app/web) to reduce aggregator commission.',
    'sku repricing': 'Review and reprice low-margin items or push higher-margin alternatives.',
    'repeat drop investigation': 'Analyse repeat rate drop and launch a retention initiative.',
    'dormant win-back': 'Launch dormant-customer win-back campaign (target 15% recovery).',
  };
  return texts[action] || `Act on: ${title}`;
}
