// F1 (burst) and F2 (soak). Repeatedly renders the hot activity page on kuyy-web, anonymously.
// Hypothesis H4: server rendering per request and pod memory.
// PROFILE=spike for F1, PROFILE=soak for F2. During the soak, take two heap snapshots (see README).
import { arrivalScenario } from '../lib/profiles.js';
import { thresholds } from '../lib/thresholds.js';
import { webPage } from '../lib/actions.js';

export const options = {
  scenarios: { f1: arrivalScenario({ target: Number(__ENV.TARGET_WEB_RPS || __ENV.TARGET_RPS || 20), requiresToken: false }) },
  // Web pages are not API calls: a 403 or 5xx counter from the API library still applies.
  thresholds: thresholds(['web']),
};

export default function () {
  webPage();
}
