// Targets and sizing, all from environment variables (the Makefile passes them with -e).
//
// The KUYY API is mounted under /api (cmd/app/main.go: router.Mount("/api", ...)), so BASE_URL is the host only.

function required(name) {
  const value = __ENV[name];
  if (!value) {
    throw new Error(`${name} is not set. Start k6 through "make run" or "make smoke", which sets it.`);
  }
  return value;
}

export const API = (__ENV.BASE_URL || 'http://localhost:3333').replace(/\/+$/, '') + '/api';
export const WEB = (__ENV.WEB_URL || 'http://localhost:3000').replace(/\/+$/, '');

// 100% of the target traffic, in requests per second. Take it from the production peak, not from a guess.
export const TARGET_RPS = Number(__ENV.TARGET_RPS || 20);
export const PROFILE = __ENV.PROFILE || 'load';

// Sent as X-Stress-Run on every request, so one run can be found again in the server's logs.
export const RUN_ID = __ENV.RUN_ID || 'manual';

// Different X-Forwarded-For per request spreads the per-IP rate limiters of search and check-in
// (transports.ClientIP reads the second hop from the end). Only for a test environment.
export const SPREAD_IP = __ENV.SPREAD_IP !== 'false';

export const TOKENS_FILE = required('TOKENS_FILE');
export const FIXTURES_FILE = required('FIXTURES_FILE');
