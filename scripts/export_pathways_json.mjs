import { writeFileSync } from 'fs';
import { PATHWAYS } from '../src/data/constants.js';

const out = PATHWAYS.map(p => ({
  id: p.id,
  roman: ['0','I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX','XXI'][p.id],
  arcana: p.arcana,
  lotm: p.lotm,
  lever: p.lever,
  playstyle: p.playstyle,
  chaosTiming: p.chaosTiming,
  chaosDesc: p.chaosDesc,
  sequences: [9, 8, 7, 6, 5, 4, 3, 2, 1].map(seq => {
    const s = p.seqs[seq];
    return {
      sequence: seq,
      name: s?.name || '',
      ability: s?.ability || '',
      actingRequirement: s?.acting || '',
      tag: s?.tag || ''
    };
  })
}));

writeFileSync(new URL('../data/pathways_export.json', import.meta.url), JSON.stringify(out, null, 2), 'utf8');
console.log('wrote', out.length, 'pathways');
