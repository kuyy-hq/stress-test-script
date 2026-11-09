// A2. Detail of the hot event (about 2,500 guests) next to a control event (10 guests). Hypothesis H2.
// Pass: p95 of read_hot is at most 2x read_control. "make report" prints the ratio from the summary.
// Run it twice: once with a cold Redis cache and once warm.
import { arrivalScenario } from '../lib/profiles.js';
import { thresholds } from '../lib/thresholds.js';
import { controlEventDetail, hotEventDetail, hotEventDetailSignedIn, hotEventMembers } from '../lib/actions.js';

export const options = {
  scenarios: { a2: arrivalScenario() },
  thresholds: thresholds(['read_hot', 'read_control']),
};

export default function () {
  const roll = Math.random();
  if (roll < 0.4) hotEventDetail();
  else if (roll < 0.6) hotEventDetailSignedIn();
  else if (roll < 0.8) hotEventMembers();
  else controlEventDetail();
}
