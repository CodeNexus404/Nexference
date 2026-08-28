// Confidence vocabulary for Intelligence Center insights (v1.6.0).
//
// Every insight carries one of these so the UI can explain how trustworthy it is.
// The meanings are fixed and documented in the README; they are NOT percentages.
export const CONFIDENCE = {
  MEASURED: 'MEASURED', // derived from real monitoring or benchmark samples
  OBSERVED: 'OBSERVED', // derived from detected provider/model changes
  CURATED: 'CURATED', // derived from curated registry information
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA', // data exists but is too limited for a conclusion
  UNKNOWN: 'UNKNOWN', // required data is unavailable
};

// Period parsing for ?period=24h|7d|30d|all. Invalid/unknown → default '7d'.
export const PERIODS = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  all: Infinity,
};
export const DEFAULT_PERIOD = '7d';

export function parsePeriod(raw) {
  const p = (raw || '').toString().toLowerCase();
  if (p in PERIODS) return p;
  return DEFAULT_PERIOD;
}

export function periodSince(period) {
  const ms = PERIODS[period];
  if (!ms || ms === Infinity) return null;
  return new Date(Date.now() - ms).toISOString();
}

// Freshness threshold for "stale intelligence" attention (7 days).
export const FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;

// Minimum real samples before a trend is reported as MEASURED rather than
// INSUFFICIENT_DATA. Below this we still show the trend but label it honestly.
export const MIN_SAMPLES_FOR_TREND = 3;
