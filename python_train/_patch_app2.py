from pathlib import Path

path = Path(r"D:\Cursor\lotm_tarot_repo\src\App.jsx")
text = path.read_text(encoding="utf-8")

# 1) Live card selector
old = """  // Live card selector — Tabula: obs only; Medium/Hard: obs + tactical keySigns
  function selectCardLiveHard(net, state, pId, candidates, phaseTag = 'trick') {
    if (!net || !candidates || candidates.length === 0) return candidates?.[0] || null;
    if (isTabulaNN(net)) {
      return net.selectCard(extractObservation(state, pId, handLimitMode, phaseTag), candidates, null, 0) || candidates[0];
    }
    const keySigns = buildCardKeySigns(state, pId, candidates, phaseTag);
    return net.selectCard(extractCardIdFeatures(state, pId, handLimitMode, phaseTag), candidates, null, 0, keySigns) || candidates[0];
  }"""
new = """  // Live card selector — PolicyNet candidate scorer
  function selectCardLiveHard(net, state, pId, candidates, phaseTag = 'trick') {
    return selectCardLivePolicy(net, state, pId, candidates, phaseTag);
  }"""
if old not in text:
    raise SystemExit("selectCardLiveHard block missing")
text = text.replace(old, new, 1)

# 2) Draft brain branch
old = """            if (isAscentBrain(seatBrain)) {
              const evalAsc = makeAscentNet();
              pick = selectCardLiveAscent(evalAsc, s, dId, s.centerDraft, 'draft') || s.centerDraft[0];
            } else if (seatBrain === 'nn_medium' || seatBrain === 'nn_hard' || seatBrain === 'nn_tabula') {
              const evalHard = makeCardNet(seatBrain);
              pick = selectCardLiveHard(evalHard, s, dId, s.centerDraft, 'draft') || s.centerDraft[0];
            } else {"""
new = """            if (seatBrain === 'nn_small' || seatBrain === 'nn_medium' || seatBrain === 'nn_easy' || seatBrain === 'nn_ascent' || seatBrain === 'nn_tabula' || seatBrain === 'nn_hard') {
              const net = seatBrain === 'nn_medium' ? nnMediumRef.current : nnSmallRef.current;
              pick = selectCardLivePolicy(net, s, dId, s.centerDraft, 'draft') || s.centerDraft[0];
            } else {"""
if old not in text:
    raise SystemExit("draft branch missing")
text = text.replace(old, new, 1)

# 3) Trick AI net resolve — replace the activeNet construction chunk
old = """            const seatBrain = p.brain || aiBrainMode;
            let activeNet = null;
            const useAscent = isAscentBrain(seatBrain);
            try {
              activeNet = useAscent
                ? makeAscentNet()
                : (seatBrain === 'nn_medium' || seatBrain === 'nn_hard' || seatBrain === 'nn_tabula')
                  ? makeCardNet(seatBrain)
                  : (seatBrain === 'nn_easy' ? new LotmNeuralNet(nnEasyRef.current?.bestValSnapshot || nnEasyRef.current?.championSnapshot || nnEasyRef.current?.serialize()) : null);
            } catch (_) { activeNet = null; }
            const useTrainedNN = !!activeNet;
            const isAscentPolicy = !!(activeNet && activeNet.kind === 'ascent');
            const isCardPolicy = !!(activeNet && (isTabulaNN(activeNet) || activeNet.kind === 'medium' || activeNet.kind === 'hard'));
            const hDepth = seatBrain.startsWith('heuristic_') ? (Number(seatBrain.split('_')[1]) || 6) : 5;
            const liveObs = () => (
              isTabulaNN(activeNet)
                ? extractObservation(s, aId, handLimitMode, 'trick')
                : extractCardIdFeatures(s, aId, handLimitMode, 'trick')
            );"""
new = """            const seatBrain = p.brain || aiBrainMode;
            let activeNet = null;
            try {
              if (seatBrain === 'nn_medium') activeNet = nnMediumRef.current;
              else if (seatBrain === 'nn_small' || seatBrain === 'nn_easy' || seatBrain === 'nn_ascent' || seatBrain === 'nn_tabula' || seatBrain === 'nn_hard') {
                activeNet = nnSmallRef.current;
              }
            } catch (_) { activeNet = null; }
            const useTrainedNN = !!(activeNet && isPolicyNet(activeNet));
            const isAscentPolicy = useTrainedNN;
            const isCardPolicy = useTrainedNN;
            const hDepth = seatBrain.startsWith('heuristic_') ? (Number(seatBrain.split('_')[1]) || 6) : 5;
            const liveObs = () => null;"""
if old not in text:
    raise SystemExit("trick net resolve missing")
text = text.replace(old, new, 1)

# 4) Sim parse + eval nets
old = """    const parseBrainOpt = (val) => {
      if (val === 'nn_tabula' || val === 'nn_hard') return { type: 'nn_tabula', depth: 5 };
      if (val === 'nn_medium') return { type: 'nn_medium', depth: 5 };
      if (val === 'nn_easy') return { type: 'nn_easy', depth: 5 };
      if (val === 'nn_ascent') return { type: 'nn_ascent', depth: 5 };
      const d = Number(val.split('_')[1]) || 5;
      return { type: 'heuristic', depth: d };
    };
    const seatCfgs = simSeatBrains.slice(0, simPlayerCount).map(parseBrainOpt);
    const evalEasy = new LotmNeuralNet(nnEasyRef.current.bestValSnapshot || nnEasyRef.current.championSnapshot || nnEasyRef.current.serialize());
    const evalMedium = new CardIdNeuralNet(snapCardNet(nnMediumRef), 'medium');
    const evalHard = new TabulaNet(snapCardNet(nnTabulaRef));
    const evalAscent = new AscentNet(nnAscentRef.current?.serialize?.() || null);
    const evalTabula = evalHard;"""
new = """    const parseBrainOpt = (val) => {
      if (val === 'nn_medium') return { type: 'nn_medium', depth: 5 };
      if (val === 'nn_small' || val === 'nn_easy' || val === 'nn_tabula' || val === 'nn_hard' || val === 'nn_ascent') {
        return { type: 'nn_small', depth: 5 };
      }
      const d = Number(val.split('_')[1]) || 5;
      return { type: 'heuristic', depth: d };
    };
    const seatCfgs = simSeatBrains.slice(0, simPlayerCount).map(parseBrainOpt);
    const evalSmall = nnSmallRef.current;
    const evalMedium = nnMediumRef.current;"""
# may appear twice (sim + rr)
count = text.count(old)
if count == 0:
    raise SystemExit("sim parse block missing")
text = text.replace(old, new)
print("sim parse blocks", count)

# Fix runHeadlessGame calls that still pass old nets
text = text.replace(
    """          nnEasy: evalEasy,
          nnMedium: evalMedium,
          nnHard: evalHard,
          nnAscent: evalAscent,
          nn: evalHard,""",
    """          nnSmall: evalSmall,
          nnEasy: evalSmall,
          nnMedium: evalMedium,
          nn: evalSmall,""",
)
text = text.replace(
    """          nnEasy: evalEasy,
          nnMedium: evalMedium,
          nnHard: evalHard,
          nnAscent: evalAscent,
          nn: evalAscent,""",
    """          nnSmall: evalSmall,
          nnEasy: evalSmall,
          nnMedium: evalMedium,
          nn: evalSmall,""",
)
text = text.replace(
    """                nnEasy: evalEasy,
                nnMedium: evalMedium,
                nnHard: evalHard,
                nn: frozen,""",
    """                nnSmall: nnSmallRef.current,
                nnEasy: nnSmallRef.current,
                nnMedium: nnMediumRef.current,
                nn: nnSmallRef.current,""",
)

# Strip leftover broken API calls that will crash
# Replace ascentChoose(...) with simple heuristic/policy fallbacks is hard — neutralize with policyPick target
# For remaining ascentChoose / isTabulaNN / ASCENT_MODE — do string surgery

# Interrupt yes/no blocks
text = text.replace(
    "wantInt = queryAscentYesNo(net, s, target.id, ASCENT_MODE.INTERRUPT_BLOCK);",
    "wantInt = queryPolicyYesNo(net, s, target.id, 'meta_yesno');",
)
text = text.replace(
    "doGamble = queryAscentYesNo(net, prev, w.id, ASCENT_MODE.GAMBLE);",
    "doGamble = queryPolicyYesNo(net, prev, w.id, 'meta_yesno');",
)

# Generic leftovers that still reference removed symbols — comment-safe stubs via search
for sym in ["isTabulaNN(", "extractObservation(", "ascentChoose(", "ASCENT_MODE.", "new LotmNeuralNet", "new CardIdNeuralNet", "new TabulaNet", "new AscentNet", "nnAscentRef", "nnTabulaRef"]:
    c = text.count(sym)
    if c:
        print("REMAINING", sym, c)

path.write_text(text, encoding="utf-8")
print("wrote App.jsx")
