import fs from 'fs';

const src = fs.readFileSync('src/components/PlayingScreen.jsx', 'utf8');
const propsMatch = src.match(/const \{\n([\s\S]*?)\n  \} = props;/);
const props = new Set((propsMatch?.[1] || '').split(',').map(s => s.trim()).filter(Boolean));

const imports = [...src.matchAll(/import\s+\{([^}]+)\}/g)].flatMap(m =>
  m[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop().trim()).filter(Boolean)
);
const importNames = new Set(imports);

// Local consts/functions inside component after destructuring
const localDefs = [...src.matchAll(/\b(?:const|let|function)\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map(m => m[1]);
const locals = new Set(localDefs);

const keywords = new Set([
  'props', 'return', 'true', 'false', 'null', 'undefined', 'const', 'let', 'var', 'function',
  'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'new', 'typeof',
  'instanceof', 'in', 'of', 'class', 'extends', 'import', 'export', 'from', 'default',
  'try', 'catch', 'finally', 'throw', 'async', 'await', 'this', 'super', 'yield',
  'Map', 'Set', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Math', 'JSON', 'Date',
  'Error', 'Promise', 'Symbol', 'RegExp', 'Intl', 'console', 'window', 'document',
  'localStorage', 'navigator', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'encodeURIComponent', 'decodeURIComponent', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
  'div', 'span', 'button', 'input', 'select', 'option', 'textarea', 'label', 'h1', 'h2', 'h3',
  'p', 'ul', 'ol', 'li', 'img', 'svg', 'path', 'circle', 'line', 'polyline', 'text', 'g',
  'key', 'type', 'value', 'onClick', 'onChange', 'className', 'style', 'disabled', 'title',
  'placeholder', 'rows', 'min', 'max', 'step', 'checked', 'htmlFor', 'role', 'aria',
  'map', 'filter', 'find', 'some', 'every', 'reduce', 'includes', 'slice', 'splice',
  'push', 'pop', 'shift', 'unshift', 'concat', 'join', 'split', 'trim', 'length', 'sort',
  'reverse', 'indexOf', 'findIndex', 'forEach', 'flatMap', 'entries', 'keys', 'values',
  'toFixed', 'toString', 'padStart', 'startsWith', 'endsWith', 'replace', 'match',
  'React', 'Fragment'
]);

const ids = [...src.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)].map(m => m[1]);
const freq = {};
for (const id of ids) freq[id] = (freq[id] || 0) + 1;

const free = [...new Set(ids)].filter(id =>
  !keywords.has(id) &&
  !props.has(id) &&
  !importNames.has(id) &&
  !locals.has(id) &&
  id[0] !== id[0].toUpperCase() // skip components/PascalCase roughly — wait we need some UPPER
).filter(id => !/^[A-Z][A-Z0-9_]+$/.test(id)); // keep SCREAMING for check separately

const screaming = [...new Set(ids)].filter(id =>
  /^[A-Z][A-Z0-9_]+$/.test(id) && !importNames.has(id) && !props.has(id) && !locals.has(id) && !keywords.has(id)
);

const pascal = [...new Set(ids)].filter(id =>
  /^[A-Z][a-zA-Z0-9]+$/.test(id) && !importNames.has(id) && !props.has(id) && !locals.has(id) && !keywords.has(id)
);

console.log('--- likely free camelCase ---');
console.log(free.sort().join('\n'));
console.log('\n--- SCREAMING ---');
console.log(screaming.sort().join('\n'));
console.log('\n--- Pascal ---');
console.log(pascal.sort().join('\n'));
