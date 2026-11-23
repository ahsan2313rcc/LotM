"""
Parity smoke: Python emulator ability/chaos go through live engineCore.js (no stub fallthrough).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ["LOTM_JS_RULES"] = "1"

from lotm_emulator import LotmTarotEnv, Card, PATHWAY_SEQ_TAGS  # noqa: E402
from js_rules_client import get_bridge, env_to_js_state  # noqa: E402


def _pick_tag_not_draw1(env) -> tuple:
    p = env.players[0]
    tag = PATHWAY_SEQ_TAGS.get(p.pathway_id, {}).get(p.seq)
    if tag and tag != "draw_1_peek":
        return p, tag
    for pl in env.players:
        for seq, t in PATHWAY_SEQ_TAGS.get(pl.pathway_id, {}).items():
            if t and t not in ("draw_1_peek",):
                pl.seq = seq
                return pl, t
    return p, tag or "clown_shield"


def test_bridge_ping():
    b = get_bridge()
    assert b._request({"op": "ping"}).get("ok")


def test_ability_changes_state():
    env = LotmTarotEnv(player_count=2, seed=7)
    p, tag = _pick_tag_not_draw1(env)
    before = (len(p.hand), len(env.deck), len(env.grave), dict(p.mods), p.acting_done)
    # Force a tag that always mutates: abolish_trump
    tag = "abolish_trump"
    env._resolve_ability(p, tag, None)
    after = (len(p.hand), len(env.deck), len(env.grave), dict(p.mods), p.acting_done)
    assert env.round_mods.get("abolishTrump") is True, (tag, before, after, env.round_mods)
    fallbacks = [ln for ln in env.netlist_lines if "fallback" in ln]
    assert not fallbacks, fallbacks


def test_chaos_recycle_via_js():
    env = LotmTarotEnv(player_count=2, seed=11)
    p = env.players[0]
    # Put a major in hand
    major = next(c for c in env.deck if c.is_major and c.major_id == 4)
    env.deck = [c for c in env.deck if c.cid != major.cid]
    p.hand.append(major)
    env._resolve_chaos(p, major, env.players[1])
    assert major.cid not in {c.cid for c in p.hand}
    assert major.cid in {c.cid for c in env.deck}  # recycled into deck by JS
    assert env.round_mods.get("invertTrick") is True
    fallbacks = [ln for ln in env.netlist_lines if "fallback" in ln]
    assert not fallbacks, fallbacks


def test_no_stub_on_missing_python_tags():
    """Tags that used to fall through to draw-1 in Python must hit JS instead."""
    env = LotmTarotEnv(player_count=2, seed=3)
    p = env.players[0]
    # balancer_equalize / world_tree / harvest_draw are in engineCore; force world_tree
    hand_before = len(p.hand)
    env._resolve_ability(p, "world_tree", None)
    assert p.mods.get("pouchImmune") is True
    assert p.mods.get("mathLeeway") == 2
    # world_tree does not draw; stub would draw 1
    assert len(p.hand) == hand_before
    fallbacks = [ln for ln in env.netlist_lines if "fallback" in ln]
    assert not fallbacks, fallbacks


def test_game_smoke_with_js():
    env = LotmTarotEnv(player_count=2, max_rounds=12, seed=42)
    steps = 0
    while not env.done and steps < 400:
        acts = env.get_legal_actions()
        if not acts:
            break
        env.step(acts[0])
        steps += 1
    fallbacks = [ln for ln in env.netlist_lines if "fallback" in ln]
    assert not fallbacks, fallbacks[:5]
    assert len(env.netlist_lines) >= 1
    print(f"game_smoke steps={steps} done={env.done} winner={env.winner_id} netlist={len(env.netlist_lines)}")


if __name__ == "__main__":
    test_bridge_ping()
    print("ping ok")
    test_ability_changes_state()
    print("ability ok")
    test_chaos_recycle_via_js()
    print("chaos ok")
    test_no_stub_on_missing_python_tags()
    print("no-stub ok")
    test_game_smoke_with_js()
    print("ALL PARITY SMOKES PASSED")
