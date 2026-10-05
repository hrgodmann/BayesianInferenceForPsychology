import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { toTeX, workingToTeX, renderFormula, renderWorking, renderProse, renderNumber, displayAnswer, isIntegerDisplay } from '../site/math-display.js';
import { formatAnswer, gradeAnswer } from '../site/engine.js';
import { skills, generateQuestion, generateExam } from '../site/questions.js';

const sourceSpans = html => [...html.matchAll(/data-math-source="([^"]+)"/g)].map(match => match[1]);

test('fractions preserve arithmetic precedence and grouped denominators', () => {
  assert.equal(toTeX('2 + 3 / 4'), '2 + \\frac{3}{4}');
  assert.equal(toTeX('(2 + 3) / 4'), '\\frac{2 + 3}{4}');
  assert.equal(toTeX('2 / (3 + 4)'), '\\frac{2}{3 + 4}');
  assert.equal(toTeX('2 × 3 / 4'), '\\frac{2 \\times 3}{4}');
  assert.equal(toTeX('2 / 3 × 4'), '\\frac{2}{3} \\times 4');
  assert.equal(toTeX('[2 / 3] / [4 / 5]'), '\\frac{\\frac{2}{3}}{\\frac{4}{5}}');
  assert.equal(toTeX('0.4^2 × (1 − 0.4)^3'), '0.4^{2} \\times \\left(1 - 0.4\\right)^{3}');
  assert.equal(toTeX('2^3^2'), '2^{3^{2}}');
  assert.equal(toTeX('−2^2'), '-2^{2}');
});

test('probability notation uses real coefficients, sums, conditions, and subscripts', () => {
  assert.equal(toTeX('C(n, k)'), '\\binom{n}{k}');
  assert.equal(toTeX('BF_AB'), '\\mathrm{BF}_{AB}');
  assert.equal(toTeX('D2'), 'D_{2}');
  assert.equal(toTeX('a′'), "a'");
  assert.match(toTeX('P(data) = Σ P(model)P(data | model)'), /\\sum/);
  assert.match(toTeX('P(data) = Σ P(model)P(data | model)'), /\\mid/);
  assert.match(toTeX('P(K ≥ 2) = 1 − P(K = 0) − P(K = 1)'), /K \\ge 2/);
  assert.match(toTeX('P(D | H_L) = 1 for all successes; 0 if any failure occurs'), /\\begin\{cases\}/);
  assert.equal(toTeX('C(5, 2) × B(4, 5) / B(2, 2)'), '\\frac{\\binom{5}{2} \\times \\mathrm{B}\\left(4 , 5\\right)}{\\mathrm{B}\\left(2 , 2\\right)}');
  assert.match(toTeX('C(n, k) = n! / [k!(n − k)!]'), /\\frac\{n!\}\{k! \\, \\left\(n - k\\right\)!\}/);
});

test('working distinguishes exact arithmetic, rounding, and rounded operands', () => {
  assert.equal(workingToTeX('0.3 × 0.6 = 0.18'), '0.3 \\times 0.6 = 0.18');
  assert.equal(workingToTeX('1 / 3 = 0.3333333'), '\\frac{1}{3} \\approx 0.3333333');
  assert.equal(workingToTeX('C(5, 2) = 10'), '\\binom{5}{2} = 10');
  assert.equal(workingToTeX('B(2, 3) / B(1, 1) = (1/2) × (1/3) × (2/4) = 0.08333333'), '\\frac{\\mathrm{B}\\left(2 , 3\\right)}{\\mathrm{B}\\left(1 , 1\\right)} = \\left(\\frac{1}{2}\\right) \\times \\left(\\frac{1}{3}\\right) \\times \\left(\\frac{2}{4}\\right) \\approx 0.08333333');
  assert.equal(workingToTeX('0.3333333 × 3 = 0.9999999', { answer: 1 }), '0.3333333 \\times 3 \\approx 0.9999999');
  assert.equal(workingToTeX('0.1 + 0.2 = 0.3', { answer: 0.1 + 0.2 }), '0.1 + 0.2 = 0.3');
  assert.match(workingToTeX('1 / 3 = 0.3333333 = 0.33'), /\\approx 0\.3333333 \\approx 0\.33$/);
});

test('synchronous rendering includes accessible MathML and separate equality rows', () => {
  const formula = renderFormula('P(A | B) = P(A ∩ B) / P(B)');
  assert.match(formula, /class="katex"/);
  assert.match(formula, /class="katex-mathml"/);
  assert.match(formula, /<mfrac>/);
  assert.match(formula, /annotation encoding="application\/x-tex"/);
  assert.equal(typeof formula, 'string');
  const working = renderWorking('C(5, 2) = 10');
  assert.equal((working.match(/class="math-line"/g) || []).length, 2);
  assert.match(working, /data-math-source="C\(5, 2\) = 10"/);
});

test('inline conversion recognizes whole equations without consuming surrounding prose', () => {
  const input = 'Use P(A ∪ B) = P(A) + P(B) − P(A ∩ B). Subtract the overlap.';
  const rendered = renderProse(input);
  assert.deepEqual(sourceSpans(rendered), ['P(A ∪ B) = P(A) + P(B) − P(A ∩ B)']);
  assert.ok(rendered.startsWith('Use '));
  assert.ok(rendered.endsWith('. Subtract the overlap.'));
  assert.deepEqual(sourceSpans(renderProse('The mean of Beta(a′, b′) is a′ / (a′ + b′). Use the updated values.')), ['Beta(a′, b′)', 'a′ / (a′ + b′)']);
  assert.deepEqual(sourceSpans(renderProse('Given BF_AB = 2 and BF_BC = 4.')), ['BF_AB = 2', 'BF_BC = 4']);
  assert.deepEqual(sourceSpans(renderProse('A prior θ ~ Beta(2, 3) describes uncertainty.')), ['θ ~ Beta(2, 3)']);
  assert.deepEqual(sourceSpans(renderProse('The number of orders is n! / [k!(n − k)!].')), ['n! / [k!(n − k)!]']);
  assert.deepEqual(sourceSpans(renderProse('The likelihood is θ^s(1 − θ)^f; integrate over θ.')), ['θ^s(1 − θ)^f', 'θ']);
  assert.deepEqual(sourceSpans(renderProse('Convert posterior odds O to a probability using O / (1 + O).')), ['O / (1 + O)']);
  assert.equal(renderProse('O denotes posterior odds.'), 'O denotes posterior odds.');
});

test('scientific notation has real superscripts rather than e notation', () => {
  assert.equal(toTeX('1.23e-7'), '1.23 \\times 10^{-7}');
  assert.match(renderNumber('1.23e-7'), /<msup>/);
  assert.deepEqual(sourceSpans(renderProse('A probability of 1.23e-7 is very small.')), ['1.23e-7']);
});

test('HTML and unrecognized TeX cannot enter the document as executable markup', () => {
  for (const render of [renderFormula, renderWorking, renderProse, renderNumber]) {
    const html = render('<img src=x onerror="alert(1)">');
    assert.ok(!html.includes('<img'));
    assert.match(html, /&lt;img/);
  }
  assert.match(renderFormula('\\href{javascript:alert(1)}{click}'), /math-fallback/);
  assert.ok(!renderFormula('\\href{javascript:alert(1)}{click}').includes('<a '));
  const maliciousEvent = renderProse('P(<script>alert(1)</script>)');
  assert.ok(!maliciousEvent.includes('<script>'));
  assert.match(maliciousEvent, /&lt;script&gt;/);
});

test('integer formatting is explicit and leaves numerical rounding and grading unchanged', () => {
  const integer = { answer: 7, decimals: 2, unit: 'number', numberFormat: 'integer' };
  assert.equal(displayAnswer(integer), '7');
  assert.equal(isIntegerDisplay(integer), true);
  assert.equal(displayAnswer({ ...integer, numberFormat: undefined }), '7.00');
  assert.equal(isIntegerDisplay({ ...integer, answer: 7.25 }), false);
  assert.equal(gradeAnswer(integer, '6.6').correct, false);
  assert.equal(gradeAnswer(integer, '7.00').correct, true);
  for (const answer of [0.125, 1.005, 0.12499999999999999, 0.9999999, 1 / 3]) {
    for (const decimals of [2, 4, 6, 8]) assert.equal(displayAnswer({ answer, decimals }), formatAnswer({ answer, decimals }));
  }
});

test('every generated formula and numeric working renders without fallback in every context', () => {
  const formulas = new Set();
  for (let seed = 0; seed < 100; seed++) {
    for (const question of [...skills.map(skill => generateQuestion(skill.id, seed)), ...generateExam(seed)]) {
      for (const item of [question.solution, ...question.steps]) {
        const location = `${question.id}: ${item.formula}`;
        const formula = renderFormula(item.formula), working = renderWorking(item.working, item.answer === undefined ? question : item);
        assert.ok(!formula.includes('math-fallback'), location);
        assert.ok(!working.includes('math-fallback'), `${location}: ${item.working}`);
        assert.match(formula, /class="(?:katex|math-block math-prose)"/, location);
        assert.match(working, /class="katex"/, location);
        formulas.add(item.formula);
      }
    }
  }
  assert.ok(formulas.size >= 90, 'covers final formulas, guided steps, and context-specific labels');
});

test('all bundled KaTeX CSS font references resolve locally', async () => {
  const css = await readFile(new URL('../site/vendor/katex/katex.min.css', import.meta.url), 'utf8');
  const paths = [...css.matchAll(/url\(([^)]+)\)/g)].map(match => match[1].replace(/['"]/g, ''));
  assert.ok(paths.length > 20);
  for (const path of paths) {
    assert.ok(path.startsWith('fonts/'), path);
    assert.ok((await readFile(new URL(`../site/vendor/katex/${path}`, import.meta.url))).length > 0, path);
  }
});


test('scientific notation remains one atom when raised to powers or factorials', () => {
  assert.equal(toTeX('1.2e-5^2'), '\\left(1.2 \\times 10^{-5}\\right)^{2}');
  assert.equal(toTeX('2e1!'), '\\left(2 \\times 10^{1}\\right)!');
  assert.equal(toTeX('(1.2e-5)^2'), '\\left(1.2 \\times 10^{-5}\\right)^{2}');
  assert.equal(toTeX('3 / 1.2e-5^2'), '\\frac{3}{\\left(1.2 \\times 10^{-5}\\right)^{2}}');
  assert.ok(!renderWorking('1.2e-5^2 = 1.44e-10').includes('math-fallback'));
  assert.equal(workingToTeX('1.2e-5^2 = 1.44e-10'), '\\left(1.2 \\times 10^{-5}\\right)^{2} = 1.44 \\times 10^{-10}');
});

test('plain guided instructions keep ordinary wrapping without changing their wording', () => {
  const instruction = 'Use the posterior predictive probability within this model';
  const result = renderFormula(instruction);
  assert.match(result, /class="math-block math-prose"/);
  assert.ok(result.endsWith(`${instruction}</div>`));
  assert.doesNotMatch(result, /class="katex"|math-fallback/);
  assert.match(renderFormula('a′ = a + successes'), /class="katex"/);
});


test('worked blocks use full-size fraction style while prose stays inline', () => {
  for (const html of [renderFormula('P(A | B) = P(A ∩ B) / P(B)'), renderWorking('1 / 3 = 0.3333333')]) {
    assert.match(html, /annotation encoding="application\/x-tex">\\displaystyle /);
    assert.match(html, /<mstyle[^>]* displaystyle="true"/);
  }
  for (const html of [renderProse('Use a′ / (a′ + b′).'), renderNumber('1.2e-5')]) {
    assert.doesNotMatch(html, /\\displaystyle /);
    assert.doesNotMatch(html, /<mstyle[^>]* displaystyle="true"/);
  }
  assert.equal(workingToTeX('1 / 3 = 0.3333333'), '\\frac{1}{3} \\approx 0.3333333');
});
