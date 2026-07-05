/**
 * Expansion locations — recommended zones per city for scale planning.
 * Used by expansionPlanner to rank WHERE to expand.
 */

export const expansionLocations = [
  // Bangalore
  { id: 'blr_kormangala', city: 'Bangalore', zone: 'Koramangala', lat: 12.9352, lng: 77.6245, demandDensity: 450, competitorCount: 12, cannibalizationRisk: 8, avgRentPerSqFt: 85, deliveryEfficiencyScore: 78, opportunityScore: 0 },
  { id: 'blr_whitefield', city: 'Bangalore', zone: 'Whitefield', lat: 12.9698, lng: 77.7499, demandDensity: 380, competitorCount: 8, cannibalizationRisk: 5, avgRentPerSqFt: 65, deliveryEfficiencyScore: 82, opportunityScore: 0 },
  { id: 'blr_hsr', city: 'Bangalore', zone: 'HSR Layout', lat: 12.9116, lng: 77.6473, demandDensity: 420, competitorCount: 15, cannibalizationRisk: 12, avgRentPerSqFt: 80, deliveryEfficiencyScore: 75, opportunityScore: 0 },
  { id: 'blr_indiranagar', city: 'Bangalore', zone: 'Indiranagar', lat: 12.9716, lng: 77.6412, demandDensity: 410, competitorCount: 18, cannibalizationRisk: 6, avgRentPerSqFt: 95, deliveryEfficiencyScore: 73, opportunityScore: 0 },
  { id: 'blr_jayanagar', city: 'Bangalore', zone: 'Jayanagar', lat: 12.925, lng: 77.5838, demandDensity: 390, competitorCount: 10, cannibalizationRisk: 7, avgRentPerSqFt: 70, deliveryEfficiencyScore: 80, opportunityScore: 0 },
  // Mumbai
  { id: 'bom_andheri', city: 'Mumbai', zone: 'Andheri East', lat: 19.1136, lng: 72.8697, demandDensity: 520, competitorCount: 22, cannibalizationRisk: 10, avgRentPerSqFt: 120, deliveryEfficiencyScore: 72, opportunityScore: 0 },
  { id: 'bom_bandra', city: 'Mumbai', zone: 'Bandra West', lat: 19.0596, lng: 72.8295, demandDensity: 480, competitorCount: 20, cannibalizationRisk: 9, avgRentPerSqFt: 140, deliveryEfficiencyScore: 70, opportunityScore: 0 },
  { id: 'bom_powai', city: 'Mumbai', zone: 'Powai', lat: 19.1197, lng: 72.9081, demandDensity: 400, competitorCount: 14, cannibalizationRisk: 6, avgRentPerSqFt: 95, deliveryEfficiencyScore: 78, opportunityScore: 0 },
  { id: 'bom_malad', city: 'Mumbai', zone: 'Malad West', lat: 19.1866, lng: 72.8486, demandDensity: 380, competitorCount: 12, cannibalizationRisk: 5, avgRentPerSqFt: 75, deliveryEfficiencyScore: 80, opportunityScore: 0 },
  { id: 'bom_lowerparel', city: 'Mumbai', zone: 'Lower Parel', lat: 18.9925, lng: 72.8154, demandDensity: 450, competitorCount: 18, cannibalizationRisk: 8, avgRentPerSqFt: 110, deliveryEfficiencyScore: 74, opportunityScore: 0 },
  // Delhi
  { id: 'del_saket', city: 'Delhi', zone: 'Saket', lat: 28.5244, lng: 77.2066, demandDensity: 440, competitorCount: 16, cannibalizationRisk: 7, avgRentPerSqFt: 90, deliveryEfficiencyScore: 76, opportunityScore: 0 },
  { id: 'del_hauzkhas', city: 'Delhi', zone: 'Hauz Khas', lat: 28.5484, lng: 77.2050, demandDensity: 410, competitorCount: 19, cannibalizationRisk: 9, avgRentPerSqFt: 100, deliveryEfficiencyScore: 74, opportunityScore: 0 },
  { id: 'del_gurgaon', city: 'Delhi NCR', zone: 'Gurgaon Sector 29', lat: 28.4934, lng: 77.0875, demandDensity: 460, competitorCount: 14, cannibalizationRisk: 4, avgRentPerSqFt: 85, deliveryEfficiencyScore: 82, opportunityScore: 0 },
  { id: 'del_rohini', city: 'Delhi', zone: 'Rohini', lat: 28.7519, lng: 77.0672, demandDensity: 370, competitorCount: 10, cannibalizationRisk: 5, avgRentPerSqFt: 65, deliveryEfficiencyScore: 79, opportunityScore: 0 },
  { id: 'del_noida', city: 'Delhi NCR', zone: 'Noida Sector 18', lat: 28.5692, lng: 77.3214, demandDensity: 400, competitorCount: 12, cannibalizationRisk: 6, avgRentPerSqFt: 70, deliveryEfficiencyScore: 81, opportunityScore: 0 },
  // Hyderabad
  { id: 'hyd_gachibowli', city: 'Hyderabad', zone: 'Gachibowli', lat: 17.4401, lng: 78.3489, demandDensity: 420, competitorCount: 11, cannibalizationRisk: 5, avgRentPerSqFt: 75, deliveryEfficiencyScore: 83, opportunityScore: 0 },
  { id: 'hyd_jubilee', city: 'Hyderabad', zone: 'Jubilee Hills', lat: 17.4239, lng: 78.4738, demandDensity: 390, competitorCount: 14, cannibalizationRisk: 6, avgRentPerSqFt: 88, deliveryEfficiencyScore: 77, opportunityScore: 0 },
  { id: 'hyd_madhapur', city: 'Hyderabad', zone: 'Madhapur', lat: 17.4482, lng: 78.3908, demandDensity: 450, competitorCount: 13, cannibalizationRisk: 7, avgRentPerSqFt: 82, deliveryEfficiencyScore: 80, opportunityScore: 0 },
  { id: 'hyd_banjara', city: 'Hyderabad', zone: 'Banjara Hills', lat: 17.4232, lng: 78.4731, demandDensity: 380, competitorCount: 15, cannibalizationRisk: 8, avgRentPerSqFt: 95, deliveryEfficiencyScore: 75, opportunityScore: 0 },
  { id: 'hyd_kondapur', city: 'Hyderabad', zone: 'Kondapur', lat: 17.4750, lng: 78.3833, demandDensity: 400, competitorCount: 10, cannibalizationRisk: 4, avgRentPerSqFt: 72, deliveryEfficiencyScore: 84, opportunityScore: 0 },
  // Pune
  { id: 'pnq_viman', city: 'Pune', zone: 'Viman Nagar', lat: 18.5674, lng: 73.9142, demandDensity: 400, competitorCount: 12, cannibalizationRisk: 6, avgRentPerSqFt: 78, deliveryEfficiencyScore: 79, opportunityScore: 0 },
  { id: 'pnq_koregaon', city: 'Pune', zone: 'Koregaon Park', lat: 18.5314, lng: 73.8945, demandDensity: 430, competitorCount: 16, cannibalizationRisk: 8, avgRentPerSqFt: 92, deliveryEfficiencyScore: 76, opportunityScore: 0 },
  { id: 'pnq_hinjewadi', city: 'Pune', zone: 'Hinjewadi', lat: 18.5912, lng: 73.7389, demandDensity: 380, competitorCount: 9, cannibalizationRisk: 4, avgRentPerSqFt: 68, deliveryEfficiencyScore: 82, opportunityScore: 0 },
  { id: 'pnq_baner', city: 'Pune', zone: 'Baner', lat: 18.5590, lng: 73.7835, demandDensity: 410, competitorCount: 11, cannibalizationRisk: 5, avgRentPerSqFt: 80, deliveryEfficiencyScore: 81, opportunityScore: 0 },
  { id: 'pnq_kothrud', city: 'Pune', zone: 'Kothrud', lat: 18.5074, lng: 73.8077, demandDensity: 360, competitorCount: 8, cannibalizationRisk: 4, avgRentPerSqFt: 62, deliveryEfficiencyScore: 83, opportunityScore: 0 },
];

export const setupCostsTemplate = {
  equipment: { min: 800000, max: 1200000 },
  renovation: { min: 300000, max: 500000 },
  deposit: { min: 200000, max: 300000 },
  initialInventory: { min: 200000, max: 300000 },
};

export const rampCurve = [
  { month: 1, multiplier: 0.30 },
  { month: 2, multiplier: 0.50 },
  { month: 3, multiplier: 0.70 },
  { month: 4, multiplier: 1.00 },
];

export const readinessCriteria = {
  minNetMargin: 15,
  maxCriticalAlerts: 5,
  minRepeatRate: 25,
  minCashRunwayMonths: 6,
  operationsManagerRequired: 7,
};
