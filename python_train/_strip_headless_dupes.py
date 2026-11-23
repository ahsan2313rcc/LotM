from pathlib import Path

p = Path(r"D:\Cursor\lotm_tarot_repo\src\ai\headless.js")
lines = p.read_text(encoding="utf-8").splitlines(True)
start = None
end = None
for i, l in enumerate(lines):
    if l.startswith("/**") and i > 10 and start is None:
        # first docblock after imports — the deprecated one
        if "Ability/chaos live in engineCore" in "".join(lines[i : i + 5]):
            start = i
    if l.startswith("// Fast headless single-game"):
        end = i
        break
assert start is not None and end is not None, (start, end)
new = lines[:start] + ["\n"] + lines[end:]
p.write_text("".join(new), encoding="utf-8")
print(f"stripped lines {start}:{end}, now {len(new)} lines")
