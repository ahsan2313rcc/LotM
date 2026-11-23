"""
2P LoTM training environment — engine-legal candidates each step.
Phases: POUCH → DRAFT → TRICK → REWARD → ASCEND (simplified chaos: major as trick card).
"""
from __future__ import annotations

import random
from typing import List, Dict, Any, Optional, Tuple
import numpy as np

from .cards import Card, build_minor_deck, build_major, shuffle, SUITS
from .rules import find_valid_ascension_subset, evaluate_trick_winner, eff_value, eff_suit
from . import obs as O


class LotmEnv:
    def __init__(self, max_rounds: int = 40, hand_cap_mode: str = "10-7", seed: Optional[int] = None,
                 obs_dim: int = O.SMALL_OBS, act_dim: int = O.SMALL_ACT):
        self.max_rounds = max_rounds
        self.hand_cap_mode = hand_cap_mode
        self.obs_dim = obs_dim
        self.act_dim = act_dim
        self.rng = random.Random(seed if seed is not None else random.randint(0, 2**31 - 1))
        self.state: Dict[str, Any] = {}
        self.done = False
        self.winner: Optional[int] = None

    def reset(self, seed: Optional[int] = None) -> Dict[str, Any]:
        if seed is not None:
            self.rng = random.Random(seed)
        paths = self.rng.sample(range(22), 2)
        deck = shuffle(build_minor_deck() + [build_major(i) for i in range(22)], self.rng)
        players = []
        for i, pid in enumerate(paths):
            hand = [deck.pop() for _ in range(7)]
            players.append({
                "id": i,
                "pathway": pid,
                "seq": 9,
                "hand": hand,
                "pouch": [],
                "acting_done": False,
                "ability_used": False,
                "skip_next": False,
                "ascended_this_round": False,
                "mods": {},
                "min_seq_lead": 0,
            })
        self.state = {
            "players": players,
            "deck": deck,
            "grave": [],
            "trump": None,
            "center_draft": [],
            "trick_plays": [],
            "phase": "POUCH",
            "round": 1,
            "max_rounds": self.max_rounds,
            "to_move": 0,
            "dealer": 0,
            "draft_order": [],
            "draft_idx": 0,
            "trick_order": [],
            "trick_idx": 0,
            "trick_winner": None,
            "known_opp_hand": {0: [], 1: []},
            "round_mods": {},
        }
        self.done = False
        self.winner = None
        self._start_round()
        return self._info(self.state["to_move"])

    def _hand_cap(self, seq: int) -> int:
        if self.hand_cap_mode == "7-5":
            return 7 if seq >= 5 else 5
        return 10 if seq >= 5 else 7

    def _draw(self, n: int) -> List[Card]:
        out = []
        for _ in range(n):
            if not self.state["deck"] and self.state["grave"]:
                self.state["deck"] = shuffle(self.state["grave"], self.rng)
                self.state["grave"] = []
            if self.state["deck"]:
                out.append(self.state["deck"].pop(0))
        return out

    def _start_round(self):
        st = self.state
        for p in st["players"]:
            p["ability_used"] = False
            p["ascended_this_round"] = False
            p["mods"] = {}
            if p["skip_next"]:
                p["skip_next"] = False
                p["hand"].extend(self._draw(2))
                p["_skipped"] = True
            else:
                p["_skipped"] = False
        best = min(x["seq"] for x in st["players"])
        for p in st["players"]:
            p["min_seq_lead"] = max(p["min_seq_lead"], p["seq"] - best)
        st["round_mods"] = {}
        st["phase"] = "POUCH"
        # first non-skipped
        for i, p in enumerate(st["players"]):
            if not p.get("_skipped"):
                st["to_move"] = i
                return
        self._begin_draft()

    def _begin_draft(self):
        st = self.state
        n = len(st["players"])
        st["center_draft"] = [st["deck"].pop(0) for _ in range(n) if st["deck"]]
        if not st["center_draft"] and st["grave"]:
            st["deck"] = shuffle(st["grave"], self.rng)
            st["grave"] = []
            st["center_draft"] = [st["deck"].pop(0) for _ in range(n) if st["deck"]]
        order = list(range(n))
        # rotate by dealer
        d = st["dealer"] % n
        st["draft_order"] = order[d:] + order[:d]
        st["draft_idx"] = 0
        st["phase"] = "DRAFT"
        while st["draft_idx"] < len(st["draft_order"]) and st["players"][st["draft_order"][st["draft_idx"]]].get("_skipped"):
            st["draft_idx"] += 1
        if st["draft_idx"] >= len(st["draft_order"]):
            self._begin_trick()
        else:
            st["to_move"] = st["draft_order"][st["draft_idx"]]

    def _begin_trick(self):
        st = self.state
        st["trump"] = st["center_draft"][0] if st["center_draft"] else None
        # leftover draft to grave
        for c in st["center_draft"][1:]:
            st["grave"].insert(0, c)
        st["center_draft"] = []
        order = list(reversed(st["draft_order"]))
        st["trick_order"] = [i for i in order if not st["players"][i].get("_skipped")]
        st["trick_idx"] = 0
        st["trick_plays"] = []
        st["phase"] = "TRICK"
        if not st["trick_order"]:
            self._begin_ascend()
        else:
            st["to_move"] = st["trick_order"][0]

    def _begin_reward(self, winner_id: int):
        st = self.state
        st["trick_winner"] = winner_id
        st["phase"] = "REWARD"
        st["to_move"] = winner_id

    def _begin_ascend(self):
        st = self.state
        st["phase"] = "ASCEND"
        st["to_move"] = 0
        # skip to first who can act
        self._advance_ascend_seat()

    def _advance_ascend_seat(self):
        st = self.state
        n = len(st["players"])
        for _ in range(n + 1):
            p = st["players"][st["to_move"]]
            if not p.get("_skipped") and not p.get("ascended_this_round"):
                return
            st["to_move"] = (st["to_move"] + 1) % n
            if st["to_move"] == 0 and all(
                pl.get("_skipped") or pl.get("ascended_this_round") or True for pl in st["players"]
            ):
                # finished pass — end round after both decided
                break
        # If everyone has decided (or skipped), end round
        if all(p.get("_skipped") or p.get("_ascend_done") for p in st["players"]):
            self._end_round()

    def legal_actions(self, seat: Optional[int] = None) -> List[Dict[str, Any]]:
        st = self.state
        seat = st["to_move"] if seat is None else seat
        p = st["players"][seat]
        acts: List[Dict[str, Any]] = []
        phase = st["phase"]

        if phase == "POUCH":
            if len(p["pouch"]) < 3:
                for c in p["hand"]:
                    if c.type == "minor" and c.rank is not None and (c.rank <= p["seq"] or c.rank in (10, 11)):
                        acts.append({"kind": O.AT_TUCK, "card": c, "vec": O.encode_action(O.AT_TUCK, c, act_dim=self.act_dim)})
            acts.append({"kind": O.AT_DONE, "vec": O.encode_action(O.AT_DONE, act_dim=self.act_dim)})
            return acts

        if phase == "DRAFT":
            for c in st["center_draft"]:
                acts.append({"kind": O.AT_DRAFT, "card": c, "vec": O.encode_action(O.AT_DRAFT, c, act_dim=self.act_dim)})
            if not acts:
                acts.append({"kind": O.AT_DONE, "vec": O.encode_action(O.AT_DONE, act_dim=self.act_dim)})
            return acts

        if phase == "TRICK":
            for c in p["hand"]:
                tgt = 0 if len(st["players"]) > 1 else -1
                acts.append({
                    "kind": O.AT_PLAY, "card": c, "target": 1 - seat,
                    "vec": O.encode_action(O.AT_PLAY, c, target_rel=0, act_dim=self.act_dim)
                })
            if not acts:
                acts.append({"kind": O.AT_PASS, "vec": O.encode_action(O.AT_PASS, act_dim=self.act_dim)})
            return acts

        if phase == "REWARD":
            acts.append({"kind": O.AT_TAKE_TRUMP, "vec": O.encode_action(O.AT_TAKE_TRUMP, act_dim=self.act_dim)})
            for i, suit in enumerate(SUITS):
                acts.append({
                    "kind": O.AT_GAMBLE, "suit": suit,
                    "vec": O.encode_action(O.AT_GAMBLE, extra=i / 3.0, act_dim=self.act_dim)
                })
            return acts

        if phase == "ASCEND":
            sub = find_valid_ascension_subset(p["pouch"], p["seq"], p.get("mods") or {})
            if sub:
                preview = 1.0 if p.get("acting_done") else 0.5
                acts.append({
                    "kind": O.AT_ASCEND, "subset": sub,
                    "vec": O.encode_action(O.AT_ASCEND, sub[0], extra=preview, act_dim=self.act_dim)
                })
            acts.append({"kind": O.AT_PASS, "vec": O.encode_action(O.AT_PASS, act_dim=self.act_dim)})
            return acts

        return [{"kind": O.AT_PASS, "vec": O.encode_action(O.AT_PASS, act_dim=self.act_dim)}]

    def _info(self, seat: int) -> Dict[str, Any]:
        acts = self.legal_actions(seat)
        return {
            "seat": seat,
            "obs": O.fogged_obs(self.state, seat, self.obs_dim),
            "critic_obs": O.critic_obs(self.state, seat, self.obs_dim),
            "actions": acts,
            "action_vecs": [a["vec"] for a in acts],
            "done": self.done,
            "winner": self.winner,
            "phase": self.state["phase"],
            "round": self.state["round"],
        }

    def step(self, action_idx: int) -> Tuple[Dict[str, Any], float, bool, Dict]:
        """Apply action for current to_move. Returns (info_for_next_or_same, reward_for_actor, done, extras)."""
        if self.done:
            return self._info(0), 0.0, True, {}

        st = self.state
        seat = st["to_move"]
        p = st["players"][seat]
        acts = self.legal_actions(seat)
        if not acts:
            return self._info(seat), 0.0, self.done, {}
        action_idx = max(0, min(action_idx, len(acts) - 1))
        a = acts[action_idx]
        reward = 0.0
        prev_seq = p["seq"]
        opp = st["players"][1 - seat]
        prev_opp = opp["seq"]

        phase = st["phase"]
        if phase == "POUCH":
            if a["kind"] == O.AT_TUCK and a.get("card"):
                c = a["card"]
                p["hand"] = [x for x in p["hand"] if x.uid != c.uid]
                p["pouch"].append(c)
                # Stay on this seat until DONE (or pouch full / no legal tucks)
                if len(p["pouch"]) >= 3 or not any(
                    x["kind"] == O.AT_TUCK for x in self.legal_actions(seat)
                ):
                    p["_pouch_done"] = True
                else:
                    return self._info(seat), reward, False, {"seqs": [pl["seq"] for pl in st["players"]], "round": st["round"]}
            else:
                # DONE or pass
                p["_pouch_done"] = True
            other = st["players"][1 - seat]
            if other.get("_skipped"):
                other["_pouch_done"] = True
            if other.get("_pouch_done") or other.get("_skipped"):
                for pl in st["players"]:
                    pl["_pouch_done"] = False
                self._begin_draft()
            else:
                st["to_move"] = 1 - seat

        elif phase == "DRAFT":
            if a["kind"] == O.AT_DRAFT and a.get("card"):
                c = a["card"]
                st["center_draft"] = [x for x in st["center_draft"] if x.uid != c.uid]
                p["hand"].append(c)
                # public memory
                st["known_opp_hand"][1 - seat]  # no-op structure
            st["draft_idx"] += 1
            while st["draft_idx"] < len(st["draft_order"]) and st["players"][st["draft_order"][st["draft_idx"]]].get("_skipped"):
                st["draft_idx"] += 1
            if st["draft_idx"] >= len(st["draft_order"]):
                self._begin_trick()
            else:
                st["to_move"] = st["draft_order"][st["draft_idx"]]

        elif phase == "TRICK":
            if a["kind"] == O.AT_PLAY and a.get("card"):
                c = a["card"]
                p["hand"] = [x for x in p["hand"] if x.uid != c.uid]
                # simplified chaos: majors go to grave after play, minor suit effects light
                st["trick_plays"].append({
                    "player_id": seat,
                    "card": c,
                    "eff_value": eff_value(c),
                    "eff_suit": eff_suit(c),
                })
                if c.type == "major":
                    st["grave"].insert(0, c)
                    st["trick_plays"][-1]["absorbed"] = True
                if c.type == "minor" and c.suit == "pentacles":
                    p["hand"].extend(self._draw(1))
                if c.type == "minor" and c.suit == "cups" and st["grave"]:
                    p["hand"].append(st["grave"].pop(0))
                if c.type == "minor" and c.suit == "swords":
                    if opp["pouch"]:
                        hit = opp["pouch"].pop(self.rng.randrange(len(opp["pouch"])))
                        st["grave"].insert(0, hit)
                if c.type == "minor" and c.suit == "wands" and opp["hand"]:
                    disc = opp["hand"].pop(self.rng.randrange(len(opp["hand"])))
                    st["grave"].insert(0, disc)
            st["trick_idx"] += 1
            if st["trick_idx"] >= len(st["trick_order"]):
                # resolve
                active_plays = [tp for tp in st["trick_plays"] if not tp.get("absorbed")]
                if not active_plays:
                    active_plays = st["trick_plays"]
                win = evaluate_trick_winner(active_plays, st["trump"], st["round_mods"])
                wid = win["player_id"] if win else st["trick_order"][0]
                for tp in st["trick_plays"]:
                    if not tp.get("absorbed"):
                        st["grave"].insert(0, tp["card"])
                self._begin_reward(wid)
            else:
                st["to_move"] = st["trick_order"][st["trick_idx"]]

        elif phase == "REWARD":
            if a["kind"] == O.AT_TAKE_TRUMP and st["trump"]:
                p["hand"].append(st["trump"])
                st["trump"] = None
            elif a["kind"] == O.AT_GAMBLE and st["deck"]:
                suit = a.get("suit")
                top = st["deck"].pop(0)
                if top.type == "minor" and top.suit == suit:
                    p["hand"].append(top)
                    if st["trump"]:
                        p["hand"].append(st["trump"])
                        st["trump"] = None
                    p["acting_done"] = True
                else:
                    st["grave"].insert(0, top)
                    if st["trump"]:
                        st["grave"].insert(0, st["trump"])
                        st["trump"] = None
            elif st["trump"]:
                st["grave"].insert(0, st["trump"])
                st["trump"] = None
            for pl in st["players"]:
                pl["_ascend_done"] = False
            self._begin_ascend()

        elif phase == "ASCEND":
            p["_ascend_done"] = True
            if a["kind"] == O.AT_ASCEND and a.get("subset"):
                sub = a["subset"]
                uids = {c.uid for c in sub}
                p["pouch"] = [c for c in p["pouch"] if c.uid not in uids]
                st["grave"] = list(sub) + st["grave"]
                digested = p["acting_done"]
                p["seq"] -= 1
                p["acting_done"] = False
                p["ascended_this_round"] = True
                if digested:
                    p["hand"].extend(self._draw(1))
                    reward += 0.05
                else:
                    # reckless: discard up to 3
                    for _ in range(min(3, len(p["hand"]))):
                        st["grave"].insert(0, p["hand"].pop(self.rng.randrange(len(p["hand"]))))
                    reward += 0.03
                if p["seq"] <= 0:
                    self.done = True
                    self.winner = seat
                    reward += 1.0
            # next seat or end round
            if not self.done:
                other = st["players"][1 - seat]
                if other.get("_ascend_done") or other.get("_skipped"):
                    self._end_round()
                else:
                    st["to_move"] = 1 - seat

        # potential shaping
        reward += 0.05 * ((prev_opp - opp["seq"]) - (prev_seq - p["seq"])) * 0  # keep 0; applied via seq change below
        reward += 0.05 * (prev_seq - p["seq"])  # my seq drop
        reward -= 0.05 * (prev_opp - opp["seq"])  # opp seq drop

        if self.done and self.winner is not None:
            if self.winner == seat:
                reward = 1.0
            else:
                reward = -1.0

        extras = {"seqs": [pl["seq"] for pl in st["players"]], "round": st["round"]}
        if self.done:
            return self._info(seat), reward, True, extras
        return self._info(st["to_move"]), reward, False, extras

    def _end_round(self):
        st = self.state
        if self.done:
            return
        for p in st["players"]:
            cap = self._hand_cap(p["seq"])
            while len(p["hand"]) > cap:
                st["grave"].insert(0, p["hand"].pop())
            if len(p["hand"]) == 0:
                p["skip_next"] = True
            p["_ascend_done"] = False
            p["_pouch_done"] = False
        st["round"] += 1
        st["dealer"] = (st["dealer"] + 1) % 2
        if st["round"] > self.max_rounds:
            self.done = True
            # Closest-to-0 wins on timeout (avoids pure draws starving PPO)
            s0 = st["players"][0]["seq"]
            s1 = st["players"][1]["seq"]
            if s0 < s1:
                self.winner = 0
            elif s1 < s0:
                self.winner = 1
            else:
                self.winner = None
            return
        self._start_round()


def heuristic_action(info: Dict[str, Any], depth: int = 3) -> int:
    """Depth-scaled heuristic — prioritizes legal ascend and pouch math."""
    acts = info["actions"]
    if not acts:
        return 0
    best_i, best_s = 0, -1e9
    phase = info.get("phase", "")
    for i, a in enumerate(acts):
        s = 0.0
        k = a["kind"]
        if k == O.AT_ASCEND:
            s = 80 + depth * 8
        elif k == O.AT_TUCK:
            c = a.get("card")
            # Prefer tucking ranks that can complete seq; 10s are wild-ish fillers
            s = 12 + (c.rank or 0) + (4 if c and c.rank == 10 else 0)
            if depth >= 3 and c and c.rank in (1, 2, 3):
                s += 6
        elif k == O.AT_DONE:
            # Finish pouch once we have cards, else leave early at low depth
            s = 2 if depth <= 2 else 0.5
        elif k == O.AT_DRAFT:
            c = a.get("card")
            s = 5 + (0 if not c else (12 if c.type == "major" else (c.rank or 0)))
            if c and c.type == "minor" and c.rank in (1, 2, 10):
                s += 4 + depth
        elif k == O.AT_PLAY:
            c = a.get("card")
            s = (c.rank or 0) if c and c.type == "minor" else 5
            if depth >= 4 and c and c.type == "minor" and c.rank == 10:
                s -= 10  # save 10s for pouch
            if depth >= 5 and c and c.type == "minor" and c.rank in (1, 2):
                s -= 4
        elif k == O.AT_TAKE_TRUMP:
            s = 10 + depth
        elif k == O.AT_GAMBLE:
            s = 2 if depth >= 4 else -1
        elif k == O.AT_PASS:
            s = -5 if phase == "ASCEND" else 1
        if s > best_s:
            best_s, best_i = s, i
    return best_i
