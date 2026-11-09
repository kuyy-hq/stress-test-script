// Pass criteria from the plan. They are PROPOSALS: replace them once a baseline exists.
// [p95 in ms, p99 in ms, maximum failed-request rate]
const LIMITS = {
  read_public: [400, 900, 0.005],
  read_hot: [400, 900, 0.005],
  read_control: [400, 900, 0.005],
  read_login: [600, 1200, 0.01],
  search: [800, 1500, 0.01],
  join: [1000, 2500, 0.01],
  dashboard: [1500, 4000, 0.01],
  web: [1200, 2500, 0.01],
};

// Hard invariants: a single one fails the run.
const HARD = {
  status_403: ['count==0'],
  status_5xx: ['count==0'],
  // A dropped iteration is load that was not delivered: the target, or the machine running k6, fell behind.
  dropped_iterations: ['count==0'],
};

export function thresholds(kinds, extra = {}) {
  const t = { ...HARD };
  for (const kind of kinds) {
    const [p95, p99, failed] = LIMITS[kind];
    t[`http_req_duration{kind:${kind}}`] = [`p(95)<${p95}`, `p(99)<${p99}`];
    t[`http_req_failed{kind:${kind}}`] = [`rate<${failed}`];
  }
  return { ...t, ...extra };
}
