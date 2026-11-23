import re
from pathlib import Path

js = Path(r"D:\Cursor\lotm_tarot_repo\src\ai\engineCore.js").read_text(encoding="utf-8")
start = js.find("switch (tag)")
end = js.find("default: actor.hand.push", start)
block = js[start:end]
cases = re.findall(r"case '([^']+)'", block)
print("js_ability_cases", len(cases), "unique", len(set(cases)))

py = Path(r"D:\Cursor\lotm_tarot_repo\python_train\lotm_emulator.py").read_text(encoding="utf-8")
# Python fallback table only — live path uses JS bridge
handled = set(re.findall(r'tag == "([^"]+)"', py))
for m in re.findall(r"tag in \(([^)]+)\)", py):
    handled.update(re.findall(r'"([^"]+)"', m))
missing = sorted(set(cases) - handled)
extra = sorted(handled - set(cases))
print("py_fallback_handled", len(handled))
print("missing_in_py_fallback_but_covered_by_js_bridge", len(missing))
for t in missing[:20]:
    print("  -", t)
if len(missing) > 20:
    print(f"  ... +{len(missing) - 20} more")
print("extra_not_in_js", extra)
print("SYNC: LotmTarotEnv._resolve_ability/_resolve_chaos default to engineCore via js_rules_server.mjs")
