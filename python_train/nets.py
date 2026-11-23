"""State-encoder + action-candidate scorer + CTDE critic (Small / Medium)."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Any, Optional

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from lotm_env import obs as O


def tier_config(name: str) -> Dict[str, int]:
    name = name.lower()
    if name in ("small", "easy", "compact"):
        return dict(obs_dim=O.SMALL_OBS, act_dim=O.SMALL_ACT, h1=128, h2=64, act_h=64, critic_h=128)
    # medium
    return dict(obs_dim=O.MED_OBS, act_dim=O.MED_ACT, h1=256, h2=128, act_h=128, critic_h=256)


class CandidatePolicy(nn.Module):
    """Actor: fogged obs. Critic: privileged obs (CTDE)."""

    def __init__(self, tier: str = "small"):
        super().__init__()
        cfg = tier_config(tier)
        self.tier = tier
        self.obs_dim = cfg["obs_dim"]
        self.act_dim = cfg["act_dim"]
        self.h1, self.h2 = cfg["h1"], cfg["h2"]
        self.act_h = cfg["act_h"]
        ch = cfg["critic_h"]

        self.enc1 = nn.Linear(self.obs_dim, self.h1)
        self.enc2 = nn.Linear(self.h1, self.h2)
        self.act1 = nn.Linear(self.h2 + self.act_dim, self.act_h)
        self.act2 = nn.Linear(self.act_h, 1)
        # Fogged value (browser-compatible, from h2)
        self.vf = nn.Linear(self.h2, 1)

        # Centralized critic on privileged obs (training only)
        self.crit1 = nn.Linear(self.obs_dim, ch)
        self.crit2 = nn.Linear(ch, ch // 2)
        self.crit3 = nn.Linear(ch // 2, 1)

    def encode(self, obs: torch.Tensor) -> torch.Tensor:
        h = torch.tanh(self.enc1(obs))
        return torch.tanh(self.enc2(h))

    def score(self, h2: torch.Tensor, act: torch.Tensor) -> torch.Tensor:
        # h2: [B,H] or [H], act: [B,A] or [N,A]
        if h2.dim() == 1:
            h2 = h2.unsqueeze(0).expand(act.shape[0], -1)
        x = torch.cat([h2, act], dim=-1)
        return self.act2(torch.tanh(self.act1(x))).squeeze(-1)

    def value_ctde(self, critic_obs: torch.Tensor) -> torch.Tensor:
        h = torch.tanh(self.crit1(critic_obs))
        h = torch.tanh(self.crit2(h))
        return self.crit3(h).squeeze(-1)

    def value_fog(self, obs: torch.Tensor) -> torch.Tensor:
        h2 = self.encode(obs)
        return self.vf(h2).squeeze(-1)

    def act(self, obs_np, act_vecs, critic_obs_np=None, deterministic=False):
        device = next(self.parameters()).device
        obs = torch.as_tensor(obs_np, dtype=torch.float32, device=device)
        acts = torch.as_tensor(np.stack(act_vecs), dtype=torch.float32, device=device)
        with torch.no_grad():
            h2 = self.encode(obs)
            logits = self.score(h2, acts)
            dist = torch.distributions.Categorical(logits=logits)
            idx = torch.argmax(logits) if deterministic else dist.sample()
            logp = dist.log_prob(idx)
            ent = dist.entropy()
            if critic_obs_np is not None:
                v = self.value_ctde(torch.as_tensor(critic_obs_np, dtype=torch.float32, device=device))
            else:
                v = self.vf(h2).squeeze(-1)
        return int(idx.item()), float(logp.item()), float(v.item()), float(ent.item())

    def evaluate(self, obs, acts_padded, mask, actions, critic_obs):
        h2 = self.encode(obs)
        B, M, A = acts_padded.shape
        flat = acts_padded.reshape(B * M, A)
        h2e = h2.unsqueeze(1).expand(-1, M, -1).reshape(B * M, -1)
        logits = self.score(h2e, flat).view(B, M)
        logits = logits.masked_fill(~mask, -1e9)
        dist = torch.distributions.Categorical(logits=logits)
        logp = dist.log_prob(actions)
        ent = dist.entropy()
        v = self.value_ctde(critic_obs)
        v_fog = self.vf(h2).squeeze(-1)
        return logp, ent, v, v_fog

    def export_json(self, path: str, games_trained: int = 0):
        def ten(t: torch.Tensor):
            return t.detach().cpu().numpy().tolist()

        payload = {
            "format": "compact_ascent_v1",
            "tier": self.tier,
            "obsDim": self.obs_dim,
            "actDim": self.act_dim,
            "h1Dim": self.h1,
            "h2Dim": self.h2,
            "actHidDim": self.act_h,
            "gamesTrained": games_trained,
            "weights": {
                "w1": ten(self.enc1.weight),
                "b1": ten(self.enc1.bias),
                "w2": ten(self.enc2.weight),
                "b2": ten(self.enc2.bias),
                "wa1": ten(self.act1.weight),
                "ba1": ten(self.act1.bias),
                "wa2": ten(self.act2.weight),
                "ba2": ten(self.act2.bias),
                "wv": ten(self.vf.weight),
                "bv": ten(self.vf.bias),
            },
        }
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(json.dumps(payload), encoding="utf-8")
        return path
