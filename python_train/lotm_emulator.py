"""
lotm_emulator.py — Deterministic Step-by-Step Python Emulator for Lord of the Mysteries Tarot.

Designed for Self-Play RL (Masked PPO + Centralized Critic / CTDE):
  - Full 78-card deck (56 Minor Arcana + 22 Major Arcana, all kept in play).
  - Exact 3-phase round loop: POUCH_ADD -> DRAFT -> TRICK -> TRICK_REWARD -> ASCEND,
    plus reactive INTERRUPT (Knight/Queen) and CHOOSE_DISCARD decision states.
  - All 22 Pathways (198 Sequence ability tags) and all 22 Major Arcana Chaos Events + Grave Recycle X.
  - Full 78-card multi-hot Actor observation (strictly legal info + player memory)
    and Ground-Truth Centralized Critic observation (for training only).
  - Candidate Action Enumerator returning (legal_actions, action_feature_matrix) at every step.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple, Any
import random
import numpy as np

SUITS = ("swords", "wands", "pentacles", "cups")
SUIT_TO_IDX = {s: i for i, s in enumerate(SUITS)}
NUM_CARDS = 78  # 0..55 Minor (4 suits x 14 ranks), 56..77 Major (X0..X21)

# Action type indices (12-dim one-hot in action candidate vector)
ACT_TYPES = (
    "TUCK_POUCH",
    "DISCARD_POUCH",
    "DONE_POUCH",
    "DRAFT_CARD",
    "PLAY_TRICK_MINOR",
    "PLAY_TRICK_MAJOR",
    "PLAY_INSTANT_CHAOS",
    "USE_SEQ_ABILITY",
    "INTERRUPT_BLOCK",
    "INTERRUPT_PASS",
    "REWARD_CHOICE",
    "ASCEND_OR_PASS",
)
ACT_TYPE_IDX = {k: i for i, k in enumerate(ACT_TYPES)}

PHASES = (
    "POUCH_ADD",
    "DRAFT",
    "TRICK",
    "INTERRUPT",
    "TRICK_REWARD",
    "ASCEND",
    "CHOOSE_DISCARD",
    "GAMEOVER",
)
PHASE_IDX = {p: i for i, p in enumerate(PHASES)}

TARGETED_ABILITY_TAGS = {
    "bard_inspire", "blatherer_2", "bribe_opp", "calamity_jinx", "clairvoyant",
    "conqueror_lock", "copy_ability", "criminal_discard", "crimson_moon", "deduce_reveal",
    "demon_hunter_strike", "devil_desire", "ferryman_swap", "filthy_monarch", "frenzy_discard",
    "hand_of_god", "hand_swap_opp", "hunter_track", "hypnotist_steal", "interrogator",
    "jinx_cycle", "marionette", "notary_pact", "pouch_swap_opp", "puppet_curse",
    "reaper_strike", "scribe_grave", "serial_killer", "silence_opp", "steal_pouch_safe",
    "steal_time", "steal_trump_hand", "swap_best_hand", "taunt_discard", "warlock_cast",
    "weaken_opp", "witch_burn", "wraith_possess",
}

TARGETED_CHAOS_IDS = {1, 3, 6, 17}

# 22 Pathways x 9 Sequences (Seq 9 down to Seq 1) ability tags
PATHWAY_SEQ_TAGS: Dict[int, Dict[int, str]] = {
    0:  {9: "peek_deck_2", 8: "clown_shield", 7: "illusion_boost", 6: "copy_ability", 5: "marionette", 4: "grave_to_pouch_trap", 3: "scholar_proj", 2: "swap_trump_deck", 1: "grafting"},
    1:  {9: "swap_hand_trump", 8: "cycle_2_1", 7: "astrologer", 6: "scribe_grave", 5: "blink_immune", 4: "pouch_immune_draw", 3: "swap_trump_grave", 2: "grave_best_to_hand", 1: "spatial_lock"},
    2:  {9: "mystery_pryer_swap", 8: "wand_cup_boost", 7: "warlock_cast", 6: "scroll_charge", 5: "find_major", 4: "mystic_fairytale", 3: "clairvoyant", 2: "hand_swap_opp", 1: "grave_major_to_hand"},
    3:  {9: "assassin_ambush", 8: "instigator_redirect", 7: "witch_burn", 6: "pleasure_gift", 5: "plague_aoe", 4: "despair_traps", 3: "pouch_swap_grave", 2: "catastrophe_aoe", 1: "apocalypse_mode"},
    4:  {9: "math_plus_minus_1", 8: "unblockable_next", 7: "bribe_opp", 6: "invert_trick", 5: "disorder_pass", 4: "double_suit", 3: "weaken_opp", 2: "draw_2", 1: "abolish_trump"},
    5:  {9: "trick_plus_1", 8: "fury_boost", 7: "cycle_2_1", 6: "trick_plus_2", 5: "siren_song", 4: "tsunami_aoe", 3: "replace_trump_draw", 2: "thunderclap", 1: "wrath_sea"},
    6:  {9: "hand_swap_opp", 8: "pouch_swap_deck", 7: "steal_pouch_safe", 6: "scribe_grave", 5: "copy_ability", 4: "draw_2", 3: "swap_best_hand", 2: "hijack_trump", 1: "steal_time"},
    7:  {9: "hunter_track", 8: "taunt_discard", 7: "pyro_aoe", 6: "conspirator_dual", 5: "reaper_strike", 4: "face_can_win", 3: "declare_war", 2: "weather_swords", 1: "conqueror_lock"},
    8:  {9: "warrior_mastery", 8: "counter_shield", 7: "pouch_immune_draw", 6: "dawn_paladin", 5: "blink_immune", 4: "demon_hunter_strike", 3: "grave_defense_pull", 2: "glory_aura", 1: "hand_of_god"},
    9:  {9: "reader_scry", 8: "student_deduce", 7: "grave_peek_take", 6: "copy_ability", 5: "mysticism_cycle", 4: "prophet_foresight", 3: "deduce_reveal", 2: "steal_trump_hand", 1: "omniscient_eye"},
    10: {9: "swap_trump_deck", 8: "robot_pair", 7: "lucky_two_suits", 6: "calamity_jinx", 5: "jackpot_boost", 4: "jinx_cycle", 3: "replace_trump_draw", 2: "soothsayer_flip", 1: "reboot_trick"},
    11: {9: "spectator_draw", 8: "telepathist_reveal", 7: "frenzy_discard", 6: "hypnotist_steal", 5: "pouch_swap_opp", 4: "manipulator_aoe", 3: "weaken_opp", 2: "steal_trump_hand", 1: "author_coincidence"},
    12: {9: "cycle_2_1", 8: "listener_grave", 7: "shadow_sacrifice", 6: "grave_to_pouch_sac", 5: "math_plus_minus_2", 4: "dark_sub_4", 3: "blood_ritual", 2: "degenerate_10", 1: "grave_major_to_hand"},
    13: {9: "grave_peek_take", 8: "exhume_swap", 7: "grave_face_pull", 6: "soul_harvest", 5: "grave_trump_pull", 4: "undying_revive", 3: "ferryman_swap", 2: "pale_decree", 1: "pale_emperor"},
    14: {9: "prisoner_restraint", 8: "double_suit", 7: "werewolf_blood", 6: "pouch_immune_draw", 5: "wraith_possess", 4: "puppet_curse", 3: "silence_opp", 2: "ancient_bane", 1: "abomination_unchain"},
    15: {9: "criminal_discard", 8: "counter_shield", 7: "serial_killer", 6: "devil_desire", 5: "siren_song", 4: "abyssal_filth", 3: "blatherer_2", 2: "massacre_aoe", 1: "filthy_monarch"},
    16: {9: "savant_subtract", 8: "draw_1_peek", 7: "appraiser_draw", 6: "artisan_artifact", 5: "astronomer_wild", 4: "transmute_trump", 3: "grave_face_pull", 2: "face_can_win", 1: "hand_ascend"},
    17: {9: "night_owl", 8: "jinx_cycle", 7: "frenzy_discard", 6: "blink_immune", 5: "pouch_immune_draw", 4: "trick_plus_2", 3: "wraith_possess", 2: "transmute_trump", 1: "eternal_night"},
    18: {9: "swap_own_pouch", 8: "grave_peek_take", 7: "steal_pouch_safe", 6: "extra_pouch_add", 5: "cups_are_trump", 4: "pouch_swap_grave", 3: "grave_defense_pull", 2: "life_giver", 1: "crimson_moon"},
    19: {9: "bard_inspire", 8: "flash_light", 7: "pouch_immune_draw", 6: "notary_pact", 5: "sun_protect", 4: "demon_hunter_strike", 3: "radiant_law", 2: "sun_boost", 1: "white_angel"},
    20: {9: "arbiter_auth", 8: "deduce_reveal", 7: "interrogator", 6: "forbid_swords", 5: "spatial_lock", 4: "silence_opp", 3: "abolish_trump", 2: "balancer_equalize", 1: "supreme_verdict"},
    21: {9: "math_plus_minus_1", 8: "doctor_heal", 7: "harvest_draw", 6: "fury_boost", 5: "blink_immune", 4: "math_plus_minus_2", 3: "grave_to_pouch_free", 2: "extra_pouch_add", 1: "world_tree"},
}


@dataclass(frozen=True)
class Card:
    cid: int          # 0..77 unique canonical card ID
    is_major: bool
    suit: Optional[str] = None
    rank: int = 0     # 1..14 for minor
    major_id: int = -1  # 0..21 for major

    @property
    def uid(self) -> int:
        return self.cid

    @property
    def card_suit(self) -> str:
        return "major" if self.is_major else (self.suit or "swords")


def build_full_deck() -> List[Card]:
    cards: List[Card] = []
    cid = 0
    for s in SUITS:
        for r in range(1, 15):
            cards.append(Card(cid=cid, is_major=False, suit=s, rank=r))
            cid += 1
    for m in range(22):
        cards.append(Card(cid=cid, is_major=True, major_id=m))
        cid += 1
    return cards


def get_hand_limit(seq: int, mode: str = "10-7") -> int:
    if mode == "7-5":
        return 7 if seq >= 7 else (6 if seq >= 4 else 5)
    if seq >= 8:
        return 10
    if seq >= 6:
        return 9
    if seq >= 4:
        return 8
    return 7


def check_ascension_math(cards: List[Card], target_seq: int, mods: Dict[str, Any]) -> bool:
    if not cards:
        return False
    nums: List[int] = []
    wilds = 0
    for c in cards:
        if c.is_major:
            return False
        if c.rank == 10 or (c.rank == 1 and mods.get("astronomerWild")):
            wilds += 1
        elif 1 <= c.rank <= 9:
            nums.append(c.rank)
        else:
            return False

    if mods.get("darkSubBonus") and len(cards) >= 1:
        return True
    leeway = int(mods.get("mathLeeway", 0))
    base = sum(nums)
    if base + wilds - leeway <= target_seq <= base + wilds * 9 + leeway:
        return True
    if mods.get("savantSubtract") and len(nums) >= 2:
        srt = sorted(nums, reverse=True)
        diff = srt[0] - sum(srt[1:])
        if abs(diff - target_seq) <= leeway:
            return True
    return False


def find_valid_ascension_subsets(cards: List[Card], target_seq: int, mods: Dict[str, Any], limit: int = 4) -> List[List[Card]]:
    n = min(len(cards), 10)
    found: List[List[Card]] = []
    for mask in range(1, 1 << n):
        sub = [cards[i] for i in range(n) if (mask & (1 << i))]
        if check_ascension_math(sub, target_seq, mods):
            found.append(sub)
            if len(found) >= limit:
                break
    return found


def evaluate_trick_winner(plays: List[Dict[str, Any]], trump_card: Optional[Card], round_mods: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not plays:
        return None
    lead_suit = plays[0]["eff_suit"]
    trump_suit = trump_card.card_suit if trump_card else None

    if not round_mods.get("abolishTrump") and not round_mods.get("noTrumpChariot") and not round_mods.get("spatialLock"):
        for p in plays:
            if (not p["card"].is_major and p["card"].rank == 10) or p.get("is_ten_override"):
                trump_suit = p["eff_suit"]
    if round_mods.get("weatherSwords"):
        trump_suit = "swords"
    if round_mods.get("abolishTrump") or round_mods.get("noTrumpChariot"):
        trump_suit = None

    def score_play(p: Dict[str, Any]) -> Tuple[int, float, int]:
        c: Card = p["card"]
        is_trump = bool(trump_suit and (p["eff_suit"] == trump_suit or p.get("counts_as_trump")))
        is_lead = p["eff_suit"] == lead_suit
        tier = 2 if is_trump else (1 if is_lead else 0)
        if not c.is_major and 11 <= c.rank <= 14 and not p.get("face_can_win"):
            val = c.rank / 100.0
        else:
            val = float(p["eff_value"])
        if not c.is_major and c.rank == 1:
            if any(((not o["card"].is_major and o["card"].rank == 10) or o.get("is_ten_override")) and o["eff_suit"] == p["eff_suit"] for o in plays):
                val = 12.0
        if round_mods.get("invertTrick") and tier > 0:
            if c.is_major:
                val = 21.0 - val
            elif 1 <= c.rank <= 9:
                val = 11.0 - val
        return (tier, val, 1 if p.get("wins_ties") else 0)

    best = plays[0]
    best_sc = score_play(best)
    for cur in plays[1:]:
        sc = score_play(cur)
        if sc > best_sc:
            best = cur
            best_sc = sc
    return best


@dataclass
class PlayerState:
    pid: int
    pathway_id: int
    seq: int = 9
    acting_done: bool = False
    safe_rounds: int = 0
    ability_used: bool = False
    ability_casts: int = 0
    skip_next_turn: bool = False
    skipped_this_round: bool = False
    pouch_lost_round: bool = False
    targeted_round: bool = False
    lost_card_round: bool = False
    hand: List[Card] = field(default_factory=list)
    pouch: List[Card] = field(default_factory=list)
    mods: Dict[str, Any] = field(default_factory=dict)
    face_counts: Dict[str, int] = field(default_factory=lambda: {"K": 0, "Q": 0, "N": 0, "P": 0})


@dataclass
class LegalAction:
    atype: str
    card: Optional[Card] = None
    target_id: Optional[int] = None
    extra: Any = None  # e.g., suit for gamble, subset of cards for ascend


# Exact Observation & Action Feature Dimensions
ACTOR_OBS_DIM = 9 * NUM_CARDS + 64 + 16 + 48 + 24   # 854
CRITIC_OBS_DIM = ACTOR_OBS_DIM + 3 * NUM_CARDS + 3 * NUM_CARDS + 24  # 1346
ACTION_FEAT_DIM = 48


class LotmTarotEnv:
    """Turn-by-turn Gym-like environment with strict legal-action masking and full 78-card view."""

    def __init__(self, player_count: int = 2, hand_limit_mode: str = "10-7", max_rounds: int = 60, seed: Optional[int] = None):
        self.player_count = player_count
        self.hand_limit_mode = hand_limit_mode
        self.max_rounds = max_rounds
        self.rng = random.Random(seed)
        self.reset(seed=seed)

    def reset(self, seed: Optional[int] = None, fixed_pathways: Optional[List[int]] = None) -> int:
        if seed is not None:
            self.rng = random.Random(seed)
        all_cards = build_full_deck()
        self.rng.shuffle(all_cards)
        self.deck: List[Card] = all_cards
        self.grave: List[Card] = []
        self.recycled_cids: set = set()
        self.known_opp_hands: Dict[int, set] = {i: set() for i in range(self.player_count)}
        self.known_opp_pouches: Dict[int, set] = {i: set() for i in range(self.player_count)}

        pids = list(fixed_pathways) if fixed_pathways else self.rng.sample(range(22), self.player_count)
        self.players: List[PlayerState] = [
            PlayerState(pid=i, pathway_id=pids[i], hand=self._draw(7))
            for i in range(self.player_count)
        ]
        self.round = 1
        self.dealer_idx = 0
        self.phase = "POUCH_ADD"
        self.round_mods: Dict[str, Any] = {}
        self.center_draft: List[Card] = []
        self.trump_card: Optional[Card] = None
        self.draft_order: List[int] = []
        self.draft_idx = 0
        self.trick_order: List[int] = []
        self.trick_idx = 0
        self.trick_plays: List[Dict[str, Any]] = []
        self.trick_winner_id: Optional[int] = None
        self.pouch_order: List[int] = []
        self.pouch_idx = 0
        self.ascend_order: List[int] = []
        self.ascend_idx = 0
        self.pending_interrupt: Optional[Dict[str, Any]] = None
        self.pending_discard: Optional[Dict[str, Any]] = None
        self.winner_id: Optional[int] = None
        self.done = False
        self.netlist_lines: List[str] = []
        if self.round == 1:
            self._log_netlist("G=" + ",".join(f"#{i + 1}z{pl.pathway_id}" for i, pl in enumerate(self.players)))
        self._start_round()
        return self.current_player_id()

    def _draw(self, n: int) -> List[Card]:
        out: List[Card] = []
        for _ in range(n):
            if not self.deck and self.grave:
                self.deck = list(self.grave)
                self.rng.shuffle(self.deck)
                self.grave.clear()
                self.recycled_cids.clear()
            if self.deck:
                c = self.deck.pop(0)
                self.recycled_cids.discard(c.cid)
                out.append(c)
        return out

    def _active_opps(self, pid: int) -> List[PlayerState]:
        return [p for p in self.players if p.pid != pid and not p.skipped_this_round]

    def current_player_id(self) -> int:
        if self.done:
            return 0
        if self.pending_discard is not None:
            return self.pending_discard["pid"]
        if self.pending_interrupt is not None:
            return self.pending_interrupt["defender_id"]
        if self.phase == "POUCH_ADD":
            return self.pouch_order[self.pouch_idx]
        if self.phase == "DRAFT":
            return self.draft_order[self.draft_idx]
        if self.phase == "TRICK":
            return self.trick_order[self.trick_idx]
        if self.phase == "TRICK_REWARD":
            return self.trick_winner_id or 0
        if self.phase == "ASCEND":
            return self.ascend_order[self.ascend_idx]
        return 0

    def _resolve_timeout_winner(self) -> None:
        """Closest-to-0 wins on round cap (true ties stay draws)."""
        self.done = True
        self.phase = "GAMEOVER"
        best_seq = min(p.seq for p in self.players)
        tied = [p.pid for p in self.players if p.seq == best_seq]
        self.winner_id = tied[0] if len(tied) == 1 else None

    def _start_round(self) -> None:
        if self.round > self.max_rounds:
            self._resolve_timeout_winner()
            return
        self.round_mods = {}
        self.trick_plays = []
        self.trick_winner_id = None
        self.center_draft = []
        self.trump_card = None

        active: List[int] = []
        for p in self.players:
            p.ability_used = False
            p.pouch_lost_round = False
            p.targeted_round = False
            p.lost_card_round = False
            p.mods = {}
            if p.skip_next_turn:
                p.skipped_this_round = True
                p.skip_next_turn = False
                p.hand.extend(self._draw(2))
            else:
                p.skipped_this_round = False
                active.append(p.pid)

        if not active:
            # Everyone skipped — advance round without stacking recursion forever
            self.round += 1
            self.dealer_idx = (self.dealer_idx + 1) % self.player_count
            if self.round > self.max_rounds:
                self._resolve_timeout_winner()
                return
            self._start_round()
            return

        self.pouch_order = active
        self.pouch_idx = 0
        self.phase = "POUCH_ADD"

    def _start_draft(self) -> None:
        active = [p for p in self.players if not p.skipped_this_round]
        self.center_draft = self._draw(len(active) + 1)
        active.sort(key=lambda p: (-p.seq, (p.pid - self.dealer_idx) % self.player_count))
        self.draft_order = [p.pid for p in active]
        self.draft_idx = 0
        self.phase = "DRAFT"

    def _start_trick(self) -> None:
        self.trump_card = self.center_draft.pop(0) if self.center_draft else None
        self.center_draft.clear()
        self.trick_order = list(reversed(self.draft_order))
        self.trick_idx = 0
        self.trick_plays = []
        self.phase = "TRICK"

    def _start_ascend(self) -> None:
        self.ascend_order = [p.pid for p in self.players if not p.skipped_this_round]
        self.ascend_idx = 0
        self.phase = "ASCEND"
        if not self.ascend_order:
            self._end_round()

    def _end_round(self) -> None:
        for p in self.players:
            cap = get_hand_limit(p.seq, self.hand_limit_mode)
            while len(p.hand) > cap:
                # Trim lowest-utility card if over cap
                c = p.hand.pop()
                self.grave.insert(0, c)
                self.known_opp_hands[p.pid].discard(c.cid)
            if not p.skipped_this_round and len(p.hand) == 0:
                p.skip_next_turn = True
            p.skipped_this_round = False

        self.round += 1
        self.dealer_idx = (self.dealer_idx + 1) % self.player_count
        self._start_round()

    # ------------------------------------------------------------------
    # LEGAL ACTION ENUMERATION & ACTION FEATURE ENCODING
    # ------------------------------------------------------------------
    def get_legal_actions(self, pid: Optional[int] = None) -> List[LegalAction]:
        if self.done:
            return []
        pid = self.current_player_id() if pid is None else pid
        p = self.players[pid]
        opps = self._active_opps(pid)
        actions: List[LegalAction] = []

        if self.pending_discard is not None:
            for c in p.hand:
                actions.append(LegalAction("DISCARD_POUCH", card=c, extra="hand_discard"))
            return actions or [LegalAction("DONE_POUCH")]

        if self.pending_interrupt is not None:
            pi = self.pending_interrupt
            actions.append(LegalAction("INTERRUPT_PASS"))
            block_rank = 12 if pi["attack_type"] == "sword" else 13
            for c in p.hand:
                if not c.is_major and c.rank == block_rank:
                    if c.suit in ("swords", "wands") and opps:
                        for o in opps:
                            actions.append(LegalAction("INTERRUPT_BLOCK", card=c, target_id=o.pid))
                    else:
                        actions.append(LegalAction("INTERRUPT_BLOCK", card=c, target_id=pi["attacker_id"]))
            return actions

        if self.phase == "POUCH_ADD":
            max_p = int(p.mods.get("maxPouch", 3))
            if len(p.pouch) < max_p and len(p.hand) > 1:
                for c in p.hand:
                    if not c.is_major:
                        actions.append(LegalAction("TUCK_POUCH", card=c))
            for c in p.pouch:
                actions.append(LegalAction("DISCARD_POUCH", card=c))
            actions.append(LegalAction("DONE_POUCH"))
            return actions

        if self.phase == "DRAFT":
            for c in self.center_draft:
                actions.append(LegalAction("DRAFT_CARD", card=c))
            return actions

        if self.phase == "TRICK":
            # 1. Sequence Ability (if unused & can afford Sanity Toll when digested)
            if not p.ability_used and p.seq > 0:
                recast_cost = 1 if p.acting_done else 0
                if len(p.hand) >= (2 if recast_cost else 1):
                    tag = PATHWAY_SEQ_TAGS[p.pathway_id][p.seq]
                    if tag in TARGETED_ABILITY_TAGS and opps:
                        for o in opps:
                            actions.append(LegalAction("USE_SEQ_ABILITY", target_id=o.pid, extra=tag))
                    else:
                        actions.append(LegalAction("USE_SEQ_ABILITY", extra=tag))

            # 2. Instant Major Arcana Chaos (requires >=2 cards so player still has a trick card)
            if len(p.hand) >= 2:
                for c in p.hand:
                    if c.is_major:
                        if c.major_id in TARGETED_CHAOS_IDS and opps:
                            for o in opps:
                                actions.append(LegalAction("PLAY_INSTANT_CHAOS", card=c, target_id=o.pid))
                        else:
                            actions.append(LegalAction("PLAY_INSTANT_CHAOS", card=c))

            # 3. Play Minor or Major Arcana directly into the Trick
            for c in p.hand:
                if c.is_major:
                    if c.major_id in TARGETED_CHAOS_IDS and opps:
                        for o in opps:
                            actions.append(LegalAction("PLAY_TRICK_MAJOR", card=c, target_id=o.pid))
                    else:
                        actions.append(LegalAction("PLAY_TRICK_MAJOR", card=c))
                else:
                    if (c.suit in ("swords", "wands") or c.rank == 14) and opps:
                        for o in opps:
                            actions.append(LegalAction("PLAY_TRICK_MINOR", card=c, target_id=o.pid))
                    else:
                        actions.append(LegalAction("PLAY_TRICK_MINOR", card=c))

            if not actions:
                actions.append(LegalAction("DONE_POUCH"))
            return actions

        if self.phase == "TRICK_REWARD":
            actions.append(LegalAction("REWARD_CHOICE", extra=("take_trump", ())))
            if self.deck:
                for s in SUITS:
                    actions.append(LegalAction("REWARD_CHOICE", extra=("gamble", (s,))))
            return actions

        if self.phase == "ASCEND":
            if not p.mods.get("ascendLocked") and p.seq > 0:
                pool = (p.pouch + p.hand) if p.mods.get("handAscend") else p.pouch
                for sub in find_valid_ascension_subsets(pool, p.seq, p.mods, limit=4):
                    actions.append(LegalAction("ASCEND_OR_PASS", extra=sub))
            actions.append(LegalAction("ASCEND_OR_PASS", extra=None))
            return actions

        return []

    def encode_action_features(self, pid: int, actions: List[LegalAction]) -> np.ndarray:
        mat = np.zeros((len(actions), ACTION_FEAT_DIM), dtype=np.float32)
        p = self.players[pid]
        trump_suit = self.trump_card.card_suit if self.trump_card else None
        lead_suit = self.trick_plays[0]["eff_suit"] if self.trick_plays else None

        for i, a in enumerate(actions):
            # [0..11] Action type one-hot
            mat[i, ACT_TYPE_IDX[a.atype]] = 1.0

            # [12..27] Card features (16)
            if a.card is not None:
                c = a.card
                mat[i, 12] = 1.0
                mat[i, 13] = 1.0 if c.is_major else 0.0
                if not c.is_major and c.suit in SUIT_TO_IDX:
                    mat[i, 14 + SUIT_TO_IDX[c.suit]] = 1.0
                mat[i, 18] = c.rank / 14.0
                mat[i, 19] = max(0, c.major_id) / 21.0
                mat[i, 20] = 1.0 if (not c.is_major and c.rank == 1) else 0.0
                mat[i, 21] = 1.0 if (not c.is_major and c.rank == 10) else 0.0
                mat[i, 22] = 1.0 if (not c.is_major and c.rank == 11) else 0.0
                mat[i, 23] = 1.0 if (not c.is_major and c.rank == 12) else 0.0
                mat[i, 24] = 1.0 if (not c.is_major and c.rank == 13) else 0.0
                mat[i, 25] = 1.0 if (not c.is_major and c.rank == 14) else 0.0
                mat[i, 26] = 1.0 if (trump_suit and c.card_suit == trump_suit) else 0.0
                mat[i, 27] = 1.0 if (lead_suit and c.card_suit == lead_suit) else 0.0

            # [28..35] Target opponent features (8)
            if a.target_id is not None:
                o = self.players[a.target_id]
                rel = (o.pid - pid) % self.player_count
                mat[i, 28] = 1.0
                mat[i, 29] = rel / 3.0
                mat[i, 30] = o.seq / 9.0
                mat[i, 31] = min(1.0, len(o.hand) / 10.0)
                mat[i, 32] = min(1.0, len(o.pouch) / 5.0)
                mat[i, 33] = 1.0 if o.acting_done else 0.0
                mat[i, 34] = 1.0 if o.mods.get("pouchImmune") else 0.0
                mat[i, 35] = 1.0 if o.mods.get("handImmune") else 0.0

            # [36..47] Immediate rules-derived outcome preview (12)
            if a.atype in ("PLAY_TRICK_MINOR", "PLAY_TRICK_MAJOR") and a.card is not None:
                c = a.card
                eff_v = c.major_id if c.is_major else (c.rank if c.rank <= 10 else (11 if p.mods.get("faceCanWin") else 0))
                if not c.is_major and c.rank <= 9:
                    eff_v = min(9, eff_v + int(p.mods.get("trickBonus", 0)))
                sim_play = {
                    "player_id": pid, "card": c, "eff_value": eff_v,
                    "eff_suit": c.card_suit, "is_ten_override": (not c.is_major and c.rank == 10),
                    "counts_as_trump": bool(p.mods.get("countsAsTrump")) or (c.is_major and trump_suit == "major"),
                    "face_can_win": bool(p.mods.get("faceCanWin")), "wins_ties": False,
                }
                w = evaluate_trick_winner(self.trick_plays + [sim_play], self.trump_card, self.round_mods)
                mat[i, 36] = 1.0 if (w and w["player_id"] == pid) else 0.0
            if a.card is not None and not a.card.is_major:
                c = a.card
                if (c.rank <= p.seq or c.rank == 10) and find_valid_ascension_subsets(p.pouch + [c], p.seq, p.mods, 1):
                    mat[i, 37] = 1.0
                mat[i, 38] = 1.0 if (c.rank == p.seq or c.rank == 10) else 0.0
                mat[i, 39] = 1.0 if any((not pc.is_major and pc.rank + c.rank == p.seq) for pc in p.pouch) else 0.0
                if a.target_id is not None and c.suit == "wands" and len(self.players[a.target_id].hand) <= 1:
                    mat[i, 40] = 1.0
                mat[i, 45] = 1.0 if c.suit in ("pentacles", "cups") else 0.0
                mat[i, 46] = 1.0 if c.suit in ("swords", "wands") else 0.0
            if a.atype == "ASCEND_OR_PASS" and a.extra is not None:
                mat[i, 41] = 1.0 if p.acting_done else 0.0
                mat[i, 42] = 0.0 if p.acting_done else 1.0
                mat[i, 47] = len(a.extra) / 3.0
            if a.atype == "USE_SEQ_ABILITY":
                mat[i, 43] = 1.0 if p.acting_done else 0.0
            if a.card is not None and a.card.is_major:
                mat[i, 44] = a.card.major_id / 21.0
            if a.atype == "REWARD_CHOICE" and a.extra and a.extra[0] == "gamble":
                mat[i, 47] = 1.0

        return mat

    # ------------------------------------------------------------------
    # FULL 78-CARD OBSERVATION BUILDERS (ACTOR & CENTRALIZED CRITIC)
    # ------------------------------------------------------------------
    def _encode_card_slot(self, c: Optional[Card]) -> List[float]:
        if c is None:
            return [0.0] * 8
        return [
            1.0,
            1.0 if c.is_major else 0.0,
            1.0 if c.suit == "swords" else 0.0,
            1.0 if c.suit == "wands" else 0.0,
            1.0 if c.suit == "pentacles" else 0.0,
            1.0 if c.suit == "cups" else 0.0,
            (c.major_id if c.is_major else c.rank) / 21.0,
            1.0 if (not c.is_major and c.rank >= 11) else 0.0,
        ]

    def get_actor_obs(self, pid: int) -> np.ndarray:
        vec = np.zeros(ACTOR_OBS_DIM, dtype=np.float32)
        p = self.players[pid]
        off = 0

        # 9 x 78-card binary masks (Full 78-Card View of legal zones + player memory)
        for c in p.hand:
            vec[off + c.cid] = 1.0
        off += NUM_CARDS
        for c in p.pouch:
            vec[off + c.cid] = 1.0
        off += NUM_CARDS
        if self.trump_card is not None:
            vec[off + self.trump_card.cid] = 1.0
        off += NUM_CARDS
        for c in self.center_draft:
            vec[off + c.cid] = 1.0
        off += NUM_CARDS
        for tp in self.trick_plays:
            vec[off + tp["card"].cid] = 1.0
        off += NUM_CARDS
        for c in self.grave:
            vec[off + c.cid] = 1.0
        off += NUM_CARDS
        for o in self.players:
            if o.pid != pid:
                for cid in self.known_opp_hands[o.pid]:
                    vec[off + cid] = 1.0
        off += NUM_CARDS
        for o in self.players:
            if o.pid != pid:
                for cid in self.known_opp_pouches[o.pid]:
                    vec[off + cid] = 1.0
        off += NUM_CARDS
        for cid in self.recycled_cids:
            vec[off + cid] = 1.0
        off += NUM_CARDS

        # 64 global + self scalars
        vec[off + p.pathway_id] = 1.0
        off += 22
        can_asc = 1.0 if find_valid_ascension_subsets(p.pouch, p.seq, p.mods, 1) else 0.0
        scalars = [
            p.seq / 9.0,
            1.0 if p.acting_done else 0.0,
            1.0 if p.ability_used else 0.0,
            min(1.0, p.ability_casts / 3.0),
            1.0 if p.skip_next_turn else 0.0,
            min(1.0, len(p.hand) / 10.0),
            min(1.0, len(p.pouch) / 5.0),
            get_hand_limit(p.seq, self.hand_limit_mode) / 10.0,
            can_asc,
            min(1.0, self.round / float(self.max_rounds)),
            len(self.deck) / 78.0,
            len(self.grave) / 78.0,
            self.player_count / 4.0,
            (self.trick_idx / max(1, len(self.trick_order))) if self.trick_order else 0.0,
            1.0 if self.pending_interrupt is not None else 0.0,
        ]
        vec[off:off + 15] = scalars
        off += 15
        cur_phase = "CHOOSE_DISCARD" if self.pending_discard else ("INTERRUPT" if self.pending_interrupt else self.phase)
        vec[off + PHASE_IDX.get(cur_phase, 0)] = 1.0
        off += 8

        suit5 = {"swords": 0, "wands": 1, "pentacles": 2, "cups": 3, "major": 4}
        if self.trick_plays:
            vec[off + suit5.get(self.trick_plays[0]["eff_suit"], 0)] = 1.0
        off += 5
        if self.trump_card:
            vec[off + suit5.get(self.trump_card.card_suit, 0)] = 1.0
        off += 5

        rm_keys = ("invertTrick", "abolishTrump", "noTrumpChariot", "weatherSwords", "globalImmunity", "cancelSuitActions", "spatialLock", "apocalypse", "warDeclared")
        for k, rk in enumerate(rm_keys):
            vec[off + k] = 1.0 if self.round_mods.get(rk) else 0.0
        off += 9

        # 16 self active mods
        vec[off:off + 16] = [
            min(1.0, p.mods.get("trickBonus", 0) / 5.0),
            min(1.0, p.mods.get("trickPenalty", 0) / 5.0),
            min(1.0, p.mods.get("nonTrumpPenalty", 0) / 5.0),
            1.0 if p.mods.get("countsAsTrump") else 0.0,
            1.0 if p.mods.get("cupsAreTrump") else 0.0,
            1.0 if p.mods.get("faceCanWin") else 0.0,
            1.0 if p.mods.get("degenerateTen") else 0.0,
            1.0 if p.mods.get("doubleSuit") else 0.0,
            1.0 if p.mods.get("unblockable") else 0.0,
            1.0 if p.mods.get("handImmune") else 0.0,
            1.0 if p.mods.get("pouchImmune") else 0.0,
            1.0 if p.mods.get("dawnPaladin") else 0.0,
            1.0 if p.mods.get("despairTraps") else 0.0,
            1.0 if p.mods.get("ascendLocked") else 0.0,
            min(1.0, p.mods.get("mathLeeway", 0) / 2.0),
            1.0 if p.mods.get("savantSubtract") else 0.0,
        ]
        off += 16

        # 3 x 16 = 48 opponents public info
        opps = [self.players[(pid + k) % self.player_count] for k in range(1, self.player_count)]
        played_ids = {tp["player_id"] for tp in self.trick_plays}
        for k in range(3):
            if k < len(opps):
                o = opps[k]
                vec[off:off + 16] = [
                    1.0,
                    o.pathway_id / 21.0,
                    o.seq / 9.0,
                    1.0 if o.acting_done else 0.0,
                    1.0 if o.ability_used else 0.0,
                    1.0 if o.skipped_this_round else 0.0,
                    1.0 if o.skip_next_turn else 0.0,
                    min(1.0, len(o.hand) / 10.0),
                    min(1.0, len(o.pouch) / 5.0),
                    1.0 if o.mods.get("pouchImmune") else 0.0,
                    1.0 if o.mods.get("handImmune") else 0.0,
                    1.0 if o.mods.get("ascendLocked") else 0.0,
                    1.0 if o.mods.get("silenced") else 0.0,
                    min(1.0, o.mods.get("trickBonus", 0) / 5.0),
                    min(1.0, o.mods.get("trickPenalty", 0) / 5.0),
                    1.0 if o.pid in played_ids else 0.0,
                ]
            off += 16

        # 3 x 8 = 24 top-3 Grave cards
        for k in range(3):
            c = self.grave[k] if k < len(self.grave) else None
            vec[off:off + 8] = self._encode_card_slot(c)
            off += 8

        return vec

    def get_critic_obs(self, pid: int) -> np.ndarray:
        """Centralized Critic observation (training only): Actor obs + true hidden Hands, Pouches, Top-3 Deck."""
        vec = np.zeros(CRITIC_OBS_DIM, dtype=np.float32)
        vec[:ACTOR_OBS_DIM] = self.get_actor_obs(pid)
        off = ACTOR_OBS_DIM
        opps = [self.players[(pid + k) % self.player_count] for k in range(1, self.player_count)]
        for k in range(3):
            if k < len(opps):
                for c in opps[k].hand:
                    vec[off + c.cid] = 1.0
            off += NUM_CARDS
        for k in range(3):
            if k < len(opps):
                for c in opps[k].pouch:
                    vec[off + c.cid] = 1.0
            off += NUM_CARDS
        for k in range(3):
            c = self.deck[k] if k < len(self.deck) else None
            vec[off:off + 8] = self._encode_card_slot(c)
            off += 8
        return vec

    # ------------------------------------------------------------------
    # STEP EXECUTION
    # ------------------------------------------------------------------
    def _remove_hand(self, p: PlayerState, c: Card) -> bool:
        for i, h in enumerate(p.hand):
            if h.cid == c.cid:
                p.hand.pop(i)
                self.known_opp_hands[p.pid].discard(c.cid)
                return True
        return False

    def _force_discard(self, victim: PlayerState, count: int = 1) -> int:
        if victim.mods.get("handImmune") or self.round_mods.get("globalImmunity"):
            return 0
        dropped = 0
        for _ in range(count):
            if victim.mods.get("sunFloor") and len(victim.hand) <= 3:
                break
            if not victim.hand:
                victim.skip_next_turn = True
                break
            c = victim.hand.pop()
            self.known_opp_hands[victim.pid].discard(c.cid)
            self.grave.insert(0, c)
            victim.lost_card_round = True
            dropped += 1
        return dropped

    def _destroy_pouch(self, actor: PlayerState, victim: PlayerState, count: int = 1, ignore_traps: bool = False) -> int:
        if victim.mods.get("pouchImmune") or self.round_mods.get("globalImmunity"):
            return 0
        hits = 0
        for _ in range(count):
            if not victim.pouch:
                break
            idx = self.rng.randrange(len(victim.pouch))
            c = victim.pouch.pop(idx)
            self.known_opp_pouches[victim.pid].discard(c.cid)
            self.grave.insert(0, c)
            if not ignore_traps and ((not c.is_major and c.rank == 11) or victim.mods.get("despairTraps")):
                if actor.pouch:
                    victim.hand.append(actor.pouch.pop())
                elif actor.hand:
                    victim.hand.append(actor.hand.pop())
                continue
            victim.pouch_lost_round = True
            hits += 1
        return hits

    def _prune_known_fog(self) -> None:
        """Drop fog memory for cards no longer in that zone after JS resolve."""
        for pl in self.players:
            hand_ids = {c.cid for c in pl.hand}
            pouch_ids = {c.cid for c in pl.pouch}
            self.known_opp_hands[pl.pid] &= hand_ids
            self.known_opp_pouches[pl.pid] &= pouch_ids

    def _log_netlist(self, code: str) -> None:
        if not hasattr(self, "netlist_lines"):
            self.netlist_lines = []
        if code:
            self.netlist_lines.append(code)

    def _card_code(self, c: Card) -> str:
        if c.is_major:
            return f"X{c.major_id}"
        suit_ch = {"swords": "S", "wands": "W", "pentacles": "P", "cups": "C"}.get(c.suit or "", "?")
        if c.rank == 11:
            r = "P"
        elif c.rank == 12:
            r = "N"
        elif c.rank == 13:
            r = "Q"
        elif c.rank == 14:
            r = "K"
        else:
            r = str(c.rank)
        return f"{suit_ch}{r}"

    def _resolve_chaos(self, p: PlayerState, major: Card, target: Optional[PlayerState]) -> None:
        """Resolve Major Arcana via live JS engineCore (fallback: Python port)."""
        tgt = f" (#{(target.pid if target else -1) + 1})" if target else ""
        self._log_netlist(f"![#{p.pid + 1}: {self._card_code(major)}{tgt}]")
        use_js = True
        try:
            import os
            if os.environ.get("LOTM_JS_RULES", "1") == "0":
                use_js = False
            else:
                from js_rules_client import get_bridge
                bridge = get_bridge()
                bridge.resolve_chaos(self, p, major, target)
                self.recycled_cids.add(major.cid)
                self._prune_known_fog()
                return
        except Exception as exc:
            # Fall through to Python table so training never hard-stops mid-game
            self._log_netlist(f"#js_chaos_fallback:{exc}")
            use_js = False
        if not use_js:
            self._resolve_chaos_py(p, major, target)

    def _resolve_ability(self, p: PlayerState, tag: str, target: Optional[PlayerState], copy_depth: int = 0) -> None:
        """Resolve sequence ability via live JS engineCore (fallback: Python port)."""
        tgt = f"(#{target.pid + 1})" if target else ""
        self._log_netlist(f"#{p.pid + 1}: z{p.pathway_id}q{p.seq}{tgt}")
        use_js = True
        try:
            import os
            if os.environ.get("LOTM_JS_RULES", "1") == "0":
                use_js = False
            else:
                from js_rules_client import get_bridge
                bridge = get_bridge()
                bridge.resolve_ability(self, p, tag, target, copy_depth)
                self._prune_known_fog()
                return
        except Exception as exc:
            self._log_netlist(f"#js_ability_fallback:{exc}")
            use_js = False
        if not use_js:
            self._resolve_ability_py(p, tag, target, copy_depth)

    def _resolve_chaos_py(self, p: PlayerState, major: Card, target: Optional[PlayerState]) -> None:
        self._remove_hand(p, major)
        cid = major.major_id
        others = self._active_opps(p.pid)
        if cid == 0 and p.hand and self.trump_card:
            swap = p.hand.pop(0)
            p.hand.append(self.trump_card)
            self.trump_card = swap
            self.round_mods["trumpChanged"] = True
        elif cid == 1 and p.pouch and target and target.pouch and not target.mods.get("pouchImmune"):
            a, b = p.pouch.pop(), target.pouch.pop()
            p.pouch.append(b)
            target.pouch.append(a)
        elif cid == 2 and len(self.deck) >= 2:
            top = sorted(self.deck[:3], key=lambda c: c.major_id if c.is_major else c.rank, reverse=True)
            self.deck[:len(top)] = top
        elif cid == 3 and target and not self.round_mods.get("globalImmunity"):
            rev_page = False
            if target.pouch and not target.mods.get("pouchImmune"):
                idx = self.rng.randrange(len(target.pouch))
                if not target.pouch[idx].is_major and target.pouch[idx].rank == 11:
                    self.grave.insert(0, target.pouch.pop(idx))
                    rev_page = True
                else:
                    self.known_opp_pouches[target.pid].add(target.pouch[idx].cid)
            if not rev_page:
                self._force_discard(target, 1)
        elif cid == 4:
            self.round_mods["invertTrick"] = True
        elif cid == 5:
            req = self.trump_card.card_suit if self.trump_card else "swords"
            for o in others:
                if not any(c.card_suit == req for c in o.hand):
                    self._force_discard(o, 1)
        elif cid == 6 and p.hand and target and target.hand:
            a, b = p.hand.pop(), target.hand.pop()
            p.hand.append(b)
            target.hand.append(a)
        elif cid == 7:
            self.round_mods["noTrumpChariot"] = True
        elif cid == 8:
            self.round_mods["globalImmunity"] = True
        elif cid == 9 and self.grave:
            p.hand.append(self.grave.pop(0))
        elif cid == 10:
            passed = [pl.hand.pop() if pl.hand else None for pl in self.players]
            for idx, pl in enumerate(self.players):
                c_in = passed[(idx - 1) % self.player_count]
                if c_in:
                    pl.hand.append(c_in)
                pl.hand.extend(self._draw(1))
        elif cid == 11:
            srt = sorted(self.players, key=lambda pl: len(pl.hand), reverse=True)
            if srt[0].pid != srt[-1].pid and srt[0].hand:
                srt[-1].hand.append(srt[0].hand.pop())
        elif cid == 12:
            self._force_discard(p, 2)
            for c in self._draw(2):
                if len(p.pouch) < int(p.mods.get("maxPouch", 3)):
                    p.pouch.append(c)
                else:
                    p.hand.append(c)
        elif cid == 13:
            for pl in self.players:
                self._destroy_pouch(p, pl, 1, ignore_traps=True)
        elif cid == 14:
            self.round_mods["cancelSuitActions"] = True
        elif cid == 15:
            for o in others:
                if len(o.hand) > 1 and not o.mods.get("handImmune"):
                    self._force_discard(o, 1)
                else:
                    self._destroy_pouch(p, o, 1, ignore_traps=True)
        elif cid == 16 and self.grave:
            old_t = self.trump_card
            self.trump_card = self.grave.pop(0)
            if old_t:
                self.grave.insert(0, old_t)
            self.round_mods["trumpChanged"] = True
        elif cid == 17:
            p.hand.extend(self._draw(1))
            if target:
                for c in target.pouch:
                    self.known_opp_pouches[target.pid].add(c.cid)
        elif cid == 18:
            pool: List[Card] = []
            counts = []
            for pl in self.players:
                if pl.mods.get("pouchImmune"):
                    counts.append(0)
                else:
                    counts.append(len(pl.pouch))
                    pool.extend(pl.pouch)
                    pl.pouch.clear()
                    self.known_opp_pouches[pl.pid].clear()
            self.rng.shuffle(pool)
            for pl, cnt in zip(self.players, counts):
                pl.pouch = pool[:cnt]
                pool = pool[cnt:]
        elif cid == 19:
            p.hand.extend(self._draw(1))
            if len(p.pouch) < int(p.mods.get("maxPouch", 3)) and p.hand:
                p.pouch.append(p.hand.pop())
        elif cid == 20:
            for o in others:
                if o.pouch and not o.mods.get("pouchImmune"):
                    o.hand.append(o.pouch.pop())
        elif cid == 21:
            p.mods["trickBonus"] = p.mods.get("trickBonus", 0) + 3

        if p.pathway_id == 2 and p.seq in (4, 1):
            p.acting_done = True
        if p.pathway_id == 12 and p.seq == 1:
            p.acting_done = True

        rec_cnt = 0 if p.mods.get("skipRecycle") else cid
        rec = self.grave[:rec_cnt]
        del self.grave[:rec_cnt]
        self.deck.append(major)
        self.deck.extend(rec)
        self.recycled_cids.add(major.cid)
        for rc in rec:
            self.recycled_cids.add(rc.cid)

    def _resolve_ability_py(self, p: PlayerState, tag: str, target: Optional[PlayerState], copy_depth: int = 0) -> None:
        others = self._active_opps(p.pid)
        max_p = int(p.mods.get("maxPouch", 3))

        if tag in ("clown_shield", "pouch_immune_draw"):
            p.mods["pouchImmune"] = True
            p.hand.extend(self._draw(1))
        elif tag == "illusion_boost":
            p.mods["trickBonus"] = p.mods.get("trickBonus", 0) + 3
            p.mods["countsAsTrump"] = True
        elif tag == "copy_ability" and target and copy_depth < 1:
            opp_tag = PATHWAY_SEQ_TAGS[target.pathway_id].get(target.seq, "draw_1_peek")
            if opp_tag != "copy_ability":
                self._resolve_ability_py(p, opp_tag, target, copy_depth + 1)
            p.acting_done = True
        elif tag == "marionette" and target:
            self._force_discard(target, 1)
            target.mods["trickPenalty"] = target.mods.get("trickPenalty", 0) + 2
            p.acting_done = True
        elif tag in ("draw_2", "life_giver", "white_angel", "reboot_trick"):
            p.hand.extend(self._draw(3 if (tag == "life_giver" and len(p.hand) <= 3) else 2))
            if tag == "white_angel":
                for o in others:
                    o.mods.clear()
            p.acting_done = True
        elif tag in ("cycle_2_1", "mysticism_cycle"):
            p.hand.extend(self._draw(2 if tag == "cycle_2_1" else 1))
            if p.hand:
                c = p.hand.pop()
                (self.deck.append(c) if tag == "mysticism_cycle" else self.grave.insert(0, c))
            p.acting_done = True
        elif tag == "blink_immune":
            p.mods["handImmune"] = True
            p.mods["pouchImmune"] = True
            p.hand.extend(self._draw(1))
        elif tag in ("trick_plus_1", "trick_plus_2", "assassin_ambush", "hunter_track", "prophet_foresight", "night_owl"):
            bonus = 2 if tag in ("trick_plus_2", "assassin_ambush", "prophet_foresight") else 1
            p.mods["trickBonus"] = p.mods.get("trickBonus", 0) + bonus
            if tag in ("night_owl",):
                p.hand.extend(self._draw(1))
                p.acting_done = True
        elif tag == "fury_boost":
            self._force_discard(p, 1)
            p.mods["trickBonus"] = p.mods.get("trickBonus", 0) + 3
            p.mods["folkWinDraw"] = True
        elif tag == "invert_trick":
            self.round_mods["invertTrick"] = True
            p.mods["baronPouch"] = True
        elif tag == "abolish_trump":
            self.round_mods["abolishTrump"] = True
            if p.pathway_id == 4:
                p.mods["trickBonus"] = p.mods.get("trickBonus", 0) + 1
            if p.pathway_id == 20:
                p.hand.extend(self._draw(1))
        elif tag == "unblockable_next":
            p.mods["unblockable"] = True
            p.mods["trickBonus"] = p.mods.get("trickBonus", 0) + 1
        elif tag == "weaken_opp" and target:
            target.mods["trickPenalty"] = target.mods.get("trickPenalty", 0) + 3
            if p.pathway_id == 4:
                p.hand.extend(self._draw(1))
        elif tag == "double_suit":
            p.mods["doubleSuit"] = True
        elif tag == "math_plus_minus_1":
            p.mods["mathLeeway"] = max(p.mods.get("mathLeeway", 0), 1)
            p.mods["lawyerKeepOne"] = True
        elif tag == "math_plus_minus_2":
            p.mods["mathLeeway"] = max(p.mods.get("mathLeeway", 0), 2)
            p.hand.extend(self._draw(1))
            p.acting_done = True
        elif tag == "savant_subtract":
            p.mods["savantSubtract"] = True
            if len(p.pouch) >= 2:
                p.acting_done = True
        elif tag == "hand_ascend":
            p.mods["handAscend"] = True
        elif tag == "astronomer_wild":
            p.mods["astronomerWild"] = True
        elif tag in ("witch_burn", "demon_hunter_strike", "hand_of_god") and target:
            if self._destroy_pouch(p, target, 1, ignore_traps=(tag != "witch_burn")) > 0:
                if tag == "witch_burn":
                    p.hand.extend(self._draw(1))
                p.acting_done = True
            if tag == "hand_of_god":
                p.mods["trickBonus"] = p.mods.get("trickBonus", 0) + 2
        elif tag in ("steal_pouch_safe", "crimson_moon") and target and target.pouch and not target.mods.get("pouchImmune"):
            p.hand.append(target.pouch.pop())
            if tag == "crimson_moon":
                p.hand.extend(self._draw(1))
            p.acting_done = True
        elif tag == "steal_trump_hand" and target and target.hand:
            ts = self.trump_card.card_suit if self.trump_card else None
            idx = next((i for i, c in enumerate(target.hand) if ts and c.card_suit == ts), -1)
            if idx != -1:
                p.hand.append(target.hand.pop(idx))
                p.acting_done = True
            elif p.pathway_id != 9:
                p.hand.append(target.hand.pop(0))
                p.acting_done = True
        elif tag in ("frenzy_discard", "taunt_discard", "criminal_discard", "blatherer_2", "filthy_monarch", "interrogator") and target:
            cnt = 2 if tag in ("blatherer_2", "filthy_monarch") else 1
            if self._force_discard(target, cnt) > 0:
                p.acting_done = True
            if tag == "taunt_discard":
                p.mods["handImmune"] = True
        elif tag in ("plague_aoe", "siren_song", "wrath_sea", "eternal_night"):
            for o in others:
                self._force_discard(o, 2 if tag == "wrath_sea" and len(o.hand) > 2 else 1)
            if tag == "eternal_night":
                p.mods["eternalNight"] = True
            p.acting_done = True
        elif tag in ("tsunami_aoe", "catastrophe_aoe"):
            for o in others:
                if self._destroy_pouch(p, o, 1) > 0 and tag == "tsunami_aoe":
                    p.hand.extend(self._draw(1))
            p.acting_done = True
        elif tag in ("grave_peek_take", "grave_best_to_hand", "grave_face_pull", "soul_harvest", "doctor_heal", "undying_revive"):
            cnt = 2 if tag == "undying_revive" else 1
            for _ in range(cnt):
                if self.grave:
                    p.hand.append(self.grave.pop(0))
                else:
                    p.hand.extend(self._draw(1))
            if tag == "doctor_heal":
                p.mods["handImmune"] = True
            p.acting_done = True
        elif tag in ("extra_pouch_add", "omniscient_eye", "author_coincidence", "abomination_unchain"):
            if tag == "abomination_unchain":
                p.mods["maxPouch"] = 5
                max_p = 5
            if tag in ("omniscient_eye", "author_coincidence"):
                p.hand.extend(self._draw(1 if tag == "omniscient_eye" else 2))
            if len(p.pouch) < max_p and p.hand:
                p.pouch.append(p.hand.pop())
            p.acting_done = True
        elif tag == "steal_time" and target:
            target.skip_next_turn = True
            p.acting_done = True
        elif tag == "wraith_possess" and target:
            target.mods["ascendLocked"] = True
            self._force_discard(target, 1)
            p.acting_done = True
        elif tag == "world_tree":
            p.mods["pouchImmune"] = True
            p.mods["mathLeeway"] = 2
        elif tag == "spatial_lock":
            self.round_mods["spatialLock"] = True
        elif tag == "declare_war":
            self.round_mods["warDeclared"] = True
        elif tag == "weather_swords":
            self.round_mods["weatherSwords"] = True
            p.mods["trickBonus"] = p.mods.get("trickBonus", 0) + 2
        elif tag == "thunderclap":
            for o in others:
                o.mods["nonTrumpPenalty"] = o.mods.get("nonTrumpPenalty", 0) + 3
        elif tag == "glory_aura":
            for o in others:
                o.mods["trickPenalty"] = o.mods.get("trickPenalty", 0) + 2
        elif tag == "transmute_trump":
            p.mods["countsAsTrump"] = True
        elif tag == "cups_are_trump":
            p.mods["cupsAreTrump"] = True
        elif tag == "face_can_win":
            p.mods["faceCanWin"] = True
            p.mods["trickBonus"] = p.mods.get("trickBonus", 0) + 2
        elif tag == "dawn_paladin":
            p.mods["dawnPaladin"] = True
            p.mods["pouchImmune"] = True
        elif tag == "warrior_mastery":
            p.mods["warriorTakeWinner"] = True
        elif tag == "despair_traps":
            p.mods["despairTraps"] = True
        else:
            p.hand.extend(self._draw(1))
            p.acting_done = True

    def _finish_trick_card_suit_action(self, actor: PlayerState, card: Card, target: Optional[PlayerState]) -> None:
        if self.round_mods.get("globalImmunity") or self.round_mods.get("cancelSuitActions") or actor.mods.get("silenced"):
            return
        times = 2 if actor.mods.get("doubleSuit") else 1
        if card.rank == 14 and target:
            for c in target.hand:
                self.known_opp_hands[target.pid].add(c.cid)
            idx = next((i for i, c in enumerate(target.hand) if c.suit == card.suit), -1)
            if idx != -1:
                stolen = target.hand.pop(idx)
                self.known_opp_hands[target.pid].discard(stolen.cid)
                actor.hand.append(stolen)
        if card.suit == "swords" and target:
            target.targeted_round = True
            if target.mods.get("dawnPaladin"):
                if len(target.pouch) < int(target.mods.get("maxPouch", 3)):
                    target.pouch.append(card)
                else:
                    target.hand.append(card)
                self.trick_plays[-1]["absorbed"] = True
                target.acting_done = True
            else:
                hits = (2 if self.round_mods.get("apocalypse") else 1) * times
                if self._destroy_pouch(actor, target, hits) > 0 and actor.pathway_id in (3, 5, 7, 8):
                    actor.acting_done = True
        elif card.suit == "wands" and target:
            target.targeted_round = True
            if self._force_discard(target, times) > 0 and actor.pathway_id in (3, 4, 15):
                actor.acting_done = True
        elif card.suit == "pentacles":
            actor.hand.extend(self._draw(times))
        elif card.suit == "cups":
            for _ in range(times):
                if self.grave:
                    actor.hand.append(self.grave.pop(0))

    def _advance_trick(self) -> None:
        self.trick_idx += 1
        if self.trick_idx >= len(self.trick_order):
            win_play = evaluate_trick_winner(self.trick_plays, self.trump_card, self.round_mods)
            self.trick_winner_id = win_play["player_id"] if win_play else 0
            winner = self.players[self.trick_winner_id]
            if self.round_mods.get("warDeclared"):
                for pl in self.players:
                    if pl.pid != winner.pid and not pl.skipped_this_round:
                        self._force_discard(pl, 1)
            if winner.mods.get("eternalNight"):
                winner.hand.extend(self._draw(2))
            if winner.mods.get("folkWinDraw"):
                winner.hand.extend(self._draw(1))
            if winner.seq in (7, 6, 4, 3, 2, 1):
                winner.acting_done = True
            self.phase = "TRICK_REWARD"

    def step(self, action: LegalAction) -> Tuple[Dict[int, float], bool, Dict[str, Any]]:
        """Execute one legal action and return (step_rewards_by_pid, done, info)."""
        rewards: Dict[int, float] = {i: 0.0 for i in range(self.player_count)}
        if self.done:
            return rewards, True, {"winner_id": self.winner_id}

        pid = self.current_player_id()
        p = self.players[pid]

        if self.pending_interrupt is not None:
            pi = self.pending_interrupt
            self.pending_interrupt = None
            attacker = self.players[pi["attacker_id"]]
            if action.atype == "INTERRUPT_BLOCK" and action.card is not None:
                self._remove_hand(p, action.card)
                self.grave.insert(0, action.card)
                if action.card.suit == "pentacles":
                    p.hand.extend(self._draw(1))
                elif action.card.suit == "cups" and self.grave:
                    p.hand.append(self.grave.pop(0))
                elif action.card.suit == "swords" and action.target_id is not None:
                    self._destroy_pouch(p, self.players[action.target_id], 1)
                elif action.card.suit == "wands" and action.target_id is not None:
                    self._force_discard(self.players[action.target_id], 1)
            else:
                self._finish_trick_card_suit_action(attacker, pi["card"], p)
            self._advance_trick()
            return rewards, self.done, {}

        if self.phase == "POUCH_ADD":
            if action.atype == "TUCK_POUCH" and action.card is not None:
                if self._remove_hand(p, action.card):
                    p.pouch.append(action.card)
                    self._log_netlist(f"#{pid + 1}: +/{self._card_code(action.card)}")
            elif action.atype == "DISCARD_POUCH" and action.card is not None:
                p.pouch = [c for c in p.pouch if c.cid != action.card.cid]
                self.grave.insert(0, action.card)
                self._log_netlist(f"#{pid + 1}: -/{self._card_code(action.card)}")
            else:
                self.pouch_idx += 1
                if self.pouch_idx >= len(self.pouch_order):
                    self._start_draft()
            return rewards, self.done, {}

        if self.phase == "DRAFT":
            if action.card is not None:
                self.center_draft = [c for c in self.center_draft if c.cid != action.card.cid]
                p.hand.append(action.card)
                self.known_opp_hands[pid].add(action.card.cid)
                self._log_netlist(f"#{pid + 1}: +{self._card_code(action.card)}")
            self.draft_idx += 1
            if self.draft_idx >= len(self.draft_order):
                self._start_trick()
            return rewards, self.done, {}

        if self.phase == "TRICK":
            target = self.players[action.target_id] if action.target_id is not None else None
            if action.atype == "USE_SEQ_ABILITY":
                if p.acting_done and p.hand:
                    self.grave.insert(0, p.hand.pop())
                p.ability_used = True
                p.ability_casts += 1
                self._resolve_ability(p, action.extra, target)
                return rewards, self.done, {}

            if action.atype == "PLAY_INSTANT_CHAOS" and action.card is not None:
                self._resolve_chaos(p, action.card, target)
                return rewards, self.done, {}

            if action.atype == "PLAY_TRICK_MAJOR" and action.card is not None:
                self._resolve_chaos(p, action.card, target)
                self.trick_plays.append({
                    "player_id": pid, "card": action.card, "eff_value": action.card.major_id,
                    "eff_suit": "major", "is_ten_override": False,
                    "counts_as_trump": bool(self.trump_card and self.trump_card.is_major),
                    "face_can_win": False, "wins_ties": False, "absorbed": True,
                })
                self._advance_trick()
                return rewards, self.done, {}

            if action.atype == "PLAY_TRICK_MINOR" and action.card is not None:
                c = action.card
                tgt = f"(#{target.pid + 1})" if target is not None else ""
                self._log_netlist(f"#{pid + 1}: -{self._card_code(c)}{tgt}")
                self._remove_hand(p, c)
                eff_v = c.rank if c.rank <= 10 else (11 if p.mods.get("faceCanWin") else 0)
                if c.rank <= 9:
                    eff_v = min(9, eff_v + int(p.mods.get("trickBonus", 0)))
                if p.mods.get("trickPenalty") and eff_v > 1:
                    eff_v = max(1, eff_v - int(p.mods["trickPenalty"]))
                self.trick_plays.append({
                    "player_id": pid, "card": c, "eff_value": eff_v, "eff_suit": c.suit,
                    "is_ten_override": (c.rank == 10 or bool(p.mods.get("degenerateTen"))),
                    "counts_as_trump": bool(p.mods.get("countsAsTrump")) or (bool(p.mods.get("cupsAreTrump")) and c.suit == "cups"),
                    "face_can_win": bool(p.mods.get("faceCanWin")), "wins_ties": False, "absorbed": False,
                })
                # Check reactive Knight/Queen Interrupt for defender
                can_int = (
                    target is not None
                    and not self.round_mods.get("globalImmunity")
                    and not self.round_mods.get("cancelSuitActions")
                    and not self.round_mods.get("spatialLock")
                    and not self.round_mods.get("apocalypse")
                    and not p.mods.get("unblockable")
                )
                if can_int and c.suit == "swords" and target.pouch and not target.mods.get("pouchImmune"):
                    if any((not hc.is_major and hc.rank == 12) for hc in target.hand):
                        self.pending_interrupt = {"attacker_id": pid, "defender_id": target.pid, "attack_type": "sword", "card": c}
                        return rewards, self.done, {}
                if can_int and c.suit == "wands" and not target.mods.get("handImmune"):
                    if any((not hc.is_major and hc.rank == 13) for hc in target.hand):
                        self.pending_interrupt = {"attacker_id": pid, "defender_id": target.pid, "attack_type": "wand", "card": c}
                        return rewards, self.done, {}

                self._finish_trick_card_suit_action(p, c, target)
                self._advance_trick()
                return rewards, self.done, {}

            self._advance_trick()
            return rewards, self.done, {}

        if self.phase == "TRICK_REWARD":
            mode, suits = action.extra
            if mode == "gamble" and self.deck:
                rev: List[Card] = []
                found: Optional[Card] = None
                while self.deck and found is None:
                    top = self.deck.pop(0)
                    rev.append(top)
                    if not top.is_major:
                        found = top
                if found and found.suit in suits:
                    p.hand.extend(rev)
                    if self.trump_card:
                        p.hand.append(self.trump_card)
                    p.acting_done = True
                else:
                    self.grave[:0] = rev
                    if self.trump_card:
                        self.grave.insert(0, self.trump_card)
            elif self.trump_card:
                p.hand.append(self.trump_card)
                self.known_opp_hands[pid].add(self.trump_card.cid)
            self.trump_card = None
            for tp in self.trick_plays:
                if not tp.get("absorbed"):
                    self.grave.insert(0, tp["card"])
            self.trick_plays.clear()
            self._start_ascend()
            return rewards, self.done, {}

        if self.phase == "ASCEND":
            if action.extra is not None:
                spent: List[Card] = action.extra
                spent_ids = {c.cid for c in spent}
                spent_codes = ",".join(self._card_code(c) for c in spent)
                p.pouch = [c for c in p.pouch if c.cid not in spent_ids]
                if p.mods.get("handAscend"):
                    p.hand = [c for c in p.hand if c.cid not in spent_ids]
                self.grave[:0] = spent
                digested = p.acting_done
                p.seq -= 1
                p.acting_done = False
                p.ability_casts = 0
                self._log_netlist(f"#{pid + 1}: A[{spent_codes}]→q{p.seq}" + ("$" if digested else ""))
                rewards[pid] += 0.12 if digested else 0.08
                if p.seq == 0:
                    self.winner_id = pid
                    self.done = True
                    self.phase = "GAMEOVER"
                    for pl in self.players:
                        rewards[pl.pid] += 1.0 if pl.pid == pid else -1.0
                    return rewards, True, {"winner_id": pid}
                if digested:
                    p.hand.extend(self._draw(1))
                else:
                    self._force_discard(p, 3)

            self.ascend_idx += 1
            if self.ascend_idx >= len(self.ascend_order):
                self._end_round()
                if self.done:
                    # Timeout / gameover shaping: reward relative seq progress
                    seqs = [pl.seq for pl in self.players]
                    for pl in self.players:
                        opp_best = min(s for i, s in enumerate(seqs) if i != pl.pid)
                        gap = opp_best - pl.seq  # positive if ahead (lower seq)
                        if self.winner_id is None:
                            rewards[pl.pid] += 0.15 * gap - 0.15
                        elif self.winner_id == pl.pid:
                            rewards[pl.pid] += 1.0
                        else:
                            rewards[pl.pid] -= 1.0
            return rewards, self.done, {"winner_id": self.winner_id}

        return rewards, self.done, {}


def export_netlist(env: "LotmTarotEnv") -> str:
    """Return accumulated netlist codes (G=, ability casts, chaos instants)."""
    return "\n".join(getattr(env, "netlist_lines", []) or [])


def smoke_test(games: int = 8, seed: int = 0) -> None:
    """Quick integrity check: games finish, legal masks non-empty, dims match."""
    env = LotmTarotEnv(player_count=2, max_rounds=40, seed=seed)
    wins = {0: 0, 1: 0, None: 0}
    for g in range(games):
        env.reset(seed=seed + g)
        steps = 0
        while not env.done and steps < 2500:
            pid = env.current_player_id()
            acts = env.get_legal_actions(pid)
            assert acts, f"empty legal set phase={env.phase} step={steps}"
            obs = env.get_actor_obs(pid)
            cobs = env.get_critic_obs(pid)
            feats = env.encode_action_features(pid, acts)
            assert obs.shape == (ACTOR_OBS_DIM,), obs.shape
            assert cobs.shape == (CRITIC_OBS_DIM,), cobs.shape
            assert feats.shape == (len(acts), ACTION_FEAT_DIM), feats.shape
            # Prefer legal ascend, else tuck useful ranks, else first action
            idx = 0
            for i, a in enumerate(acts):
                if a.atype == "ASCEND_OR_PASS" and a.extra is not None:
                    idx = i
                    break
            else:
                for i, a in enumerate(acts):
                    if a.atype == "TUCK_POUCH" and a.card is not None and a.card.rank in (1, 2, 3, 10):
                        idx = i
                        break
            env.step(acts[idx])
            steps += 1
        wins[env.winner_id] = wins.get(env.winner_id, 0) + 1
        print(f"  game {g}: steps={steps} winner={env.winner_id} seqs={[p.seq for p in env.players]} round={env.round}")
    print(f"smoke ok · wins={wins} · obs={ACTOR_OBS_DIM} critic={CRITIC_OBS_DIM} act={ACTION_FEAT_DIM}")


if __name__ == "__main__":
    smoke_test()