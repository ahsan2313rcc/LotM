"""Fogged actor obs + privileged critic obs + action feature vectors."""
from __future__ import annotations

import numpy as np
from typing import List, Dict, Any, Optional

# Compact Small: 180 dims. Medium: 650 (fuller card multi-hots).
SMALL_OBS = 180
MED_OBS = 650
SMALL_ACT = 32
MED_ACT = 48

# Action type ids
AT_PASS = 0
AT_TUCK = 1
AT_DRAFT = 2
AT_PLAY = 3
AT_ASCEND = 4
AT_TAKE_TRUMP = 5
AT_GAMBLE = 6
AT_DONE = 7


def _card_multi_hot(cards, dim=78) -> np.ndarray:
    v = np.zeros(dim, dtype=np.float32)
    for c in cards or []:
        i = c.card_id()
        if 0 <= i < dim:
            v[i] = 1.0
    return v


def encode_action(kind: int, card=None, target_rel: int = -1, extra: float = 0.0, act_dim: int = 32) -> np.ndarray:
    v = np.zeros(act_dim, dtype=np.float32)
    # type one-hot (8)
    if 0 <= kind < 8:
        v[kind] = 1.0
    # card features
    if card is not None:
        cid = card.card_id()
        v[8] = cid / 77.0
        if card.type == "major":
            v[9] = 1.0
            v[10] = (card.major_id or 0) / 21.0
        else:
            suits = ["swords", "wands", "pentacles", "cups"]
            if card.suit in suits:
                v[11 + suits.index(card.suit)] = 1.0
            v[15] = (card.rank or 0) / 14.0
            if card.rank and card.rank <= 10:
                v[16] = card.rank / 10.0
            if card.rank in (12, 13):
                v[17] = 1.0
    if target_rel >= 0:
        v[18 + min(target_rel, 2)] = 1.0
    v[21] = extra
    return v


def fogged_obs(state: Dict[str, Any], seat: int, obs_dim: int) -> np.ndarray:
    """Player observation — never sees opp private cards (unless marked known)."""
    players = state["players"]
    me = players[seat]
    opp = players[1 - seat] if len(players) == 2 else players[(seat + 1) % len(players)]
    phase = state.get("phase", "TRICK")

    if obs_dim <= SMALL_OBS:
        v = np.zeros(SMALL_OBS, dtype=np.float32)
        # hand/pouch counts + top ranks compressed
        v[0] = len(me["hand"]) / 10.0
        v[1] = len(me["pouch"]) / 5.0
        v[2] = me["seq"] / 9.0
        v[3] = 1.0 if me.get("acting_done") else 0.0
        v[4] = 1.0 if me.get("ability_used") else 0.0
        v[5] = me["pathway"] / 21.0
        v[6] = opp["seq"] / 9.0
        v[7] = len(opp["hand"]) / 10.0
        v[8] = len(opp["pouch"]) / 5.0
        v[9] = opp["pathway"] / 21.0
        v[10] = state.get("round", 1) / max(1, state.get("max_rounds", 50))
        v[11] = len(state.get("deck", [])) / 78.0
        v[12] = len(state.get("grave", [])) / 78.0
        phases = ["POUCH", "DRAFT", "TRICK", "REWARD", "ASCEND"]
        for i, p in enumerate(phases):
            if p in phase:
                v[13 + i] = 1.0
        # my hand rank histogram 1-14
        for c in me["hand"]:
            if c.type == "minor" and c.rank:
                v[18 + min(13, c.rank - 1)] += 0.15
            elif c.type == "major":
                v[32] += 0.2
        # pouch ranks
        for c in me["pouch"]:
            if c.type == "minor" and c.rank and c.rank <= 10:
                v[33 + c.rank - 1] += 0.2
        # can ascend
        from .rules import find_valid_ascension_subset
        v[44] = 1.0 if find_valid_ascension_subset(me["pouch"], me["seq"], me.get("mods") or {}) else 0.0
        v[45] = 1.0 if state.get("to_move") == seat else 0.0
        trump = state.get("trump")
        if trump:
            v[46] = trump.card_id() / 77.0
        # draft pool size
        v[47] = len(state.get("center_draft") or []) / 5.0
        # trick plays
        v[48] = len(state.get("trick_plays") or []) / 4.0
        # suit counts in hand
        suits = ["swords", "wands", "pentacles", "cups"]
        for c in me["hand"]:
            if c.type == "minor" and c.suit in suits:
                v[49 + suits.index(c.suit)] += 0.2
        # fill remaining with hashed card presence in hand+pouch (compact)
        for c in list(me["hand"]) + list(me["pouch"]):
            idx = 60 + (c.card_id() % 100)
            if idx < SMALL_OBS:
                v[idx] = 1.0
        return v

    # Medium: fuller multi-hots
    v = np.zeros(MED_OBS, dtype=np.float32)
    v[0:78] = _card_multi_hot(me["hand"])
    v[78:156] = _card_multi_hot(me["pouch"])
    v[156] = me["seq"] / 9.0
    v[157] = 1.0 if me.get("acting_done") else 0.0
    v[158] = me["pathway"] / 21.0
    v[159] = opp["seq"] / 9.0
    v[160] = len(opp["hand"]) / 10.0
    v[161] = len(opp["pouch"]) / 5.0
    v[162] = opp["pathway"] / 21.0
    v[163] = state.get("round", 1) / max(1, state.get("max_rounds", 50))
    v[164] = len(state.get("deck", [])) / 78.0
    v[165] = len(state.get("grave", [])) / 78.0
    phases = ["POUCH", "DRAFT", "TRICK", "REWARD", "ASCEND"]
    for i, p in enumerate(phases):
        if p in phase:
            v[166 + i] = 1.0
    v[171] = 1.0 if state.get("to_move") == seat else 0.0
    from .rules import find_valid_ascension_subset
    v[172] = 1.0 if find_valid_ascension_subset(me["pouch"], me["seq"], me.get("mods") or {}) else 0.0
    trump = state.get("trump")
    if trump:
        v[173 + trump.card_id()] = 1.0  # 173..250
    draft = state.get("center_draft") or []
    v[251:329] = _card_multi_hot(draft)
    grave = state.get("grave") or []
    v[329:407] = _card_multi_hot(grave[:40] if len(grave) > 40 else grave)
    # known opp cards (memory) — empty unless revealed
    known = state.get("known_opp_hand", {}).get(opp["id"], [])
    v[407:485] = _card_multi_hot(known)
    # scalars pad
    v[485] = len(me["hand"]) / 10.0
    v[486] = len(me["pouch"]) / 5.0
    v[487] = 1.0 if me.get("ability_used") else 0.0
    return v[:obs_dim]


def critic_obs(state: Dict[str, Any], seat: int, obs_dim: int) -> np.ndarray:
    """Privileged: includes opponent hand+pouch multi-hots appended into medium layout."""
    base = fogged_obs(state, seat, obs_dim)
    if obs_dim <= SMALL_OBS:
        # pack opp private into unused tail
        players = state["players"]
        opp = players[1 - seat]
        for c in opp["hand"]:
            idx = 140 + (c.card_id() % 20)
            if idx < SMALL_OBS:
                base[idx] = 1.0
        for c in opp["pouch"]:
            idx = 160 + (c.card_id() % 20)
            if idx < SMALL_OBS:
                base[idx] = 0.7
        return base
    # medium: overwrite reserved slots 500+
    v = np.zeros(MED_OBS, dtype=np.float32)
    v[: len(base)] = base
    players = state["players"]
    opp = players[1 - seat]
    v[500:578] = _card_multi_hot(opp["hand"])
    v[578:650] = _card_multi_hot(opp["pouch"])[:72]
    return v[:obs_dim]
