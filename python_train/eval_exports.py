"""Eval exported Small / Medium / Fullcard weights vs heuristic depths."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import torch

from lotm_env.env import LotmEnv, heuristic_action
from nets import CandidatePolicy
from train_fullcard_ppo import FullCardActorCritic, evaluate_vs_heuristic

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print("device", device, flush=True)


def eval_compact(path: Path, tier: str, depths=(2, 3, 4, 5, 6), games=60):
    js = json.loads(path.read_text(encoding="utf-8"))
    net = CandidatePolicy(tier).to(device)
    w = js["weights"]

    def load(lin, W, b):
        lin.weight.data.copy_(torch.tensor(W, device=device))
        lin.bias.data.copy_(torch.tensor(b, device=device))

    load(net.enc1, w["w1"], w["b1"])
    load(net.enc2, w["w2"], w["b2"])
    load(net.act1, w["wa1"], w["ba1"])
    load(net.act2, w["wa2"], w["ba2"])
    load(net.vf, w["wv"], w["bv"])
    net.eval()
    print(
        f"\n=== {tier.upper()} compact (gamesTrained={js.get('gamesTrained')}, obs={js['obsDim']}) ===",
        flush=True,
    )
    for depth in depths:
        wins = draws = 0
        for g in range(games):
            e = LotmEnv(obs_dim=js["obsDim"], act_dim=js["actDim"], max_rounds=40)
            info = e.reset(seed=5000 + g + depth * 1000)
            steps = 0
            while not info["done"] and steps < 800:
                if info["seat"] == 0:
                    idx, _, _, _ = net.act(info["obs"], info["action_vecs"], deterministic=True)
                else:
                    idx = heuristic_action(info, depth)
                info, _, _, _ = e.step(idx)
                steps += 1
            if e.winner == 0:
                wins += 1
            elif e.winner is None:
                draws += 1
        print(f"  vs D{depth}: {wins}/{games} = {100 * wins / games:.0f}%  (draw {draws})", flush=True)


def eval_fullcard(path: Path, depths=(2, 3, 4), games=40):
    js = json.loads(path.read_text(encoding="utf-8"))
    model = FullCardActorCritic().to(device)
    sd = js["state_dict"]
    cur = model.state_dict()
    mapped = {k: torch.tensor(v, device=device) for k, v in sd.items() if k in cur}
    model.load_state_dict(mapped, strict=False)
    model.eval()
    print(
        f"\n=== FULLCARD (gamesTrained={js.get('gamesTrained')}, obs={js['obsDim']}) ===",
        flush=True,
    )
    for depth in depths:
        wr, avg_r, dr = evaluate_vs_heuristic(model, device, games=games, depth=depth)
        print(f"  vs D{depth}: WR={100 * wr:.0f}%  draw={100 * dr:.0f}%  avgRds={avg_r:.1f}", flush=True)


def main():
    ex = Path(__file__).parent / "exports"
    eval_compact(ex / "lotm_small.json", "small")
    eval_compact(ex / "lotm_medium.json", "medium")
    eval_fullcard(ex / "lotm_fullcard.json")


if __name__ == "__main__":
    main()
