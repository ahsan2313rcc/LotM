import fs from 'fs';

const path = 'src/App.jsx';
let app = fs.readFileSync(path, 'utf8');

const replacements = [
  // Lovers
  [
    `        const tmp = actor.hand[aIdx];
        actor.hand[aIdx] = target.hand[tIdx];
        target.hand[tIdx] = tmp;
        s.logs = addLog(s.logs, \`\${actor.name} and \${target.name} exchanged 1 random Hand card.\`, 'chaos', \`\${pCode(actor.id)}↔\${pCode(target.id)} H\`, { appendEffect: true });`,
    `        const aC = actor.hand[aIdx];
        const tC = target.hand[tIdx];
        actor.hand[aIdx] = tC;
        target.hand[tIdx] = aC;
        s.logs = addLog(s.logs, \`\${actor.name} and \${target.name} exchanged 1 random Hand card.\`, 'chaos', \`\${pCode(actor.id)}↔\${pCode(target.id)} H(\${cardCode(aC)}↔\${cardCode(tC)})\`, { appendEffect: true });`
  ],
  // Wheel
  [
    `      const passed = s.players.map(p => (p.hand.length > 0 ? p.hand.pop() : null));
      s.players.forEach((p, idx) => {
        const fromIdx = (idx - 1 + s.players.length) % s.players.length;
        if (passed[fromIdx]) p.hand.push(passed[fromIdx]);
        const r = drawCardsFromDeck(s, 1);
        s.deck = r.deck; s.grave = r.grave;
        p.hand.push(...r.drawn);
      });
      s.logs = addLog(s.logs, \`Wheel of Fortune rotated 1 Hand card left and drew 1 for everyone!\`, 'chaos', 'rotL, all +1', { appendEffect: true });`,
    `      const passed = s.players.map(p => (p.hand.length > 0 ? p.hand.pop() : null));
      const wheelParts = [];
      s.players.forEach((p, idx) => {
        const fromIdx = (idx - 1 + s.players.length) % s.players.length;
        const got = passed[fromIdx];
        if (got) {
          p.hand.push(got);
          wheelParts.push(\`\${pCode(p.id)}: +\${cardCode(got)}s\`);
        }
        const r = drawCardsFromDeck(s, 1);
        s.deck = r.deck; s.grave = r.grave;
        p.hand.push(...r.drawn);
        if (r.drawn.length > 0) wheelParts.push(\`\${pCode(p.id)}: \${r.drawn.map(c => '+' + cardCode(c)).join(',')}\`);
      });
      s.logs = addLog(s.logs, \`Wheel of Fortune rotated 1 Hand card left and drew 1 for everyone!\`, 'chaos', wheelParts.join(', ') || 'rotL', { appendEffect: true });`
  ],
  // Justice
  [
    `      if (rich.id !== poor.id && rich.hand.length > 0) {
        poor.hand.push(rich.hand.pop());
        s.logs = addLog(s.logs, \`Justice balanced hands: \${rich.name} gave 1 card to \${poor.name}.\`, 'chaos', \`\${pCode(rich.id)}>\${pCode(poor.id)}\`, { appendEffect: true });
      }`,
    `      if (rich.id !== poor.id && rich.hand.length > 0) {
        const given = rich.hand.pop();
        poor.hand.push(given);
        s.logs = addLog(s.logs, \`Justice balanced hands: \${rich.name} gave 1 card to \${poor.name}.\`, 'chaos', \`\${pCode(rich.id)}>\${pCode(poor.id)}(\${cardCode(given)})\`, { appendEffect: true });
      }`
  ],
  // Death
  [
    `    } else if (id === 13) { // Death: destroy 1 from every Pouch
      for (const p of s.players) {
        if (p.pouch.length > 0 && !p.mods.pouchImmune) {
          const idx = Math.floor(Math.random() * p.pouch.length);
          const rem = p.pouch.splice(idx, 1)[0];
          s.grave.unshift(rem);
          p.pouchLostThisRound = true;
        }
      }
      s.logs = addLog(s.logs, \`Death destroyed 1 face-down card from every unprotected Pouch!\`, 'danger', 'all -/P', { appendEffect: true });`,
    `    } else if (id === 13) { // Death: destroy 1 from every Pouch
      const deathParts = [];
      for (const p of s.players) {
        if (p.pouch.length > 0 && !p.mods.pouchImmune) {
          const idx = Math.floor(Math.random() * p.pouch.length);
          const rem = p.pouch.splice(idx, 1)[0];
          s.grave.unshift(rem);
          p.pouchLostThisRound = true;
          deathParts.push(\`\${pCode(p.id)}: -/\${cardCode(rem)}\`);
        }
      }
      s.logs = addLog(s.logs, \`Death destroyed 1 face-down card from every unprotected Pouch!\`, 'danger', deathParts.join(', ') || 'all -/P', { appendEffect: true });`
  ],
  // Devil AI discards + log
  [
    `          } else {
            const dIdx = pickDiscardCardIdx(o.hand, o.seq);
            s.grave.unshift(o.hand.splice(dIdx, 1)[0]);
            o.lostCardThisRound = true;
          }
        } else if (o.pouch.length > 0 && !o.mods.pouchImmune) {
          s.grave.unshift(o.pouch.pop());
          o.pouchLostThisRound = true;
        }
      }
      s.logs = addLog(s.logs, \`The Devil forced every opponent to sacrifice a card!\`, 'danger');`,
    `          } else {
            const dIdx = pickDiscardCardIdx(o.hand, o.seq);
            const dc = o.hand.splice(dIdx, 1)[0];
            s.grave.unshift(dc);
            o.lostCardThisRound = true;
            devilParts.push(\`\${pCode(o.id)}: -\${cardCode(dc)}\`);
          }
        } else if (o.pouch.length > 0 && !o.mods.pouchImmune) {
          const rem = o.pouch.pop();
          s.grave.unshift(rem);
          o.pouchLostThisRound = true;
          devilParts.push(\`\${pCode(o.id)}: -/\${cardCode(rem)}\`);
        }
      }
      s.logs = addLog(s.logs, \`The Devil forced every opponent to sacrifice a card!\`, 'danger', devilParts.join(', ') || null, { appendEffect: true });`
  ],
];

// Insert devilParts declaration
if (!app.includes('const devilParts = [];')) {
  app = app.replace(
    `    } else if (id === 15) { // Devil: every opp discards 1 or loses 1 Pouch
      for (const o of others) {`,
    `    } else if (id === 15) { // Devil: every opp discards 1 or loses 1 Pouch
      const devilParts = [];
      for (const o of others) {`
  );
}

// Moon
replacements.push([
  `      const mixed = shuffle(pool);
      s.players.forEach((p, idx) => {
        if (counts[idx] > 0) p.pouch = mixed.splice(0, counts[idx]);
      });
      s.logs = addLog(s.logs, \`The Moon scrambled every unprotected Pouch across the table!\`, 'chaos', '/~', { appendEffect: true });`,
  `      const mixed = shuffle(pool);
      const moonParts = [];
      s.players.forEach((p, idx) => {
        if (counts[idx] > 0) {
          p.pouch = mixed.splice(0, counts[idx]);
          moonParts.push(\`\${pCode(p.id)}: /~(\${p.pouch.map(cardCode).join(',')})\`);
        }
      });
      s.logs = addLog(s.logs, \`The Moon scrambled every unprotected Pouch across the table!\`, 'chaos', moonParts.join(', ') || '/~', { appendEffect: true });`
]);

// Sun
replacements.push([
  `      actor.hand.push(...r.drawn);
      if (actor.pouch.length < 3 && actor.hand.length > 0) {
        actor.pouch.push(actor.hand.pop());
      }
      s.logs = addLog(s.logs, \`The Sun blessed \${actor.name} with +1 Draw and an extra Pouch tuck!\`, 'chaos', \`\${r.drawn.map(c => '+' + cardCode(c)).join(',')}, +/P\`, { appendEffect: true });
    } else if (id === 20) { // Judgement: every opp returns 1 Pouch card to Hand
      for (const o of others) {
        if (o.pouch.length > 0 && !o.mods.pouchImmune) o.hand.push(o.pouch.pop());
      }
      s.logs = addLog(s.logs, \`Judgement returned 1 Pouch card to every opponent's Hand!\`, 'chaos', 'opps -/P>+H', { appendEffect: true });`,
  `      actor.hand.push(...r.drawn);
      const sunParts = r.drawn.map(c => '+' + cardCode(c));
      if (actor.pouch.length < 3 && actor.hand.length > 0) {
        const tucked = actor.hand.pop();
        actor.pouch.push(tucked);
        sunParts.push('+/' + cardCode(tucked));
      }
      s.logs = addLog(s.logs, \`The Sun blessed \${actor.name} with +1 Draw and an extra Pouch tuck!\`, 'chaos', sunParts.join(', '), { appendEffect: true });
    } else if (id === 20) { // Judgement: every opp returns 1 Pouch card to Hand
      const judgeParts = [];
      for (const o of others) {
        if (o.pouch.length > 0 && !o.mods.pouchImmune) {
          const rem = o.pouch.pop();
          o.hand.push(rem);
          judgeParts.push(\`\${pCode(o.id)}: -/\${cardCode(rem)}>+\${cardCode(rem)}\`);
        }
      }
      s.logs = addLog(s.logs, \`Judgement returned 1 Pouch card to every opponent's Hand!\`, 'chaos', judgeParts.join(', ') || 'opps -/P>+H', { appendEffect: true });`
]);

// Star always logs draw + optional reveal
replacements.push([
  `    } else if (id === 17) { // Star: inspect opp Pouch + draw 1
      const r = drawCardsFromDeck(s, 1);
      s.deck = r.deck; s.grave = r.grave;
      actor.hand.push(...r.drawn);
      if (actor.isHuman && target && target.pouch.length > 0) {
        s.logs = addLog(s.logs, \`The Star revealed \${target.name}'s Pouch: \${target.pouch.map(cardShortName).join(', ')}\`, 'gold', \`\${pCode(target.id)}: /V(\${target.pouch.map(cardCode).join(',')})\`, { appendEffect: true });
      }`,
  `    } else if (id === 17) { // Star: inspect opp Pouch + draw 1
      const r = drawCardsFromDeck(s, 1);
      s.deck = r.deck; s.grave = r.grave;
      actor.hand.push(...r.drawn);
      const starParts = r.drawn.map(c => '+' + cardCode(c));
      if (target && target.pouch.length > 0) starParts.push(\`\${pCode(target.id)}: /V(\${target.pouch.map(cardCode).join(',')})\`);
      s.logs = addLog(s.logs, \`The Star drew \${r.drawn.map(cardShortName).join(', ') || 'nothing'}\${target && target.pouch.length ? ' and revealed ' + target.name + \"'s Pouch\" : ''}.\`, 'gold', starParts.join(', '), { appendEffect: true });`
]);

let ok = 0;
for (const [from, to] of replacements) {
  if (!app.includes(from)) {
    console.error('MISSING BLOCK:\n', from.slice(0, 120).replace(/\n/g, ' | '));
    continue;
  }
  app = app.replace(from, to);
  ok++;
}
fs.writeFileSync(path, app);
console.log('patched', ok, '/', replacements.length);
