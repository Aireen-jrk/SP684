export const SERVICE_LEVEL_CONFIG = {
  HIGH: 0.95,     // เดิม 0.95
  MID: 0.93,      // เดิม 0.93
  LOW: 0.50,      // เดิม 0.50
  HIGH_THRESHOLD: 4,  // เดิม f > 4
  MID_THRESHOLD: 2,   // เดิม f > 2 && f <= 4
};

// 2) Avg Demand Rules
export const AVG_DEMAND_CONFIG = {
  TOTAL_MONTHS: 6,       // เดิม 6 เดือน
  THRESHOLD_RATIO: 0.75, // เดิม 3/4
};

// 3) Fast / Slow Moving Classification
export const MOVING_CONFIG = {
  FAST_TREND_MIN: 1,      // เดิม trend >= 1
  FAST_TURNOVER_MAX: 2,   // เดิม turnover <= 2
  SLOW_TURNOVER_MIN: 6,   // เดิม turnover >= 6
};