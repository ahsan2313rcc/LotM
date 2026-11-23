from pathlib import Path

path = Path(r"D:\Cursor\lotm_tarot_repo\src\App.jsx")
text = path.read_text(encoding="utf-8")

# Interrupt wantInt blocks (two similar)
old_int = """            } else {
              const net = makeCardNet(intBrain);
              if (net) {
                wantInt = !!net.actMeta(isTabulaNN(net) ? extractObservation(s, target.id, handLimitMode, 'trick') : extractCardIdFeatures(s, target.id, handLimitMode, 'trick'), 6, null, 0);
              }
            }"""
new_int = """            } else if (intBrain === 'nn_small' || intBrain === 'nn_medium' || intBrain === 'nn_easy' || intBrain === 'nn_tabula' || intBrain === 'nn_hard') {
              const net = intBrain === 'nn_medium' ? nnMediumRef.current : nnSmallRef.current;
              if (net) wantInt = queryPolicyYesNo(net, s, target.id, 'meta_yesno');
            }"""
c = text.count(old_int)
text = text.replace(old_int, new_int)
print("interrupt blocks", c)

# liveQuery + target selection in trick AI
old_lq = """            const liveQuery = (headEasy, headHard) => {
              if (!activeNet) return false;
              try {
                if (isAscentPolicy) {
                  const mode = headHard === 1 || headEasy === 3 ? ASCENT_MODE.CHAOS_MAJOR
                    : headHard === 0 || headEasy === 2 ? ASCENT_MODE.CAST_ABILITY
                      : ASCENT_MODE.PASS;
                  return queryAscentYesNo(activeNet, s, aId, mode);
                }
                if (isCardPolicy) return activeNet.actMeta(liveObs(), headHard, null, 0);
                return activeNet.act(extractBoardFeatures(s, aId, handLimitMode), headEasy, null, 0);
              } catch (_) { return false; }
            };"""
new_lq = """            const liveQuery = (headEasy, headHard) => {
              if (!activeNet || !isPolicyNet(activeNet)) return false;
              try {
                return queryPolicyYesNo(activeNet, s, aId, 'meta_yesno');
              } catch (_) { return false; }
            };
            const pickTargetPolicy = (opps) => {
              if (!activeNet || !isPolicyNet(activeNet) || !opps?.length) return opps?.[0] || null;
              try {
                const pick = policyPick(activeNet, s, aId, 'target', { opps }, activeNet.tier === 'medium' ? 'medium' : 'small');
                return pick?.opp || opps[0];
              } catch (_) { return opps[0]; }
            };"""
if old_lq not in text:
    raise SystemExit("liveQuery missing")
text = text.replace(old_lq, new_lq, 1)

# Replace ascentChoose target blocks
import re
text = re.sub(
    r"if \(isAscentPolicy && oppsC\.length > 1\) \{\s*try \{\s*const st = \{ \.\.\.s, phase: 'TRICK', toMove: aId, handLimitMode \};\s*const legalT = oppsC\.map\(\(o, i\) => \(\{ mode: ASCENT_MODE\.PICK_TARGET, targetIdx: i, targetId: o\.id \}\)\);\s*const \{ bestIdx \} = ascentChoose\(activeNet, st, aId, legalT, 0, ascentLookaheadDepth\);\s*target = oppsC\[bestIdx\] \|\| target;\s*\} catch \(_\) \{\}\s*\}",
    "if (isAscentPolicy && oppsC.length > 1) { target = pickTargetPolicy(oppsC) || target; }",
    text,
    count=1,
)
text = re.sub(
    r"if \(isAscentPolicy && oppsA\.length > 1\) \{\s*try \{\s*const st = \{ \.\.\.s, phase: 'TRICK', toMove: aId, handLimitMode \};\s*const legalT = oppsA\.map\(\(o, i\) => \(\{ mode: ASCENT_MODE\.PICK_TARGET, targetIdx: i, targetId: o\.id \}\)\);\s*const \{ bestIdx \} = ascentChoose\(activeNet, st, aId, legalT, 0, ascentLookaheadDepth\);\s*target = oppsA\[bestIdx\] \|\| target;\s*\} catch \(_\) \{\}\s*\}",
    "if (isAscentPolicy && oppsA.length > 1) { target = pickTargetPolicy(oppsA) || target; }",
    text,
    count=1,
)
text = re.sub(
    r"if \(isAscentPolicy && oppsLive\.length > 1\) \{\s*try \{\s*const st = \{ \.\.\.s, phase: 'TRICK', toMove: aId, handLimitMode \};\s*const legalT = oppsLive\.map\(\(o, i\) => \(\{ mode: ASCENT_MODE\.PICK_TARGET, targetIdx: i, targetId: o\.id \}\)\);\s*const \{ bestIdx \} = ascentChoose\(activeNet, st, aId, legalT, 0, ascentLookaheadDepth\);\s*bestTarget = oppsLive\[bestIdx\] \|\| bestTarget;\s*\} catch \(_\) \{\}\s*\} else if \(isCardPolicy && oppsLive\.length > 1\) \{\s*try \{\s*bestTarget = activeNet\.selectTarget\(liveObs\(\), oppsLive, null, 0\) \|\| bestTarget;\s*\} catch \(_\) \{\}\s*\}",
    "if (useTrainedNN && oppsLive.length > 1) { bestTarget = pickTargetPolicy(oppsLive) || bestTarget; }",
    text,
    count=1,
)

# RR block
old_rr = """    const parseBrainOpt = (val) => {
      if (val === 'nn_tabula' || val === 'nn_hard') return { type: 'nn_tabula', depth: 5 };
      if (val === 'nn_medium') return { type: 'nn_medium', depth: 5 };
      if (val === 'nn_easy') return { type: 'nn_easy', depth: 5 };
      if (val === 'nn_ascent') return { type: 'nn_ascent', depth: 5 };
      const d = Number(val.split('_')[1]) || 5;
      return { type: 'heuristic', depth: d };
    };
    const p1Cfg = parseBrainOpt(simP1Brain);
    const p2Cfg = parseBrainOpt(simP2Brain);
    const evalEasy = new LotmNeuralNet(nnEasyRef.current.bestValSnapshot || nnEasyRef.current.championSnapshot || nnEasyRef.current.serialize());
    const evalMedium = new CardIdNeuralNet(snapCardNet(nnMediumRef), 'medium');
    const evalHard = new TabulaNet(snapCardNet(nnTabulaRef));
    const evalAscent = new AscentNet(nnAscentRef.current?.serialize?.() || null);
    const evalTabula = evalHard;"""
new_rr = """    const parseBrainOpt = (val) => {
      if (val === 'nn_medium') return { type: 'nn_medium', depth: 5 };
      if (val === 'nn_small' || val === 'nn_easy' || val === 'nn_tabula' || val === 'nn_hard' || val === 'nn_ascent') {
        return { type: 'nn_small', depth: 5 };
      }
      const d = Number(val.split('_')[1]) || 5;
      return { type: 'heuristic', depth: d };
    };
    const p1Cfg = parseBrainOpt(simP1Brain);
    const p2Cfg = parseBrainOpt(simP2Brain);
    const evalSmall = nnSmallRef.current;
    const evalMedium = nnMediumRef.current;"""
if old_rr not in text:
    raise SystemExit("RR block missing")
text = text.replace(old_rr, new_rr, 1)

for sym in ["isTabulaNN(", "extractObservation(", "ascentChoose(", "ASCENT_MODE.", "new LotmNeuralNet", "new CardIdNeuralNet", "new TabulaNet", "new AscentNet", "nnAscentRef", "nnTabulaRef"]:
    print("left", sym, text.count(sym))

path.write_text(text, encoding="utf-8")
print("ok")
