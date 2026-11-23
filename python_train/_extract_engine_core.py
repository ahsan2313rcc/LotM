from pathlib import Path

p = Path(r"D:\Cursor\lotm_tarot_repo\src\ai\headless.js")
lines = p.read_text(encoding="utf-8").splitlines(True)
start = end = None
for i, l in enumerate(lines):
    if l.startswith("function pickDiscardCardIdx"):
        start = i
    if l.startswith("// Fast headless single-game"):
        end = i
        break
assert start is not None and end is not None
chunk = "".join(lines[start:end])
header = '''/** Shared LoTM ability/chaos — source of truth for headless + Python bridge. */
import { PATHWAYS, getCardSuit } from '../data/constants.js';
import { shuffle, isNumberCard, isFaceCard } from '../utils/cards.js';

'''
out = header + chunk + "\nexport { pickDiscardCardIdx, discardSmart, applyHeadlessChaos, applyHeadlessAbility };\n"
Path(r"D:\Cursor\lotm_tarot_repo\src\ai\engineCore.js").write_text(out, encoding="utf-8")
print("wrote engineCore.js", len(out.splitlines()), "lines")
