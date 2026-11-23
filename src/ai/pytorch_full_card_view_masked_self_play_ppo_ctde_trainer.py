"""Optimized full-card PPO trainer (canonical: python_train/train_fullcard_ppo.py)."""
from __future__ import annotations
import sys
from pathlib import Path
_PT = Path(__file__).resolve().parents[2] / "python_train"
if _PT.exists():
    sys.path.insert(0, str(_PT))

from lotm_emulator import (
    ACTION_FEAT_DIM,
    ACTOR_OBS_DIM,
    CRITIC_OBS_DIM,
    LegalAction,
    LotmTarotEnv,
)


class FullCardActorCritic(nn.Module):
    """854→256→Res256→128 actor + [128+48]→128→1 scorer + CTDE critic 1346→…→1."""

    def __init__(
        self,
        obs_dim: int = ACTOR_OBS_DIM,
        critic_dim: int = CRITIC_OBS_DIM,
        act_dim: int = ACTION_FEAT_DIM,
    ):
        super().__init__()
        self.obs_dim = obs_dim
        self.critic_dim = critic_dim
        self.act_dim = act_dim

        self.enc_in = nn.Sequential(nn.Linear(obs_dim, 256), nn.LayerNorm(256), nn.GELU())
        self.enc_res = nn.Sequential(nn.Linear(256, 256), nn.LayerNorm(256), nn.GELU())
        self.enc_out = nn.Sequential(nn.Linear(256, 128), nn.LayerNorm(128), nn.GELU())
        self.scorer = nn.Sequential(nn.Linear(128 + act_dim, 128), nn.GELU(), nn.Linear(128, 1))
        # Fogged value (browser-usable) + privileged CTDE critic
        self.vf_fog = nn.Linear(128, 1)
        self.critic = nn.Sequential(
            nn.Linear(critic_dim, 256),
            nn.LayerNorm(256),
            nn.GELU(),
            nn.Linear(256, 128),
            nn.GELU(),
            nn.Linear(128, 1),
        )

    def encode_state(self, obs: torch.Tensor) -> torch.Tensor:
        h = self.enc_in(obs)
        h = h + self.enc_res(h)
        return self.enc_out(h)

    def score_candidates(self, state_emb: torch.Tensor, act_feats: torch.Tensor) -> torch.Tensor:
        k = act_feats.shape[0]
        s_rep = state_emb.unsqueeze(0).expand(k, -1)
        return self.scorer(torch.cat([s_rep, act_feats], dim=-1)).squeeze(-1)

    def value_ctde(self, critic_obs: torch.Tensor) -> torch.Tensor:
        return self.critic(critic_obs).squeeze(-1)

    def value_fog(self, state_emb: torch.Tensor) -> torch.Tensor:
        return self.vf_fog(state_emb).squeeze(-1)

    @torch.no_grad()
    def act(
        self,
        obs_np: np.ndarray,
        act_feats_np: np.ndarray,
        critic_obs_np: Optional[np.ndarray],
        device: torch.device,
        greedy: bool = False,
    ) -> Tuple[int, float, float]:
        obs_t = torch.as_tensor(obs_np, dtype=torch.float32, device=device)
        act_t = torch.as_tensor(act_feats_np, dtype=torch.float32, device=device)
        s_emb = self.encode_state(obs_t)
        logits = self.score_candidates(s_emb, act_t)
        dist = torch.distributions.Categorical(logits=logits)
        idx = int(torch.argmax(logits).item()) if greedy else int(dist.sample().item())
        log_prob = float(dist.log_prob(torch.tensor(idx, device=device)).item())
        if critic_obs_np is not None:
            v = float(self.value_ctde(torch.as_tensor(critic_obs_np, dtype=torch.float32, device=device)).item())
        else:
            v = float(self.value_fog(s_emb).item())
        return idx, log_prob, v


def clone_cpu(model: FullCardActorCritic) -> FullCardActorCritic:
    m = FullCardActorCritic(model.obs_dim, model.critic_dim, model.act_dim)
    m.load_state_dict({k: v.detach().cpu().clone() for k, v in model.state_dict().items()})
    m.eval()
    return m


def clone_on(model: FullCardActorCritic, device: torch.device) -> FullCardActorCritic:
    m = FullCardActorCritic(model.obs_dim, model.critic_dim, model.act_dim).to(device)
    m.load_state_dict({k: v.detach().clone() for k, v in model.state_dict().items()})
    m.eval()
    return m


@dataclass
class StepRecord:
    obs: np.ndarray
    critic_obs: np.ndarray
    act_feats: np.ndarray
    chosen_idx: int
    old_log_prob: float
    value: float
    reward: float = 0.0


def heuristic_policy(actions: List[LegalAction], act_feats: np.ndarray, depth: int = 3) -> int:
    best_i, best_sc = 0, -1e9
    for i, a in enumerate(actions):
        f = act_feats[i]
        sc = 0.0
        if a.atype == "ASCEND_OR_PASS":
            sc = (14.0 + depth) if a.extra is not None else -1.0
        elif a.atype == "TUCK_POUCH":
            sc = 6.0 * f[37] + 3.0 * f[38] + 2.0 * f[39] + 0.5 * depth
        elif a.atype == "DONE_POUCH":
            sc = 1.2
        elif a.atype == "DRAFT_CARD":
            sc = 8.0 * f[37] + 4.0 * f[38] + 3.0 * f[20] + 2.5 * f[21] + f[18]
        elif a.atype in ("PLAY_TRICK_MINOR", "PLAY_TRICK_MAJOR"):
            sc = 4.0 * f[36] + 1.5 * f[45] + 1.2 * f[46] - 5.0 * f[37] - 3.0 * f[20]
            if depth >= 4:
                sc -= 2.0 * f[37]  # save key pouch ranks
        elif a.atype == "USE_SEQ_ABILITY":
            sc = 3.5 if f[43] < 0.5 else -1.0
        elif a.atype == "PLAY_INSTANT_CHAOS":
            sc = 0.8 + 0.2 * depth
        elif a.atype == "INTERRUPT_BLOCK":
            sc = 2.5
        elif a.atype == "INTERRUPT_PASS":
            sc = 0.5
        elif a.atype == "REWARD_CHOICE":
            sc = 2.5 if (a.extra and a.extra[0] == "take_trump") else (0.5 if depth >= 3 else -0.5)
        if sc > best_sc:
            best_sc, best_i = sc, i
    return best_i


def collect_episode(
    env: LotmTarotEnv,
    learner: FullCardActorCritic,
    device: torch.device,
    learner_seat: int = 0,
    opponent: Optional[FullCardActorCritic] = None,
    heur_depth: Optional[int] = None,
) -> Tuple[List[StepRecord], Optional[int], int]:
    env.reset()
    traj: List[StepRecord] = []
    guard = 0
    while not env.done and guard < 2500:
        guard += 1
        pid = env.current_player_id()
        actions = env.get_legal_actions(pid)
        if not actions:
            break
        obs = env.get_actor_obs(pid)
        act_feats = env.encode_action_features(pid, actions)

        if pid == learner_seat:
            c_obs = env.get_critic_obs(pid)
            idx, log_p, val = learner.act(obs, act_feats, c_obs, device, greedy=False)
            traj.append(
                StepRecord(
                    obs=obs,
                    critic_obs=c_obs,
                    act_feats=act_feats,
                    chosen_idx=idx,
                    old_log_prob=log_p,
                    value=val,
                )
            )
        elif heur_depth is not None:
            idx = heuristic_policy(actions, act_feats, depth=heur_depth)
        elif opponent is not None:
            idx, _, _ = opponent.act(obs, act_feats, None, device, greedy=True)
        else:
            idx = 0

        step_rewards, done, _ = env.step(actions[idx])
        if traj:
            traj[-1].reward += float(step_rewards.get(learner_seat, 0.0))
        if done:
            break
    return traj, env.winner_id, env.round


def ppo_update(
    model: FullCardActorCritic,
    optimizer: torch.optim.Optimizer,
    trajectories: List[List[StepRecord]],
    device: torch.device,
    gamma: float = 0.99,
    gae_lambda: float = 0.95,
    clip_eps: float = 0.2,
    entropy_coef: float = 0.015,
    value_coef: float = 0.5,
    ppo_epochs: int = 4,
    minibatch_size: int = 128,
) -> Tuple[float, float, float]:
    flat: List[Tuple[StepRecord, float, float]] = []
    for traj in trajectories:
        T = len(traj)
        if T == 0:
            continue
        advs = np.zeros(T, dtype=np.float32)
        gae = 0.0
        for t in reversed(range(T)):
            next_v = 0.0 if t == T - 1 else traj[t + 1].value
            delta = traj[t].reward + gamma * next_v - traj[t].value
            gae = delta + gamma * gae_lambda * gae
            advs[t] = gae
            flat.append((traj[t], float(gae), float(gae + traj[t].value)))

    if not flat:
        return 0.0, 0.0, 0.0

    all_adv = np.array([x[1] for x in flat], dtype=np.float32)
    adv_mean, adv_std = float(all_adv.mean()), float(all_adv.std() + 1e-8)
    flat = [(rec, (adv - adv_mean) / adv_std, ret) for rec, adv, ret in flat]

    tot_pi = tot_v = tot_ent = 0.0
    n_batches = 0
    for _ in range(ppo_epochs):
        random.shuffle(flat)
        for start in range(0, len(flat), minibatch_size):
            batch = flat[start : start + minibatch_size]
            obs_b = torch.as_tensor(np.stack([b[0].obs for b in batch]), dtype=torch.float32, device=device)
            cobs_b = torch.as_tensor(np.stack([b[0].critic_obs for b in batch]), dtype=torch.float32, device=device)
            adv_b = torch.tensor([b[1] for b in batch], dtype=torch.float32, device=device)
            ret_b = torch.tensor([b[2] for b in batch], dtype=torch.float32, device=device)
            old_lp_b = torch.tensor([b[0].old_log_prob for b in batch], dtype=torch.float32, device=device)

            s_embs = model.encode_state(obs_b)
            v_ctde = model.value_ctde(cobs_b)
            v_fog = model.value_fog(s_embs)

            new_lps, ents = [], []
            for j, (rec, _, _) in enumerate(batch):
                af_t = torch.as_tensor(rec.act_feats, dtype=torch.float32, device=device)
                logits = model.score_candidates(s_embs[j], af_t)
                dist = torch.distributions.Categorical(logits=logits)
                new_lps.append(dist.log_prob(torch.tensor(rec.chosen_idx, device=device)))
                ents.append(dist.entropy())
            new_lp_b = torch.stack(new_lps)
            ent_b = torch.stack(ents)
            ratios = torch.exp(new_lp_b - old_lp_b)
            surr1 = ratios * adv_b
            surr2 = torch.clamp(ratios, 1.0 - clip_eps, 1.0 + clip_eps) * adv_b
            pi_loss = -torch.min(surr1, surr2).mean()
            v_loss = 0.5 * (
                F.smooth_l1_loss(v_ctde, ret_b) + 0.25 * F.smooth_l1_loss(v_fog, ret_b)
            )
            ent_mean = ent_b.mean()
            loss = pi_loss + value_coef * v_loss - entropy_coef * ent_mean

            optimizer.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 0.5)
            optimizer.step()

            tot_pi += float(pi_loss.item())
            tot_v += float(v_loss.item())
            tot_ent += float(ent_mean.item())
            n_batches += 1

    n = max(1, n_batches)
    return tot_pi / n, tot_v / n, tot_ent / n


@torch.no_grad()
def evaluate_vs_heuristic(
    model: FullCardActorCritic, device: torch.device, games: int = 40, depth: int = 3
) -> Tuple[float, float, float]:
    env = LotmTarotEnv(player_count=2, max_rounds=50)
    wins = draws = 0
    rounds_sum = 0
    for g in range(games):
        seat = g % 2
        env.reset(seed=20_000 + g)
        guard = 0
        while not env.done and guard < 2500:
            guard += 1
            pid = env.current_player_id()
            actions = env.get_legal_actions(pid)
            if not actions:
                break
            act_feats = env.encode_action_features(pid, actions)
            if pid == seat:
                obs = env.get_actor_obs(pid)
                idx, _, _ = model.act(obs, act_feats, None, device, greedy=True)
            else:
                idx = heuristic_policy(actions, act_feats, depth=depth)
            env.step(actions[idx])
        if env.winner_id == seat:
            wins += 1
        elif env.winner_id is None:
            draws += 1
        rounds_sum += env.round
    wr = wins / max(1, games)
    return wr, rounds_sum / max(1, games), draws / max(1, games)


def export_actor_json(model: FullCardActorCritic, path: str, games_trained: int = 0) -> None:
    """Export actor (+ fog value) for inference; drops CTDE critic."""
    sd = {
        k: v.detach().cpu().numpy().tolist()
        for k, v in model.state_dict().items()
        if not k.startswith("critic.")
    }
    payload = {
        "format": "lotm_fullcard_ppo_v1",
        "obsDim": model.obs_dim,
        "actDim": model.act_dim,
        "criticDim": model.critic_dim,
        "gamesTrained": games_trained,
        "arch": {
            "enc": "854->256 LN GELU + Res256 + 128 LN GELU",
            "scorer": "[128+48]->128 GELU->1",
            "vf_fog": "128->1",
        },
        "state_dict": sd,
    }
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(payload), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description="LoTM full-card Masked PPO + CTDE + PFSP")
    ap.add_argument("--updates", type=int, default=100)
    ap.add_argument("--episodes-per-update", type=int, default=24)
    ap.add_argument("--lr", type=float, default=2.5e-4)
    ap.add_argument("--heur-mix", type=float, default=0.45, help="fraction of episodes vs heuristic curriculum")
    ap.add_argument("--device", type=str, default="cuda" if torch.cuda.is_available() else "cpu")
    ap.add_argument("--export-json", type=str, default=str(Path(__file__).parent / "exports" / "lotm_fullcard.json"))
    ap.add_argument("--eval-every", type=int, default=10)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    device = torch.device(args.device if args.device != "cuda" or torch.cuda.is_available() else "cpu")
    model = FullCardActorCritic().to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)

    pool: List[FullCardActorCritic] = [clone_cpu(model)]
    pool_losses: List[float] = [1.0]
    env = LotmTarotEnv(player_count=2, max_rounds=50)
    spar_depth = 2
    best_wr = -1.0
    t0 = time.time()
    games_trained = 0

    n_params = sum(p.numel() for p in model.parameters())
    print(
        f"device={device} params={n_params:,} obs={ACTOR_OBS_DIM} critic={CRITIC_OBS_DIM} act={ACTION_FEAT_DIM}",
        flush=True,
    )

    for upd in range(1, args.updates + 1):
        trajs: List[List[StepRecord]] = []
        wins = 0
        for ep in range(args.episodes_per_update):
            seat = ep % 2
            use_heur = random.random() < args.heur_mix
            if use_heur:
                opp = None
                hd = spar_depth
            else:
                weights = np.array(pool_losses, dtype=np.float64) ** 2 + 0.05
                opp_idx = int(np.random.choice(len(pool), p=weights / weights.sum()))
                opp = clone_on(pool[opp_idx], device)
                hd = None

            traj, winner, _ = collect_episode(
                env, model, device, learner_seat=seat, opponent=opp, heur_depth=hd
            )
            trajs.append(traj)
            games_trained += 1
            won = winner == seat
            if won:
                wins += 1
            if not use_heur:
                # update PFSP loss estimate for sampled opp
                # find matching pool entry by identity of last clone source index
                pool_losses[opp_idx] = 0.9 * pool_losses[opp_idx] + 0.1 * (0.0 if won else 1.0)

        pi_l, v_l, ent = ppo_update(model, opt, trajs, device)
        sp_wr = wins / max(1, args.episodes_per_update)
        print(
            f"[upd {upd:4d}/{args.updates}] selfWR={sp_wr:5.1%} spar=D{spar_depth} "
            f"pi={pi_l:+.4f} v={v_l:.4f} ent={ent:.3f} t={time.time()-t0:.0f}s",
            flush=True,
        )

        if upd % args.eval_every == 0 or upd == args.updates:
            pool.append(clone_cpu(model))
            pool_losses.append(0.5)
            if len(pool) > 14:
                pool.pop(1)
                pool_losses.pop(1)

            wr, avg_rds, draw_r = evaluate_vs_heuristic(model, device, games=40, depth=spar_depth)
            print(
                f"  eval vs D{spar_depth}: WR={wr:5.1%} draw={draw_r:5.1%} avgRds={avg_rds:4.1f}",
                flush=True,
            )
            if wr >= 0.48 and spar_depth < 6:
                spar_depth += 1
                print(f"  curriculum ↑ D{spar_depth}", flush=True)
            if wr > best_wr:
                best_wr = wr
                export_actor_json(model, args.export_json, games_trained=games_trained)
                print(f"  saved best → {args.export_json}", flush=True)

    export_actor_json(model, args.export_json, games_trained=games_trained)
    print(f"done → {args.export_json} (best_eval={best_wr:.1%})", flush=True)


if __name__ == "__main__":
    main()

