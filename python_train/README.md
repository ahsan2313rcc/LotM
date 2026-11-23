# LoTM Python CUDA Training

## JS ↔ Python ability/chaos sync

**Source of truth:** `src/ai/engineCore.js` (imported by `headless.js` and by the Node bridge).

- `python_train/js_rules_server.mjs` — JSON-line Node worker calling `applyHeadlessAbility` / `applyHeadlessChaos`
- `python_train/js_rules_client.py` — Python client; `LotmTarotEnv` uses it by default for every ability/chaos resolve
- Fallback Python tables remain only if `LOTM_JS_RULES=0` or Node fails (logged as `#js_*_fallback:` in netlist)
- Netlist lines accumulate on `env.netlist_lines` (`export_netlist(env)`)

```powershell
# Parity smoke (requires Node on PATH)
.\.venv\Scripts\python.exe -u python_train\test_js_parity.py
```

Compact `lotm_env` (Small/Medium PPO) stays a thinner loop on purpose; full-card training uses `lotm_emulator.py` + the JS bridge.

## Setup (once)

```powershell
cd D:\Cursor\lotm_tarot_repo
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip numpy
.\.venv\Scripts\python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cu126
.\.venv\Scripts\python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available())"
```

## Full-card stack (your uploaded emulator + PPO/CTDE/PFSP)

Files:
- `lotm_emulator.py` — 78-card env, legal masks, fogged 854-d actor obs, 1346-d CTDE critic
- `train_fullcard_ppo.py` — Masked PPO + PFSP + heuristic curriculum

```powershell
cd D:\Cursor\lotm_tarot_repo

# 1) Smoke-test the emulator (must print "smoke ok")
.\.venv\Scripts\python.exe -u python_train\lotm_emulator.py

# 2) Short verified train (~10–20 min on 3070 Ti)
.\.venv\Scripts\python.exe -u python_train\train_fullcard_ppo.py --updates 40 --episodes-per-update 16 --heur-mix 0.5 --device cuda --export-json python_train\exports\lotm_fullcard.json

# 3) Serious run
.\.venv\Scripts\python.exe -u python_train\train_fullcard_ppo.py --updates 200 --episodes-per-update 24 --heur-mix 0.4 --device cuda --eval-every 10
```

Export format: `lotm_fullcard_ppo_v1` (actor + fogged value; CTDE critic stripped).

## Compact Small/Medium (browser CompactAscentNet)

```powershell
.\.venv\Scripts\python.exe -u python_train\ppo_train.py --tier small --steps 100000 --device cuda
.\.venv\Scripts\python.exe -u python_train\ppo_train.py --tier medium --steps 150000 --device cuda
```

Exports: `python_train/exports/lotm_small.json` / `lotm_medium.json` (`compact_ascent_v1`) — load in the Train Studio.
