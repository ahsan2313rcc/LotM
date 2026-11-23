/**
 * PolicyNet — State Encoder + Action-Candidate Scorer (browser).
 * Loads weights from python_train exports (format: compact_ascent_v1).
 */
import {
  CompactAscentNet,
  isPolicyNet
} from './compact_browser_nn_state_encoder_action_scorer.js';

export { CompactAscentNet, isPolicyNet };

export const TIER_SMALL = {
  name: 'small',
  tier: 'small',
  obsDim: 180,
  actDim: 32,
  h1Dim: 128,
  h2Dim: 64,
  actHidDim: 64
};

export const TIER_MEDIUM = {
  name: 'medium',
  tier: 'medium',
  obsDim: 650,
  actDim: 48,
  h1Dim: 256,
  h2Dim: 128,
  actHidDim: 128
};

export function tierConfig(tier = 'small') {
  return tier === 'medium' ? TIER_MEDIUM : TIER_SMALL;
}

export function makePolicyNet(tier = 'small', json = null) {
  const cfg = tierConfig(tier);
  if (json?.format === 'compact_ascent_v1' || json?.weights) {
    const net = CompactAscentNet.fromJSON({
      ...cfg,
      tier: json.tier || cfg.tier,
      obsDim: json.obsDim ?? cfg.obsDim,
      actDim: json.actDim ?? cfg.actDim,
      h1Dim: json.h1Dim ?? cfg.h1Dim,
      h2Dim: json.h2Dim ?? cfg.h2Dim,
      actHidDim: json.actHidDim ?? cfg.actHidDim,
      gamesTrained: json.gamesTrained || 0,
      championWinRate: json.championWinRate || 0,
      ascentScore: json.ascentScore || 0,
      weights: json.weights
    });
    net.tier = json.tier || cfg.tier;
    return net;
  }
  const net = new CompactAscentNet({ ...cfg });
  net.tier = cfg.tier;
  return net;
}
