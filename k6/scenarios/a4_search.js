// A4. Activity search. Hypothesis H6 (ILIKE '%...%'). The route is limited to 10 req/s per client IP
// (searchActivitiesRate). SPREAD_IP must stay false in production, where 429 is expected and counted separately.
import { arrivalScenario } from '../lib/profiles.js';
import { thresholds } from '../lib/thresholds.js';
import { searchActivities } from '../lib/actions.js';

export const options = {
  scenarios: { a4: arrivalScenario({ requiresToken: false }) },
  thresholds: thresholds(['search']),
};

export default function () {
  searchActivities(true);
}
