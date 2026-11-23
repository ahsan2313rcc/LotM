"""Ascension math + trick winner — mirrors src/utils/rules.js (core)."""
from __future__ import annotations

from typing import List, Optional, Dict, Any
from .cards import Card, SUITS


def check_ascension_math(cards: List[Card], target_seq: int, mods: Optional[Dict] = None) -> bool:
    mods = mods or {}
    if not cards:
        return False
    nums = []
    wild = 0
    for c in cards:
        if c.type != "minor":
            return False
        if c.rank == 10 or (c.rank == 1 and mods.get("astronomerWild")):
            wild += 1
        elif c.rank is not None and 1 <= c.rank <= 9:
            nums.append(c.rank)
        else:
            return False
    if mods.get("darkSubBonus") and cards:
        return True
    leeway = int(mods.get("mathLeeway") or 0)
    base = sum(nums)
    lo = base + wild * 1 - leeway
    hi = base + wild * 9 + leeway
    if lo <= target_seq <= hi:
        return True
    if mods.get("savantSubtract") and len(nums) >= 2:
        sorted_n = sorted(nums, reverse=True)
        diff = sorted_n[0] - sum(sorted_n[1:])
        if abs(diff - target_seq) <= leeway:
            return True
    return False


def find_valid_ascension_subset(cards: List[Card], target_seq: int, mods: Optional[Dict] = None):
    n = len(cards)
    if n == 0 or n > 12:
        # cap search for speed
        n = min(n, 10)
        cards = cards[:n]
    for mask in range(1, 1 << n):
        sub = [cards[i] for i in range(n) if mask & (1 << i)]
        if check_ascension_math(sub, target_seq, mods):
            return sub
    return None


def evaluate_trick_winner(plays: List[Dict[str, Any]], trump: Optional[Card], round_mods: Dict) -> Optional[Dict]:
    if not plays:
        return None
    lead_suit = plays[0].get("eff_suit")
    trump_suit = None
    if trump:
        trump_suit = "major" if trump.type == "major" else trump.suit
    if round_mods.get("abolishTrump") or round_mods.get("noTrumpChariot"):
        trump_suit = None
    if round_mods.get("weatherSwords"):
        trump_suit = "swords"

    def score(p):
        suit = p.get("eff_suit")
        val = p.get("eff_value", 0)
        is_trump = trump_suit and (suit == trump_suit or p.get("counts_as_trump"))
        if is_trump:
            return (3, val)
        if suit == lead_suit:
            return (2, val)
        return (1, val)

    best = plays[0]
    for p in plays[1:]:
        if score(p) > score(best):
            best = p
    return best


def eff_value(card: Card) -> int:
    if card.type == "major":
        return int(card.major_id or 0)
    r = card.rank or 0
    if r <= 10:
        return r
    return 0  # faces default 0 unless mods


def eff_suit(card: Card) -> Optional[str]:
    if card.type == "major":
        return "major"
    return card.suit
