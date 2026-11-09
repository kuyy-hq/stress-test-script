// Load shapes from the plan. "100% target" is TARGET_RPS.
//   smoke     1 rps for 30 s                          check that script and data work
//   baseline  15% for 10 min                          reference numbers
//   load      ramp to 100% in 5 min, hold 15 min      normal peak
//   stress    +20% every 3 min up to 300%             find the first component to fail
//   spike     0 to 300% in 30 s, hold 3 min, drop     booking opens
//   soak      60% for 2 hours                         memory leaks and dead tuples
//
// DURATION_SCALE shortens every duration for a dry run, for example DURATION_SCALE=0.05.
import { PROFILE, TARGET_RPS } from './config.js';
import { tokensMustLast } from './auth.js';

const SCALE = Number(__ENV.DURATION_SCALE || 1);

function seconds(sec) {
  return `${Math.max(1, Math.round(sec * SCALE))}s`;
}

function step(rate, sec) {
  return { target: Math.max(1, Math.round(rate)), duration: seconds(sec) };
}

export function arrivalStages(profile = PROFILE, target = TARGET_RPS) {
  switch (profile) {
    case 'smoke':
      return [step(1, 30)];
    case 'baseline':
      return [step(0.15 * target, 60), step(0.15 * target, 540)];
    case 'load':
      return [step(target, 300), step(target, 900)];
    case 'stress':
      return Array.from({ length: 15 }, (_, i) => step(target * 0.2 * (i + 1), 180));
    case 'spike':
      return [step(target * 3, 30), step(target * 3, 180), step(1, 30)];
    case 'soak':
      return [step(0.6 * target, 300), step(0.6 * target, 7200)];
    default:
      throw new Error(`unknown PROFILE "${profile}" (smoke, baseline, load, stress, spike, soak)`);
  }
}

// An open model: requests arrive at the planned rate whatever the latency, as real visitors do.
export function arrivalScenario({ exec, weight = 1, profile = PROFILE, target = TARGET_RPS, requiresToken = true } = {}) {
  const rate = target * weight;
  const scenario = {
    executor: 'ramping-arrival-rate',
    startRate: 1,
    timeUnit: '1s',
    // VUs needed = rate x latency. Start small, let k6 add more, and cap the total so that a saturated target
    // cannot exhaust the memory of the machine running k6. An iteration that finds no free VU is counted in
    // dropped_iterations: the target (or the generator) could not keep up with the planned rate.
    preAllocatedVUs: Number(__ENV.PRE_ALLOCATED_VUS || Math.min(Math.ceil(rate * 0.1) + 20, 500)),
    maxVUs: Number(__ENV.MAX_VUS || Math.min(Math.ceil(rate * 2) + 100, 6000)),
    stages: arrivalStages(profile, rate),
  };
  if (exec) scenario.exec = exec;
  if (requiresToken) tokensMustLast(scenario.stages.reduce((total, s) => total + parseInt(s.duration, 10), 0));
  return scenario;
}
