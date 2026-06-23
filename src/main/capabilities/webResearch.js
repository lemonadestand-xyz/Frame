/**
 * WebResearch capability — v1 stub.
 *
 * Returns a single warning Evidence so the supervisor classifier sees
 * the capability "ran but found nothing actionable." Replace this with a
 * real WebFetch/WebSearch integration when that infrastructure lands
 * (follow-up to frame-capabilities-registry).
 */

const { Capability } = require('./types');

class WebResearch extends Capability {
  // eslint-disable-next-line class-methods-use-this
  async run() {
    return [{
      source: 'web_research',
      summary: 'web_research not implemented (stub)',
      refs: [],
      score: 0,
    }];
  }
}

WebResearch.name = 'web_research';

module.exports = { WebResearch };
