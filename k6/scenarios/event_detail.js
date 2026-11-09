// Public detail of one event from fixtures.hot_event_id.
import { hotEventDetail } from '../lib/actions.js';
import { arrivalScenario } from '../lib/profiles.js';
import { thresholds } from '../lib/thresholds.js';

export const options = {
  scenarios: { event_detail: arrivalScenario({ requiresToken: false }) },
  thresholds: thresholds(['read_hot']),
};

export default function () {
  hotEventDetail();
}
