// A1. Public activity list, anonymous. Hypothesis H1: seat counting per candidate event.
import { arrivalScenario } from '../lib/profiles.js';
import { thresholds } from '../lib/thresholds.js';
import { publicList } from '../lib/actions.js';

export const options = {
  scenarios: { a1: arrivalScenario({ requiresToken: false }) },
  thresholds: thresholds(['read_public']),
};

export default function () {
  publicList();
}
