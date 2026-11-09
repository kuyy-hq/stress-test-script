// D1. The host dashboard pass holder list, paged 20 times, for a host whose holders include accounts without
// a username. Hypotheses H7 and H9 (KUYY-70). A 500 means a holder without a username broke the page.
import { need } from '../lib/fixtures.js';
import { tokenOfUser } from '../lib/auth.js';
import { arrivalScenario } from '../lib/profiles.js';
import { thresholds } from '../lib/thresholds.js';
import { passHolderCount, passHolderPages } from '../lib/actions.js';

export const options = {
  // A dashboard visit is a burst of about 21 requests, so the arrival rate counts visits.
  scenarios: { d1: arrivalScenario({ target: Number(__ENV.TARGET_VISITS || 2) }) },
  thresholds: thresholds(['dashboard']),
};

export function setup() {
  return { hostToken: tokenOfUser(need('pass_host_id')) };
}

export default function (data) {
  passHolderCount(data.hostToken);
  passHolderPages(data.hostToken, Number(__ENV.PAGES || 20));
}
