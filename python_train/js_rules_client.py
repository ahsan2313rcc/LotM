"""
Bridge to live JS ability/chaos (src/ai/engineCore.js) via node js_rules_server.mjs.

Guarantees Python training uses the same resolution tables as headless/live.
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parents[1]
SERVER = Path(__file__).resolve().parent / "js_rules_server.mjs"


def _card_to_js(c) -> Dict[str, Any]:
    return {
        "uid": getattr(c, "uid", None) or getattr(c, "cid", None),
        "cid": getattr(c, "cid", None),
        "type": "major" if getattr(c, "is_major", False) else "minor",
        "suit": getattr(c, "suit", None),
        "rank": getattr(c, "rank", 0) or 0,
        "majorId": getattr(c, "major_id", -1) if getattr(c, "is_major", False) else -1,
    }


def _card_from_js(d: Dict[str, Any]):
    from lotm_emulator import Card

    is_major = d.get("type") == "major"
    cid = d.get("cid")
    if cid is None:
        cid = d.get("uid")
    if is_major:
        mid = int(d.get("majorId", -1))
        if cid is None or (isinstance(cid, (int, float)) and int(cid) < 56 and mid >= 0):
            cid = 56 + mid
        return Card(cid=int(cid), is_major=True, major_id=mid)
    if cid is None:
        suit = d.get("suit") or "swords"
        rank = int(d.get("rank") or 1)
        suit_i = {"swords": 0, "wands": 1, "pentacles": 2, "cups": 3}.get(suit, 0)
        cid = suit_i * 14 + (rank - 1)
    return Card(
        cid=int(cid),
        is_major=False,
        suit=d.get("suit"),
        rank=int(d.get("rank") or 0),
    )


def _player_to_js(p) -> Dict[str, Any]:
    return {
        "id": p.pid,
        "pathwayId": p.pathway_id,
        "seq": p.seq,
        "actingDone": p.acting_done,
        "abilityUsed": p.ability_used,
        "skipNextTurn": p.skip_next_turn,
        "skippedThisRound": p.skipped_this_round,
        "hand": [_card_to_js(c) for c in p.hand],
        "pouch": [_card_to_js(c) for c in p.pouch],
        "mods": dict(p.mods),
        "faceCounts": getattr(p, "face_counts", None) or {"K": 0, "Q": 0, "N": 0, "P": 0},
    }


def _apply_player_from_js(p, d: Dict[str, Any]) -> None:
    p.seq = int(d.get("seq", p.seq))
    p.acting_done = bool(d.get("actingDone", False))
    p.ability_used = bool(d.get("abilityUsed", False))
    p.skip_next_turn = bool(d.get("skipNextTurn", False))
    p.skipped_this_round = bool(d.get("skippedThisRound", False))
    p.mods = dict(d.get("mods") or {})
    p.face_counts = dict(d.get("faceCounts") or {"K": 0, "Q": 0, "N": 0, "P": 0})
    p.hand = [_card_from_js(c) for c in (d.get("hand") or [])]
    p.pouch = [_card_from_js(c) for c in (d.get("pouch") or [])]


def env_to_js_state(env) -> Dict[str, Any]:
    return {
        "players": [_player_to_js(p) for p in env.players],
        "deck": [_card_to_js(c) for c in env.deck],
        "grave": [_card_to_js(c) for c in env.grave],
        "trumpCard": _card_to_js(env.trump_card) if env.trump_card else None,
        "roundMods": dict(env.round_mods),
    }


def apply_js_state(env, state: Dict[str, Any]) -> None:
    for p, d in zip(env.players, state.get("players") or []):
        _apply_player_from_js(p, d)
    env.deck = [_card_from_js(c) for c in (state.get("deck") or [])]
    env.grave = [_card_from_js(c) for c in (state.get("grave") or [])]
    tc = state.get("trumpCard")
    env.trump_card = _card_from_js(tc) if tc else None
    env.round_mods = dict(state.get("roundMods") or {})


class JsRulesBridge:
    """Persistent node process talking to engineCore.js."""

    def __init__(self):
        self._proc: Optional[subprocess.Popen] = None
        self._lock = threading.Lock()
        self._disabled = os.environ.get("LOTM_JS_RULES", "1") == "0"

    def start(self) -> None:
        if self._disabled or self._proc is not None:
            return
        self._proc = subprocess.Popen(
            ["node", str(SERVER)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(ROOT),
            text=True,
            bufsize=1,
        )
        pong = self._request({"op": "ping"})
        if not pong.get("ok"):
            raise RuntimeError(f"js_rules_server ping failed: {pong}")

    def close(self) -> None:
        if self._proc is not None:
            try:
                self._proc.stdin.close()
                self._proc.terminate()
            except Exception:
                pass
            self._proc = None

    def _request(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if self._disabled:
            return {"ok": False, "error": "disabled"}
        if self._proc is None:
            self.start()
        assert self._proc and self._proc.stdin and self._proc.stdout
        with self._lock:
            self._proc.stdin.write(json.dumps(payload) + "\n")
            self._proc.stdin.flush()
            line = self._proc.stdout.readline()
            if not line:
                err = self._proc.stderr.read() if self._proc.stderr else ""
                raise RuntimeError(f"js_rules_server died: {err}")
            return json.loads(line)

    def resolve_ability(self, env, actor, tag: str, target=None, copy_depth: int = 0) -> None:
        resp = self._request(
            {
                "op": "ability",
                "state": env_to_js_state(env),
                "actorId": actor.pid,
                "tag": tag,
                "targetId": None if target is None else target.pid,
                "copyDepth": copy_depth,
            }
        )
        if not resp.get("ok"):
            raise RuntimeError(f"JS ability '{tag}' failed: {resp.get('error')}")
        apply_js_state(env, resp["state"])

    def resolve_chaos(self, env, actor, major, target=None) -> None:
        # major still in hand — server removes it
        resp = self._request(
            {
                "op": "chaos",
                "state": env_to_js_state(env),
                "actorId": actor.pid,
                "majorUid": getattr(major, "uid", None) or major.cid,
                "majorCard": _card_to_js(major),
                "targetId": None if target is None else target.pid,
            }
        )
        if not resp.get("ok"):
            raise RuntimeError(f"JS chaos X{getattr(major, 'major_id', '?')} failed: {resp.get('error')}")
        apply_js_state(env, resp["state"])


_BRIDGE: Optional[JsRulesBridge] = None


def get_bridge() -> JsRulesBridge:
    global _BRIDGE
    if _BRIDGE is None:
        _BRIDGE = JsRulesBridge()
        _BRIDGE.start()
    return _BRIDGE
