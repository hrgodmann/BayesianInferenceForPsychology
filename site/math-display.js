import katex from './vendor/katex/katex.mjs';
import { formatAnswer } from './engine.js';

// Presentation only: generated answers and grading precision remain untouched.
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escapeTeX = value => String(value).replace(/[\\{}$&#%_^~]/g, c => ({ '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&', '#': '\\#', '%': '\\%', '_': '\\_', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}' }[c]));
const words = value => `\\text{${escapeTeX(value)}}`;
const functions = new Set(['P', 'E', 'B', 'C', 'Beta', 'BF']);
const symbols = /^(?:[a-zA-Zθ](?:′|\d+)?|BF_[A-Z]+|H_[A-Z]+)$/;

function tokenize(raw) {
  const tokens = [];
  let input = String(raw).trim();
  while (input) {
    const space = input.match(/^\s+/);
    if (space) { input = input.slice(space[0].length); continue; }
    const number = input.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (number) { tokens.push({ type: 'number', value: number[0] }); input = input.slice(number[0].length); continue; }
    const operator = input.match(/^[+−\-×*/^=≈~≥≤∩∪|,:!()\[\]Σ]/);
    if (operator) { tokens.push({ type: operator[0] === '-' ? '−' : operator[0], value: operator[0] }); input = input.slice(1); continue; }
    const identifier = input.match(/^(?:BF_[A-Z]+|H_[A-Z]+|[A-Za-zθ][A-Za-z0-9θ_′’]*)/);
    if (!identifier) throw new SyntaxError(`Unsupported mathematical token: ${input.slice(0, 30)}`);
    const value = identifier[0];
    tokens.push({ type: 'identifier', value }); input = input.slice(value.length);
  }
  tokens.push({ type: 'end', value: '' });
  return tokens;
}

function parse(raw) {
  const tokens = tokenize(raw);
  let index = 0;
  const peek = () => tokens[index];
  const take = type => {
    if (peek().type !== type) throw new SyntaxError(`Expected ${type}, found ${peek().type}`);
    return tokens[index++];
  };
  const node = (kind, args) => ({ kind, ...args });
  const binary = (op, left, right) => node('binary', { op, left, right });
  function relation() {
    let left = sum();
    while (['=', '≈', '~', '≥', '≤', '|', ',', ':', '∩', '∪'].includes(peek().type)) {
      const op = tokens[index++].type;
      left = binary(op, left, sum());
    }
    return left;
  }
  function sum() {
    let left = product();
    while (['+', '−'].includes(peek().type)) {
      const op = tokens[index++].type;
      left = binary(op, left, product());
    }
    return left;
  }
  const startsAtom = type => ['number', 'identifier', '(', '[', 'Σ'].includes(type);
  function product() {
    let left = unary();
    while (['×', '*', '/'].includes(peek().type) || startsAtom(peek().type)) {
      const implicit = startsAtom(peek().type);
      const op = implicit ? 'implicit' : tokens[index++].type;
      left = binary(op, left, unary());
    }
    return left;
  }
  function unary() {
    if (peek().type === '−' || peek().type === '+') return node('unary', { op: tokens[index++].type, child: unary() });
    if (peek().type === 'Σ') { index++; return node('sum', { child: product() }); }
    return power();
  }
  function power() {
    let left = atom();
    while (peek().type === '!') { index++; left = node('factorial', { child: left }); }
    if (peek().type === '^') { index++; left = binary('^', left, unary()); }
    return left;
  }
  function atom() {
    const token = tokens[index++];
    if (token.type === 'number') return node('number', { value: token.value });
    if (token.type === '(' || token.type === '[') {
      const child = relation(); take(token.type === '(' ? ')' : ']');
      return node('group', { child, bracket: token.type });
    }
    if (token.type === 'identifier') {
      if (functions.has(token.value) && peek().type === '(') {
        index++; const child = relation(); take(')');
        return node('function', { name: token.value, child });
      }
      // Labels are explicit text; isolated mathematical symbols remain italic.
      // A multiword event such as "next success" is never interpreted as a product.
      let value = token.value;
      if (!symbols.test(value) && !functions.has(value)) {
        while (peek().type === 'identifier' && !(functions.has(peek().value) && tokens[index + 1].type === '(')) value += ` ${tokens[index++].value}`;
      }
      return node('identifier', { value });
    }
    throw new SyntaxError(`Unexpected ${token.type} in expression`);
  }
  const result = relation();
  take('end');
  return result;
}

const ungroup = node => node.kind === 'group' ? ungroup(node.child) : node;
function texIdentifier(value) {
  if (/^BF_/.test(value)) return `\\mathrm{BF}_{${value.slice(3)}}`;
  if (/^H_/.test(value)) return `H_{${value.slice(2)}}`;
  if (/^[A-Za-z]\d+$/.test(value)) return `${value[0]}_{${value.slice(1)}}`;
  if (/^[a-zA-Zθ]′?$/.test(value)) return value.replace('θ', '\\theta').replace('′', "'");
  return words(value);
}
const scientificAtom = node => node.kind === 'number' && /e/i.test(node.value);
const atomicTeX = node => scientificAtom(node) ? `\\left(${tex(node)}\\right)` : tex(node);
function tex(node) {
  if (node.kind === 'number') {
    const [mantissa, exponent] = node.value.toLowerCase().split('e');
    return exponent === undefined ? mantissa : `${mantissa} \\times 10^{${Number(exponent)}}`;
  }
  if (node.kind === 'identifier') return texIdentifier(node.value);
  if (node.kind === 'group') return node.bracket === '[' ? `\\left[${tex(node.child)}\\right]` : `\\left(${tex(node.child)}\\right)`;
  if (node.kind === 'unary') return `${node.op === '−' ? '-' : '+'}${tex(node.child)}`;
  if (node.kind === 'factorial') return `${atomicTeX(node.child)}!`;
  if (node.kind === 'sum') return `\\sum ${tex(node.child)}`;
  if (node.kind === 'function') {
    if (node.name === 'C') {
      if (node.child.kind !== 'binary' || node.child.op !== ',') throw new SyntaxError('A binomial coefficient needs two arguments.');
      return `\\binom{${tex(node.child.left)}}{${tex(node.child.right)}}`;
    }
    return `\\mathrm{${node.name}}\\left(${tex(node.child)}\\right)`;
  }
  if (node.op === '/') return `\\frac{${tex(ungroup(node.left))}}{${tex(ungroup(node.right))}}`;
  if (node.op === '^') return `${atomicTeX(node.left)}^{${tex(ungroup(node.right))}}`;
  const op = { '×': '\\times', '*': '\\times', implicit: '\\,', '−': '-', '≈': '\\approx', '~': '\\sim', '≥': '\\ge', '≤': '\\le', '|': '\\mid', '∩': '\\cap', '∪': '\\cup' }[node.op] || node.op;
  return `${tex(node.left)} ${op} ${tex(node.right)}`;
}

// This one formula is piecewise, not an arithmetic expression.
const lawFormula = 'P(D | H_L) = 1 for all successes; 0 if any failure occurs';
export function toTeX(raw) {
  if (raw === lawFormula) return '\\mathrm{P}(D\\mid H_L)=\\begin{cases}1 & \\text{all successes}\\\\0 & \\text{at least one failure}\\end{cases}';
  return tex(parse(raw));
}

function katexHTML(source, block = false) {
  // Keep inline layout/break opportunities, but use full-size fraction glyphs
  // in worked solutions so numerators remain readable on narrow screens.
  return katex.renderToString(block ? `\\displaystyle ${source}` : source, { displayMode: false, output: 'htmlAndMathml', throwOnError: true, strict: 'error', trust: false, maxExpand: 1000 });
}
const fallback = raw => `<span class="math-fallback">${escapeHTML(raw)}</span>`;
export function renderFormula(raw) {
  try {
    // A few guided steps give an instruction rather than a mathematical formula.
    // Keep that prose normally wrapping instead of placing it in a no-wrap text atom.
    const expression = raw === lawFormula ? null : parse(raw);
    if (expression?.kind === 'identifier' && !symbols.test(expression.value)) {
      return `<div class="math-block math-prose" data-math-source="${escapeHTML(raw)}">${escapeHTML(raw)}</div>`;
    }
    return `<div class="math-block" data-math-source="${escapeHTML(raw)}">${katexHTML(toTeX(raw), true)}</div>`;
  }
  catch { return `<div class="math-block">${fallback(raw)}</div>`; }
}

// Exact decimal rational arithmetic only determines whether a displayed equality
// is exact. It never supplies an answer to the question engine or grader.
const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a || 1n; };
const rational = (n, d = 1n) => {
  if (!d) return null;
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d); return { n: n / g, d: d / g };
};
const factorial = n => { let out = 1n; for (let i = 2n; i <= n; i++) out *= i; return out; };
function evaluate(node) {
  if (node.kind === 'group') return evaluate(node.child);
  if (node.kind === 'number') {
    const [mantissa, exponent = '0'] = node.value.toLowerCase().split('e');
    const scale = (mantissa.split('.')[1]?.length || 0) - Number(exponent);
    const n = BigInt(mantissa.replace('.', ''));
    return scale >= 0 ? rational(n, 10n ** BigInt(scale)) : rational(n * 10n ** BigInt(-scale));
  }
  if (node.kind === 'unary') { const x = evaluate(node.child); return x ? rational(node.op === '−' ? -x.n : x.n, x.d) : null; }
  if (node.kind === 'factorial') { const x = evaluate(node.child); return x?.d === 1n && x.n >= 0n && x.n <= 100n ? rational(factorial(x.n)) : null; }
  if (node.kind === 'function') {
    if (!['B', 'C'].includes(node.name) || node.child.kind !== 'binary' || node.child.op !== ',') return null;
    const a = evaluate(node.child.left), b = evaluate(node.child.right);
    if (a?.d !== 1n || b?.d !== 1n || a.n < 0n || b.n < 0n || a.n > 100n || b.n > 100n) return null;
    if (node.name === 'C') return b.n <= a.n ? rational(factorial(a.n), factorial(b.n) * factorial(a.n - b.n)) : null;
    return a.n > 0n && b.n > 0n ? rational(factorial(a.n - 1n) * factorial(b.n - 1n), factorial(a.n + b.n - 1n)) : null;
  }
  if (node.kind !== 'binary') return null;
  const a = evaluate(node.left), b = evaluate(node.right);
  if (!a || !b) return null;
  if (node.op === '+') return rational(a.n * b.d + b.n * a.d, a.d * b.d);
  if (node.op === '−') return rational(a.n * b.d - b.n * a.d, a.d * b.d);
  if (['×', '*', 'implicit'].includes(node.op)) return rational(a.n * b.n, a.d * b.d);
  if (node.op === '/') return rational(a.n * b.d, a.d * b.n);
  if (node.op === '^' && b.d === 1n && b.n >= 0n && b.n <= 100n) return rational(a.n ** b.n, a.d ** b.n);
  return null;
}
function equalityParts(node) {
  if (node.kind === 'binary' && ['=', '≈'].includes(node.op)) return [...equalityParts(node.left), { node: node.right, relation: node.op }];
  return [{ node, relation: null }];
}
function workingParts(raw, item) {
  const parts = equalityParts(parse(raw));
  const firstValue = evaluate(parts[0].node);
  const displayedValue = firstValue ? Number(firstValue.n) / Number(firstValue.d) : undefined;
  // A substituted operand may itself be rounded (e.g. a posterior weight).
  // Mark the chain approximate when those displayed inputs no longer yield
  // the stored full-precision answer; ordinary floating-point noise is ignored.
  let approximate = Number.isFinite(item?.answer) && Number.isFinite(displayedValue)
    && Math.abs(displayedValue - item.answer) > 32 * Number.EPSILON * Math.max(Number.MIN_VALUE, Math.abs(item.answer), Math.abs(displayedValue));
  return parts.map((part, index) => {
    if (!index) return { ...part, source: tex(part.node) };
    const before = evaluate(parts[index - 1].node), after = evaluate(part.node);
    if (part.relation === '≈' || before && after && before.n * after.d !== after.n * before.d) approximate = true;
    const relation = approximate ? '\\approx' : '=';
    return { ...part, source: `${relation} ${tex(part.node)}` };
  });
}
export function workingToTeX(raw, item) { return workingParts(raw, item).map(part => part.source).join(' '); }
export function renderWorking(raw, item) {
  try { return `<div class="math-block math-working" data-math-source="${escapeHTML(raw)}">${workingParts(raw, item).map(part => `<div class="math-line">${katexHTML(part.source, true)}</div>`).join('')}</div>`; }
  catch { return `<div class="math-block">${fallback(raw)}</div>`; }
}

export const isIntegerDisplay = item => item.numberFormat === 'integer' && Number.isInteger(item.answer);
export function displayAnswer(item) {
  return isIntegerDisplay(item) ? String(item.answer) : formatAnswer(item);
}
export function renderNumber(value) {
  const raw = String(value);
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)) return escapeHTML(raw);
  try { return `<span class="math-inline" data-math-source="${escapeHTML(raw)}">${katexHTML(toTeX(raw))}</span>`; }
  catch { return fallback(raw); }
}

// Only explicitly recognizable notation is typeset inside prose. Text is always
// escaped, so user-entered answers and story labels cannot introduce HTML/TeX.
const inlineStart = /(?:\b(?:P|E|Beta|B|C|BF)\(|\b(?:BF_[A-Z]+|H_[A-Z]+|D[12])\b|[ab]′|θ|\bO(?=\s*\/\s*\()|\bn!|\b\d+(?:\.\d+)?e[+-]?\d+\b)/g;
function balancedEnd(raw, open) {
  const stack = [];
  for (let i = open; i < raw.length; i++) {
    if (raw[i] === '(' || raw[i] === '[') stack.push(raw[i]);
    else if (raw[i] === ')' || raw[i] === ']') {
      const expected = raw[i] === ')' ? '(' : '[';
      if (stack.pop() !== expected) return -1;
      if (!stack.length) return i + 1;
    }
  }
  return -1;
}
function inlineAtomEnd(raw, start) {
  const rest = raw.slice(start);
  if (rest[0] === '(' || rest[0] === '[') return balancedEnd(raw, start);
  const call = rest.match(/^(?:P|E|Beta|B|C|BF)\(/);
  if (call) return balancedEnd(raw, start + call[0].length - 1);
  const atom = rest.match(/^(?:BF_[A-Z]+|H_[A-Z]+|[ab]′|θ|[a-zA-Z]\d*\b|(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)/);
  if (!atom) return -1;
  let end = start + atom[0].length;
  if (/^BF_/.test(atom[0]) && raw[end] === '(') end = balancedEnd(raw, end);
  if (end >= 0 && raw[end] === '!') end++;
  return end;
}
function inlineExpressionEnd(raw, start) {
  let end = inlineAtomEnd(raw, start);
  if (end < 0) return -1;
  while (true) {
    const rest = raw.slice(end);
    // An explicit operator must be followed by a recognizable math atom.
    const operator = rest.match(/^\s*(?:[=≈~≥≤+−×/^∩∪])\s*/);
    if (operator) {
      const next = inlineAtomEnd(raw, end + operator[0].length);
      if (next < 0) break;
      end = next;
      continue;
    }
    // Compact notation allows adjacent functions and parenthesized factors.
    // Whitespace alone does not make a following English word mathematical.
    if (/^(?:\(|\[|(?:P|E|Beta|B|C)\()/.test(rest)) {
      const next = inlineAtomEnd(raw, end);
      if (next < 0) break;
      end = next;
      continue;
    }
    break;
  }
  return end;
}
export function renderProse(value) {
  const raw = String(value);
  let out = '', cursor = 0;
  inlineStart.lastIndex = 0;
  for (let match; (match = inlineStart.exec(raw));) {
    const start = match.index;
    if (start < cursor) continue;
    const end = inlineExpressionEnd(raw, start);
    if (end < 0) continue;
    const segment = raw.slice(start, end);
    try {
      out += escapeHTML(raw.slice(cursor, start)) + `<span class="math-inline" data-math-source="${escapeHTML(segment)}">${katexHTML(toTeX(segment))}</span>`;
      cursor = end;
    } catch { /* Unrecognized prose stays intact and escaped. */ }
    inlineStart.lastIndex = Math.max(inlineStart.lastIndex, end);
  }
  return out + escapeHTML(raw.slice(cursor));
}
