from pathlib import Path

path = Path(r"D:\Cursor\lotm_tarot_repo\src\App.jsx")
text = path.read_text(encoding="utf-8")

old = """  // Tiers: easy | medium | tabula | ascent (self-play, fastest-to-0)
  const [nnDifficulty, setNnDifficulty] = useState('ascent');
  const nnTabulaRef = useRef(null);
  const nnEasyRef = useRef(null);
  const nnMediumRef = useRef(null);
  const nnAscentRef = useRef(null);
  if (!nnEasyRef.current) {
    let saved = null;
    try { const raw = localStorage.getItem('lotm_nn_champion_v1'); if (raw) saved = JSON.parse(raw); } catch (_) {}
    nnEasyRef.current = new LotmNeuralNet(saved);
  }
  if (!nnMediumRef.current) {
    let saved = null;
    try {
      const raw = localStorage.getItem('lotm_nn_medium_v2') || localStorage.getItem('lotm_nn_hard_v2');
      if (raw) saved = JSON.parse(raw);
    } catch (_) {}
    // Shipped CEM champion (~55% vs D6) when browser has no Medium weights yet
    if (!saved && mediumChampionSeed?.w1) saved = mediumChampionSeed;
    nnMediumRef.current = new CardIdNeuralNet(saved, 'medium');
  }
  if (!nnTabulaRef.current) {
    let saved = null;
    try {
      const raw = localStorage.getItem('lotm_nn_tabula_v1');
      if (raw) saved = JSON.parse(raw);
    } catch (_) {}
    nnTabulaRef.current = new TabulaNet(saved);
  }
  if (!nnAscentRef.current) {
    let saved = null;
    try {
      const raw = localStorage.getItem('lotm_nn_ascent_v1');
      if (raw) saved = JSON.parse(raw);
    } catch (_) {}
    nnAscentRef.current = new AscentNet(saved);
  }
  // Legacy alias used by older seat/brain paths
  const nnHardRef = nnTabulaRef;
  const getActiveNN = () => (
    nnDifficulty === 'easy' ? nnEasyRef.current
      : nnDifficulty === 'medium' ? nnMediumRef.current
        : nnDifficulty === 'ascent' ? nnAscentRef.current
          : nnTabulaRef.current
  );
  const getActiveStorageKey = () => (
    nnDifficulty === 'easy' ? 'lotm_nn_champion_v1'
      : nnDifficulty === 'medium' ? 'lotm_nn_medium_v2'
        : nnDifficulty === 'ascent' ? 'lotm_nn_ascent_v1'
          : 'lotm_nn_tabula_v1'
  );
  const cloneActiveNN = (snap) => (
    nnDifficulty === 'easy' ? new LotmNeuralNet(snap)
      : nnDifficulty === 'medium' ? new CardIdNeuralNet(snap, 'medium')
        : nnDifficulty === 'ascent' ? new AscentNet(snap)
          : new TabulaNet(snap)
  );
  const snapCardNet = (ref) => ref?.current?.bestValSnapshot || ref?.current?.championSnapshot || ref?.current?.serialize?.();
  const makeCardNet = (brain) => {
    if (brain === 'nn_tabula' || brain === 'nn_hard' || brain === 'nn') {
      return new TabulaNet(snapCardNet(nnTabulaRef));
    }
    if (brain === 'nn_medium') {
      return new CardIdNeuralNet(snapCardNet(nnMediumRef), 'medium');
    }
    return null;
  };
  const makeAscentNet = () => {
    try {
      return new AscentNet(nnAscentRef.current?.serialize?.() || null);
    } catch (_) {
      return null;
    }
  };
  const isAscentBrain = (brain) => brain === 'nn_ascent';
  const selectCardLiveAscent = (net, state, pId, candidates, phaseTag = 'trick') => {
    if (!net || !candidates?.length) return candidates?.[0] || null;
    const phase = phaseTag === 'pouch' ? 'POUCH_ADD' : phaseTag === 'draft' ? 'DRAFT' : 'TRICK';
    const mode = phaseTag === 'draft' ? ASCENT_MODE.DRAFT : phaseTag === 'pouch' ? ASCENT_MODE.TUCK : ASCENT_MODE.PLAY_TRICK;
    const st = { ...state, phase, toMove: pId, handLimitMode };
    const legal = candidates.map(c => ({ mode, cardId: ascentCardId(c), cardUid: c.uid }));
    const { bestIdx } = ascentChoose(net, st, pId, legal, 0, ascentLookaheadDepth);
    return candidates[bestIdx] || candidates[0];
  };
  const queryAscentYesNo = (net, state, pId, yesMode) => {
    if (!net) return false;
    const p = state.players?.[pId];
    const st = { ...state, phase: 'TRICK', toMove: pId, handLimitMode };
    const legal = [
      { mode: ASCENT_MODE.PASS },
      { mode: yesMode, abilitySlot: seqAbilitySlot(p?.seq) }
    ];
    return ascentChoose(net, st, pId, legal, 0, ascentLookaheadDepth).bestIdx === 1;
  };"""

new = """  // Tiers: small | medium — Python PPO exports (compact_ascent_v1)
  const [nnDifficulty, setNnDifficulty] = useState('small');
  const nnSmallRef = useRef(null);
  const nnMediumRef = useRef(null);
  if (!nnSmallRef.current) {
    let saved = null;
    try { const raw = localStorage.getItem('lotm_nn_small_v1'); if (raw) saved = JSON.parse(raw); } catch (_) {}
    nnSmallRef.current = makePolicyNet('small', saved);
  }
  if (!nnMediumRef.current) {
    let saved = null;
    try { const raw = localStorage.getItem('lotm_nn_medium_v1'); if (raw) saved = JSON.parse(raw); } catch (_) {}
    nnMediumRef.current = makePolicyNet('medium', saved);
  }
  const nnEasyRef = nnSmallRef;
  const getActiveNN = () => (nnDifficulty === 'medium' ? nnMediumRef.current : nnSmallRef.current);
  const getActiveStorageKey = () => (nnDifficulty === 'medium' ? 'lotm_nn_medium_v1' : 'lotm_nn_small_v1');
  const selectCardLivePolicy = (net, state, pId, candidates, phaseTag = 'trick') => {
    if (!net || !isPolicyNet(net) || !candidates?.length) return candidates?.[0] || null;
    const tier = net.tier === 'medium' ? 'medium' : 'small';
    const ctx = phaseTag === 'draft' ? 'draft' : phaseTag === 'pouch' ? 'pouch' : 'trick';
    const pick = policyPick(net, state, pId, ctx, { candidates }, tier);
    if (pick?.card) {
      const match = candidates.find(c => c === pick.card || c?.uid === pick.card?.uid);
      if (match) return match;
    }
    return candidates[0];
  };
  const queryPolicyYesNo = (net, state, pId, context = 'meta_yesno') => {
    if (!net || !isPolicyNet(net)) return false;
    const tier = net.tier === 'medium' ? 'medium' : 'small';
    const pick = policyPick(net, state, pId, context === 'ascend' ? 'ascend' : 'meta_yesno', {}, tier);
    return pick?.type === 'yes' || pick?.type === 'ascend';
  };
  const makeAscentNet = () => getActiveNN();
  const isAscentBrain = (brain) => brain === 'nn_small' || brain === 'nn_medium' || brain === 'nn_easy' || brain === 'nn_ascent';
  const selectCardLiveAscent = selectCardLivePolicy;
  const queryAscentYesNo = (net, state, pId) => queryPolicyYesNo(net, state, pId, 'meta_yesno');
  const makeCardNet = (brain) => {
    if (brain === 'nn_medium') return makePolicyNet('medium', nnMediumRef.current?.serialize?.());
    if (brain === 'nn_small' || brain === 'nn_easy' || brain === 'nn' || brain === 'nn_tabula' || brain === 'nn_hard') {
      return makePolicyNet('small', nnSmallRef.current?.serialize?.());
    }
    return null;
  };
  const snapCardNet = (ref) => ref?.current?.serialize?.();"""

if old not in text:
    raise SystemExit("OLD BLOCK NOT FOUND")
text = text.replace(old, new, 1)

# sim default brains
text = text.replace(
    "useState(['nn_tabula', 'heuristic_6', 'heuristic_6', 'heuristic_6'])",
    "useState(['nn_small', 'heuristic_6', 'heuristic_6', 'heuristic_6'])",
)

# Replace runOnlineLearn body start marker through handleLoadWeights with eval-only + load/save/reset
# Find runOnlineLearn and replace until randomizeValSeed
start = text.find("  const runOnlineLearn = (totalGames) => {")
end = text.find("  const randomizeValSeed = () => {")
if start < 0 or end < 0:
    raise SystemExit(f"markers missing start={start} end={end}")

replacement = r'''  const runOnlineLearn = (totalGames) => {
    if (trainRunning) return;
    const count = Math.max(1, Math.min(100000, Number(totalGames) || 200));
    setTrainRunning(true);
    stopTrainRef.current = false;
    const tier = nnDifficulty === 'medium' ? 'medium' : 'small';
    const nn = getActiveNN();
    const depth = Math.max(1, Math.min(6, Number(trainDepth) || 3));
    const brain = tier === 'medium' ? 'nn_medium' : 'nn_small';
    let done = 0, wins = 0, losses = 0, draws = 0;
    let roundSum = 0;
    setTrainProgress({ done: 0, total: count, promotions: 0, lastValRate: null, avgRounds: null });

    const step = () => {
      if (stopTrainRef.current || done >= count) {
        const played = Math.max(1, wins + losses + draws);
        const wr = Math.round(100 * wins / played);
        nn.championWinRate = wins / played;
        try { localStorage.setItem(getActiveStorageKey(), JSON.stringify(nn.serialize())); } catch (_) {}
        setNnBanner({
          tone: 'emerald',
          text: `Eval ${done}g · ${wr}% vs D${depth} (W${wins}/L${losses}/D${draws}) · train via python_train/ppo_train.py --tier ${tier}`
        });
        setTrainRunning(false);
        return;
      }
      const chunk = Math.min(8, count - done);
      for (let i = 0; i < chunk; i++) {
        const res = runHeadlessGame({
          playerCount: 2,
          handLimitMode,
          seatConfigs: [{ type: brain, depth: 5 }, { type: 'heuristic', depth }],
          nn,
          nnSmall: nnSmallRef.current,
          nnMedium: nnMediumRef.current,
          nnEasy: nnSmallRef.current,
          training: false,
          maxRounds: Math.max(20, Math.min(75, Number(roundLimit) || 50)),
          seed: Math.floor(Math.random() * 1e9)
        });
        done++;
        roundSum += res.rounds || 0;
        if (res.isDraw) draws++;
        else if (res.winnerId === 0) wins++;
        else losses++;
      }
      const played = Math.max(1, wins + losses + draws);
      const wr = Math.round(100 * wins / played);
      const avgR = Math.round(10 * roundSum / done) / 10;
      setTrainProgress({ done, total: count, promotions: 0, lastValRate: wr, avgRounds: avgR });
      if (done % 25 === 0 || done >= count) {
        setTrainLog(prev => [...prev, {
          ep: done,
          gamesTrained: nn.gamesTrained || 0,
          ascentScore: Math.round(100 * (wins / played) * 100) / 100,
          avgRounds: avgR,
          valWinRate: wr,
          isVal: true,
          action: `eval vs D${depth}`
        }].slice(-5000));
      }
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  };

  const handleLoadWeights = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.target?.result || '{}'));
        if (parsed.format !== 'compact_ascent_v1' && !parsed.weights) {
          setNnBanner({ tone: 'danger', text: 'Need compact_ascent_v1 JSON from python_train/ppo_train.py' });
          return;
        }
        const tier = parsed.tier === 'medium' || (parsed.obsDim || 0) > 300 ? 'medium' : 'small';
        const net = makePolicyNet(tier, parsed);
        if (tier === 'medium') nnMediumRef.current = net;
        else nnSmallRef.current = net;
        setNnDifficulty(tier);
        try { localStorage.setItem(tier === 'medium' ? 'lotm_nn_medium_v1' : 'lotm_nn_small_v1', JSON.stringify(net.serialize())); } catch (_) {}
        setNnBanner({ tone: 'emerald', text: `Loaded ${tier} PolicyNet (${net.gamesTrained || 0} games, ${net.obsDim}×${net.actDim})` });
        setTrainLog([]);
      } catch (_) {
        setNnBanner({ tone: 'danger', text: 'Could not parse JSON weights file.' });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

'''

# Keep handleSaveWeights above runOnlineLearn — only replace runOnlineLearn..before randomizeValSeed
# But handleLoadWeights is between them — include it in replacement.
# Remove old handleLoadWeights / reset that sit before randomizeValSeed — wait, order is:
# handleSaveWeights, runOnlineLearn, handleLoadWeights, randomizeValSeed, resetNNWeights
# So start at runOnlineLearn, end at randomizeValSeed, and we'll rewrite handleLoadWeights inside replacement.
# Also need to replace resetNNWeights separately.

text = text[:start] + replacement + text[end:]

# resetNNWeights
old_reset = """  const resetNNWeights = () => {
    // True scratch — do NOT reload shipped champion seeds
    if (nnDifficulty === 'easy') nnEasyRef.current = new LotmNeuralNet(null);
    else if (nnDifficulty === 'medium') nnMediumRef.current = new CardIdNeuralNet(null, 'medium');
    else if (nnDifficulty === 'ascent') {
      nnAscentRef.current = new AscentNet(null);
      nnAscentRef.current.ascentSparDepth = 2;
    }
    else nnTabulaRef.current = new TabulaNet(null);
    try {
      localStorage.removeItem(getActiveStorageKey());
      if (nnDifficulty === 'medium') {
        localStorage.removeItem('lotm_nn_medium_v2');
        localStorage.removeItem('lotm_nn_hard_v2');
      }
      if (nnDifficulty === 'easy') localStorage.removeItem('lotm_nn_champion_v1');
    } catch (_) {}
    setTrainLog([]);
    const active = getActiveNN();
    setTrainProgress({
      done: 0, total: 0, promotions: 0,
      lastValRate: Math.round(((active.ascentScore ?? active.championWinRate) || 0) * 100) || null
    });
    setNnBanner({
      tone: 'emerald',
      text: nnDifficulty === 'ascent'
        ? 'AscentNet wiped — graph cleared · training from scratch.'
        : `${nnDifficulty} wiped to random weights (not champion seed) · graph cleared.`
    });
  };"""

new_reset = """  const resetNNWeights = () => {
    const tier = nnDifficulty === 'medium' ? 'medium' : 'small';
    if (tier === 'medium') nnMediumRef.current = makePolicyNet('medium');
    else nnSmallRef.current = makePolicyNet('small');
    try { localStorage.removeItem(getActiveStorageKey()); } catch (_) {}
    setTrainLog([]);
    setTrainProgress({ done: 0, total: 0, promotions: 0, lastValRate: null });
    setNnBanner({ tone: 'emerald', text: `${tier} PolicyNet wiped to random weights · graph cleared.` });
  };"""

if old_reset not in text:
    raise SystemExit("reset block not found")
text = text.replace(old_reset, new_reset, 1)

path.write_text(text, encoding="utf-8")
print("patched App.jsx successfully")
