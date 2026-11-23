"""Card / deck helpers — mirrors src/utils/cards.js indices."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional
import random

SUITS = ["swords", "wands", "pentacles", "cups"]
RANK_LABELS = {
    1: "A", 2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10",
    11: "Page", 12: "Knight", 13: "Queen", 14: "King",
}


@dataclass
class Card:
    uid: str
    type: str  # minor | major
    suit: Optional[str] = None
    rank: Optional[int] = None
    major_id: Optional[int] = None

    def card_id(self) -> int:
        """Canonical 0..77 index."""
        if self.type == "major":
            return 56 + int(self.major_id or 0)
        s = SUITS.index(self.suit)
        return s * 14 + max(0, min(13, (self.rank or 1) - 1))


def build_minor_deck(uid_start: int = 100) -> List[Card]:
    cards = []
    uid = uid_start
    for suit in SUITS:
        for rank in range(1, 15):
            cards.append(Card(uid=f"m_{uid}", type="minor", suit=suit, rank=rank))
            uid += 1
    return cards


def build_major(pathway_id: int) -> Card:
    return Card(uid=f"M_{pathway_id}", type="major", major_id=pathway_id)


def shuffle(arr: list, rng: random.Random) -> list:
    a = list(arr)
    rng.shuffle(a)
    return a
