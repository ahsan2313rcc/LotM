#!/usr/bin/env python3
"""
PPO + CTDE + PFSP trainer for LoTM Small/Medium candidate-scorer nets.

Usage:
  python ppo_train.py --tier small --steps 200000 --device cuda
  python ppo_train.py --tier medium --steps 500000 --device cuda
"""
from __future__ import annotations

import argparse
import copy
import os
import random
import time
from collections import deque
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim

from lotm_env.env import LotmEnv, heuristic_action
from lotm_env import obs as O
from nets import CandidatePolicy, tier_config


def pad_acts(vecs, max_a, act_dim):
    arr = np.zeros((max_a, act_dim), dtype=np.float32)
    mask = np.zeros(max_a, dtype=bool)
    n = min(len(vecs), max_a)
    for i in range(n):
        arr[i] = vecs[i]
        mask[i] = True
    return arr, mask, n


def rollout_episode(env, policy, opp_policy, device, max_a=24, spar_heur=None):
    """Self-play or vs heuristic. Returns trajectory dict for seat 0 learner."""
    info = env.reset()
    traj = []
    ep_ret = 0.0
    steps = 0
    while not info["done"] and steps < 500:
        seat = info["seat"]
        acts = info["action_vecs"]
        if not acts:
            break
        if seat == 0:
            idx, logp, val, _ = policy.act(info["obs"], acts, info["critic_obs"], deterministic=False)
            a_pad, a_mask, _ = pad_acts(acts, max_a, env.act_dim)
            traj.append({
                "obs": info["obs"].copy(),
                "critic_obs": info["critic_obs"].copy(),
                "acts": a_pad,
                "mask": a_mask,
                "action": idx,
                "logp": logp,
                "value": val,
                "reward": 0.0,
            })
            info, r, done, extra = env.step(idx)
            traj[-1]["reward"] = r
            ep_ret += r
        else:
            if spar_heur is not None:
                idx = heuristic_action(info, depth=spar_heur)
            elif opp_policy is not None:
                idx, _, _, _ = opp_policy.act(info["obs"], acts, None, deterministic=True)
            else:
                idx = 0
            info, r, done, extra = env.step(idx)
        steps += 1
        if done:
            break

    winner = env.winner
    # Terminal credit on last learner step (esp. timeout / opp win while seat 1 acted last)
    if traj:
        seqs = [p["seq"] for p in env.state["players"]]
        if winner == 0:
            traj[-1]["reward"] += 0.25
        elif winner == 1:
            traj[-1]["reward"] -= 1.0
        else:
            # true draw: slight penalty + seq shaping
            traj[-1]["reward"] += 0.15 * (seqs[1] - seqs[0]) - 0.2
    return traj, winner, env.state["round"], ep_ret


def compute_gae(traj, gamma=0.99, lam=0.95):
    T = len(traj)
    adv = np.zeros(T, dtype=np.float32)
    ret = np.zeros(T, dtype=np.float32)
    gae = 0.0
    next_v = 0.0
    for t in reversed(range(T)):
        r = traj[t]["reward"]
        v = traj[t]["value"]
        delta = r + gamma * next_v - v
        gae = delta + gamma * lam * gae
        adv[t] = gae
        ret[t] = gae + v
        next_v = v
    # normalize
    adv = (adv - adv.mean()) / (adv.std() + 1e-8)
    return adv, ret


def ppo_update(policy, opt, batch, clip=0.2, epochs=4, ent_coef=0.01, vf_coef=0.5, max_a=24):
    device = next(policy.parameters()).device
    obs = torch.as_tensor(np.stack([b["obs"] for b in batch]), dtype=torch.float32, device=device)
    cobs = torch.as_tensor(np.stack([b["critic_obs"] for b in batch]), dtype=torch.float32, device=device)
    acts = torch.as_tensor(np.stack([b["acts"] for b in batch]), dtype=torch.float32, device=device)
    mask = torch.as_tensor(np.stack([b["mask"] for b in batch]), dtype=torch.bool, device=device)
    actions = torch.as_tensor([b["action"] for b in batch], dtype=torch.long, device=device)
    old_logp = torch.as_tensor([b["logp"] for b in batch], dtype=torch.float32, device=device)
    adv = torch.as_tensor([b["adv"] for b in batch], dtype=torch.float32, device=device)
    ret = torch.as_tensor([b["ret"] for b in batch], dtype=torch.float32, device=device)

    total_loss = 0.0
    for _ in range(epochs):
        logp, ent, v_ctde, v_fog = policy.evaluate(obs, acts, mask, actions, cobs)
        ratio = torch.exp(logp - old_logp)
        surr1 = ratio * adv
        surr2 = torch.clamp(ratio, 1 - clip, 1 + clip) * adv
        pol_loss = -torch.min(surr1, surr2).mean()
        # CTDE critic + light fogged value (for browser)
        vf_loss = 0.5 * ((v_ctde - ret).pow(2).mean() + 0.25 * (v_fog - ret).pow(2).mean())
        loss = pol_loss + vf_coef * vf_loss - ent_coef * ent.mean()
        opt.zero_grad()
        loss.backward()
        nn.utils.clip_grad_norm_(policy.parameters(), 1.0)
        opt.step()
        total_loss += float(loss.item())
    return total_loss / epochs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tier", choices=["small", "medium"], default="small")
    ap.add_argument("--steps", type=int, default=100_000)
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--batch", type=int, default=2048)
    ap.add_argument("--heur-mix", type=float, default=0.35, help="fraction of games vs heuristic curriculum")
    ap.add_argument("--out", default=None)
    ap.add_argument("--eval-every", type=int, default=20_000)
    args = ap.parse_args()

    device = torch.device(args.device if (args.device != "cuda" or torch.cuda.is_available()) else "cpu")
    print(f"device={device} cuda={torch.cuda.is_available()} tier={args.tier}")

    cfg = tier_config(args.tier)
    policy = CandidatePolicy(args.tier).to(device)
    opt = optim.Adam(policy.parameters(), lr=args.lr)

    # PFSP pool of frozen checkpoints
    pfsp_pool = []

    env = LotmEnv(obs_dim=cfg["obs_dim"], act_dim=cfg["act_dim"], max_rounds=40)
    spar_depth = 2
    target_depth = 6

    buf = []
    games = 0
    wins = 0
    t0 = time.time()
    steps_done = 0
    best_wr = 0.0

    out_dir = Path(__file__).resolve().parent / "exports"
    out_dir.mkdir(exist_ok=True)
    out_path = args.out or str(out_dir / f"lotm_{args.tier}.json")

    while steps_done < args.steps:
        # opponent: PFSP or heuristic curriculum
        use_heur = random.random() < args.heur_mix
        opp = None
        heur_d = None
        if use_heur:
            heur_d = spar_depth
        elif pfsp_pool:
            opp = random.choice(pfsp_pool)
        else:
            # frozen self-play opponent via state_dict (avoid CUDA deepcopy stalls)
            opp = CandidatePolicy(args.tier).to(device)
            opp.load_state_dict({k: v.detach().clone() for k, v in policy.state_dict().items()})
            opp.eval()

        traj, winner, rnds, ep_ret = rollout_episode(env, policy, opp, device, spar_heur=heur_d)
        games += 1
        if winner == 0:
            wins += 1
        if not traj:
            continue
        adv, ret = compute_gae(traj)
        for i, tr in enumerate(traj):
            tr["adv"] = float(adv[i])
            tr["ret"] = float(ret[i])
            buf.append(tr)
        steps_done += len(traj)

        if games % 10 == 0:
            print(f"… games={games} steps={steps_done} buf={len(buf)} wr={wins/max(1,games):.1%} t={time.time()-t0:.0f}s", flush=True)

        if len(buf) >= args.batch:
            loss = ppo_update(policy, opt, buf[: args.batch])
            buf = buf[args.batch :]
            # PFSP: CPU snapshot every few updates
            if len(pfsp_pool) < 20 or random.random() < 0.35:
                snap = CandidatePolicy(args.tier)
                snap.load_state_dict({k: v.detach().cpu().clone() for k, v in policy.state_dict().items()})
                snap.eval()
                pfsp_pool.append(snap)
                if len(pfsp_pool) > 20:
                    pfsp_pool.pop(0)

            if games % 40 == 0 or steps_done >= args.steps:
                ev_w = 0
                n_ev = 30
                for _ in range(n_ev):
                    e = LotmEnv(obs_dim=cfg["obs_dim"], act_dim=cfg["act_dim"], max_rounds=40)
                    info = e.reset()
                    guard = 0
                    while not info["done"] and guard < 800:
                        if info["seat"] == 0:
                            idx, _, _, _ = policy.act(info["obs"], info["action_vecs"], deterministic=True)
                        else:
                            idx = heuristic_action(info, depth=spar_depth)
                        info, _, done, _ = e.step(idx)
                        guard += 1
                        if done:
                            break
                    if e.winner == 0:
                        ev_w += 1
                ev_wr = ev_w / n_ev
                if ev_wr >= 0.45 and spar_depth < target_depth:
                    spar_depth += 1
                    print(f"  curriculum ↑ D{spar_depth} (eval {ev_wr:.0%})", flush=True)
                if ev_wr > best_wr:
                    best_wr = ev_wr
                    policy.export_json(out_path, games_trained=games)
                print(
                    f"games={games} steps={steps_done} spar=D{spar_depth} "
                    f"trainWR={wins/max(1,games):.1%} eval@D{spar_depth}={ev_wr:.0%} loss={loss:.3f} "
                    f"t={time.time()-t0:.0f}s",
                    flush=True,
                )
                if games > 200:
                    wins = int(wins * 0.3)
                    games = max(40, int(games * 0.3))

        if steps_done > 0 and steps_done % args.eval_every < max(1, len(traj)):
            policy.export_json(out_path, games_trained=games)

    policy.export_json(out_path, games_trained=games)
    print(f"done → {out_path}")


if __name__ == "__main__":
    main()
