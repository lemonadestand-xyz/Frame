/**
 * Capability base class.
 *
 * Mirrors the autonomous supervisor's capability protocol — see
 * supervisor/capabilities.py around line 155 for the registry that
 * instantiates these per ProjectProfile.
 *
 * @typedef {Object} Evidence
 * @property {string} source     capability name (e.g. 'spec_reader')
 * @property {string} summary    human-readable summary of the evidence
 * @property {string[]} refs     file paths / URLs the evidence came from
 * @property {number} score      0..1 relevance score
 */

class Capability {
  /**
   * @param {{question: string, context: Object, profile: Object}} _arg
   * @returns {Promise<Evidence[]>}
   */
  // eslint-disable-next-line no-unused-vars
  async run(_arg) {
    throw new Error(`${this.constructor.name}.run: abstract`);
  }
}

Capability.name = '';
Capability.timeoutMs = 2000;

module.exports = { Capability };
