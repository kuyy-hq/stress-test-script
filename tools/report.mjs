// Prints the numbers of a k6 summary (make run writes results/<scenario>-<profile>.json) as a table,
// and applies the pass rules that need two series: hot event versus control event.
//
//   node tools/report.mjs results/a2-load.json
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/report.mjs <k6 summary json>');
  process.exit(2);
}

const summary = JSON.parse(fs.readFileSync(file, 'utf8'));
const metrics = summary.metrics || {};
// Older k6 nests the numbers under "values"; newer versions put them next to "thresholds".
const values = (name) => (metrics[name] ? metrics[name].values || metrics[name] : undefined);
const ms = (n) => (typeof n === 'number' ? `${n.toFixed(0)} ms` : '-');

const durations = Object.keys(metrics).filter((k) => k.startsWith('http_req_duration{kind:'));
console.log('\nLatency by kind');
console.log('kind'.padEnd(16), 'p95'.padStart(10), 'p99'.padStart(10), 'avg'.padStart(10));
for (const key of durations) {
  const v = values(key);
  console.log(key.replace('http_req_duration{kind:', '').replace('}', '').padEnd(16), ms(v['p(95)']).padStart(10), ms(v['p(99)']).padStart(10), ms(v.avg).padStart(10));
}

console.log('\nCounters');
for (const name of ['status_403', 'status_5xx', 'status_429', 'status_422', 'join_ok', 'join_refused', 'join_other']) {
  const v = values(name);
  if (v) console.log(name.padEnd(16), String(v.count ?? v.value ?? 0).padStart(10));
}

const requests = values('http_reqs');
if (requests) console.log(`\nRequests: ${requests.count} in total, ${Number(requests.rate).toFixed(0)} per second averaged over the whole run (ramp-up included)`);
const dropped = values('dropped_iterations');
if (dropped && dropped.count > 0) {
  console.log(`WARNING: ${dropped.count} iterations were dropped. The target, or the machine running k6, could not keep up with the planned rate.`);
}

const hot = values('http_req_duration{kind:read_hot}');
const control = values('http_req_duration{kind:read_control}');
if (hot && control && control['p(95)'] > 0) {
  const ratio = hot['p(95)'] / control['p(95)'];
  console.log(`\nHot vs control p95: ${ratio.toFixed(2)}x  ${ratio <= 2 ? 'PASS (at most 2x)' : 'FAIL (more than 2x)'}`);
}

// In "k6 run --summary-export" a threshold maps to true when it was BREACHED and false when it held.
// Newer exports may use an object {ok: boolean} instead.
const breached = (t) => (typeof t === 'object' && t !== null ? t.ok === false : t === true);
const failedThresholds = Object.entries(metrics).flatMap(([name, m]) =>
  Object.entries(m.thresholds || {}).filter(([, t]) => breached(t)).map(([rule]) => `${name}: ${rule}`));
console.log(failedThresholds.length ? `\nFailed thresholds:\n  ${failedThresholds.join('\n  ')}` : '\nAll thresholds passed.');
