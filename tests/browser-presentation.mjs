// Visual mathematics regression audit. Start npm run dev first; see browser.mjs
// for optional external Playwright/Chromium environment variables.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { skills, generateQuestion, generateExam } from '../site/questions.js';
import { formatAnswer } from '../site/engine.js';
import { displayAnswer, isIntegerDisplay } from '../site/math-display.js';

const { chromium } = await import(process.env.BAYESVILLE_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BAYESVILLE_URL || 'http://127.0.0.1:4173/BayesianInferenceForPsychology/';
const browser = await chromium.launch({ headless: true, ...(process.env.BAYESVILLE_CHROMIUM ? { executablePath: process.env.BAYESVILLE_CHROMIUM } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const errors = [], external = [], failed = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (!request.url().startsWith(new URL(base).origin)) external.push(request.url()); });
page.on('response', response => { if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`); });
page.setDefaultTimeout(10000);
await mkdir('.artifacts', { recursive: true });

const cases = new Map(), extrema = new Map();
for (let seed = 0; seed < 2000; seed++) for (const skill of skills) {
  const q = generateQuestion(skill.id, seed), item = { skillId: skill.id, seed, q };
  const signature = `${q.title}|${q.contextId}`;
  if (!cases.has(signature)) cases.set(signature, item);
  for (const [kind, score] of [['long', q.solution.working.length], ['precision', q.decimals], ['largest', q.answer], ['smallest', -q.answer]]) {
    const key = `${q.title}|${kind}`, old = extrema.get(key);
    if (!old || score > old.score) extrema.set(key, { ...item, score });
  }
}
assert.equal(cases.size, 135);
const preparationOnly = process.env.BAYESVILLE_PRESENTATION_PREPARATION_ONLY === '1';
const coldOnly = process.env.BAYESVILLE_PRESENTATION_COLD_ONLY === '1';
const layoutOnly = process.env.BAYESVILLE_PRESENTATION_LAYOUT_ONLY === '1';
const activeCases = [...cases.values()].filter(item => !preparationOnly || item.q.solution.preparation?.length);
const additionalCases = [...new Map([...extrema.values()].map(item => [item.q.id, item])).values()]
  .filter(item => (!preparationOnly || item.q.solution.preparation?.length) && ![...cases.values()].some(original => original.q.id === item.q.id));

async function settle() {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
}
async function choose(skillId, seed) {
  await page.goto(`${base}#skills`);
  await page.locator('[data-action="skill"]').first().waitFor();
  await page.evaluate(seed => Object.defineProperty(crypto, 'getRandomValues', {
    configurable: true, value(array) { array.fill(seed); return array; },
  }), seed);
  await page.locator(skillId === 'exam' ? '[data-action="exam"]' : `[data-action="skill"][data-id="${skillId}"]`).click();
  await page.locator('.question-card').waitFor();
}
async function inspect(label, requireMath = false) {
  await settle();
  assert.equal(await page.locator('.math-fallback, .katex-error').count(), 0, `${label}: no failed mathematics`);
  if (requireMath) assert.ok(await page.locator('.katex').count() > 0, `${label}: mathematics rendered`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label}: no page overflow`);
  const inaccessible = await page.locator('.math-block').evaluateAll(elements => elements.flatMap(element => {
    if (element.scrollWidth <= element.clientWidth + 1) return [];
    const style = getComputedStyle(element);
    return !['auto', 'scroll'].includes(style.overflowX) || element.tabIndex !== 0 || !element.getAttribute('aria-label')
      ? [{ text: element.textContent, overflow: style.overflowX, width: element.clientWidth, content: element.scrollWidth, tabindex: element.tabIndex }] : [];
  }));
  assert.deepEqual(inaccessible, [], `${label}: wide equations remain reachable with keyboard scrolling`);
  assert.equal(await page.locator('.katex > .katex-mathml > math').count(), await page.locator('.katex').count(), `${label}: each equation has MathML`);
}
async function verifyInputData(q) {
  assert.equal(await page.locator('.question-title').innerText(), q.title);
  assert.equal(await page.locator('.question-context').getAttribute('data-source'), q.context);
  assert.equal(await page.locator('.question-prompt').getAttribute('data-source'), q.prompt);
  const rows = await page.locator('.question-card tbody tr').evaluateAll(rows => rows.map(row => [...row.cells].map(cell => cell.getAttribute('data-source'))));
  assert.deepEqual(rows, q.table?.rows.map(row => row.map(String)) || []);
}
async function verifyResult(q, raw) {
  if (raw !== undefined) {
    await page.locator('#numeric-answer').fill(raw);
    await page.locator('#numeric-answer').press('Enter');
    await page.locator('.result-card.correct').waitFor();
    assert.equal(await page.locator('.submitted-answer strong').innerText(), raw.trim(), `${q.id}: raw submitted notation preserved`);
  } else {
    await page.locator('[data-action="reveal"]').click();
    await page.locator('.result-card').waitFor();
    assert.equal(await page.locator('.submitted-answer').count(), 0, `${q.id}: no fabricated student answer`);
  }
  assert.equal(await page.locator('.correct-answer strong').innerText(), displayAnswer(q));
  const answerLines = await page.locator('.correct-answer strong').evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element); return range.getClientRects().length;
  });
  assert.equal(answerLines, 1, `${q.id}: the correct numeric answer stays on one line`);
  assert.equal(await page.locator('.intermediate-calculation').count(), q.steps.length);
  assert.equal(await page.locator('.preparation-calculation').count(), q.solution.preparation?.length || 0);
  assert.equal(await page.locator('.final-calculation').count(), 1);
  assert.ok(await page.locator('.final-calculation .formula .katex').count() > 0);
  assert.ok(await page.locator('.final-calculation .calculation .katex').count() > 0);
  assert.equal(await page.locator('.rounding-note strong').innerText(), displayAnswer(q));
  assert.equal(await page.locator('.explanation').getAttribute('data-source'), q.solution.interpretation);
  if (isIntegerDisplay(q)) assert.match(await page.locator('.rounding-note').innerText(), /final answer|exact|whole number/i);
  else assert.match(await page.locator('.rounding-note').innerText(), new RegExp(`${q.decimals} decimal places`));
  await inspect(`${q.id}: solution`, true);
}
async function allStages(item, width) {
  await choose(item.skillId, item.seed);
  await verifyInputData(item.q);
  await inspect(`${item.q.id}: ${width}px question`);
  if (!layoutOnly) for (let i = 0; i < item.q.hints.length; i++) await page.locator('[data-action="hint"]').click();
  if (!layoutOnly) await inspect(`${item.q.id}: hints`);
  if (!layoutOnly && item.q.steps.length) {
    await page.locator('[data-action="toggle-guided"]').click();
    assert.equal(await page.locator('[data-step]').count(), item.q.steps.length);
    for (const [index, step] of item.q.steps.entries()) {
      await page.locator(`#step-${index}`).fill(formatAnswer(step));
      await page.locator(`#step-${index}`).press('Enter');
      assert.equal(await page.locator(`#step-feedback-${index}`).innerText(), 'Correct.');
    }
    await inspect(`${item.q.id}: guided`);
  }
  await verifyResult(item.q, formatAnswer(item.q));
}

try {
  if (!coldOnly) {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const item of activeCases) await allStages(item, width);
    for (let seed = 0; seed < 5; seed++) {
      await choose('exam', seed);
      for (const [part, q] of generateExam(seed).entries()) {
        await verifyInputData(q);
        await inspect(`Exam ${seed} part ${part + 1}: ${width}px question`);
        if (!layoutOnly) {
          await page.locator('[data-action="hint"]').click();
          await page.locator('[data-action="toggle-guided"]').click();
          await inspect(`Exam ${seed} part ${part + 1}: guidance`);
        }
        await verifyResult(q, formatAnswer(q));
        if (part < 4) await page.locator('[data-action="next"]').click();
      }
    }
    await page.screenshot({ path: `.artifacts/presentation-${width}.png`, fullPage: true });
    console.log(`Passed: ${activeCases.length} standalone stories and 25 linked exam parts at ${width}px; data, ${layoutOnly ? '' : 'hints, guidance, '}answers, MathML, and overflow.`);
  }

  await page.setViewportSize({ width: 320, height: 844 });
  for (const item of additionalCases) await allStages(item, 320);
  console.log(`Passed: ${additionalCases.length} extra long, small, large, and high-precision standalone examples.`);

  const probabilityCase = [...cases.values()].find(({ q }) => q.unit === 'probability' && q.answer > 0 && q.answer < 1);
  for (const raw of [`${formatAnswer(probabilityCase.q)} / 1`, `${Number(formatAnswer(probabilityCase.q)) * 100}%`, formatAnswer(probabilityCase.q).replace('.', ',')]) {
    await choose(probabilityCase.skillId, probabilityCase.seed);
    await verifyResult(probabilityCase.q, raw);
  }
  await choose(probabilityCase.skillId, probabilityCase.seed);
  await page.locator('#numeric-answer').fill('1/0');
  await page.locator('#numeric-answer').press('Enter');
  assert.equal(await page.locator('.result-card').count(), 0, 'Malformed entry does not reveal a result');
  await page.locator('#numeric-answer').fill('1/3');
  await page.locator('[data-action="reveal"]').click();
  assert.equal(await page.locator('.submitted-answer strong').innerText(), '1/3');
  assert.match(await page.locator('.submitted-answer').innerText(), /unchecked/i);
  await inspect('Unchecked draft display', true);
  await choose(probabilityCase.skillId, probabilityCase.seed);
  await verifyResult(probabilityCase.q);
  console.log('Passed: fractions, percentages, decimal commas, malformed answers, unchecked drafts, and empty reveals.');

  const rich = [...cases.values()].find(({ q }) => q.title === 'Learn from several beta forecasters');
  await choose(rich.skillId, rich.seed);
  await page.locator('[data-action="reveal"]').press('Enter');
  await settle();
  assert.equal(await page.locator('#result-title').evaluate(element => document.activeElement === element), true);
  const y = await page.evaluate(() => scrollY);
  await page.waitForTimeout(400);
  assert.ok(Math.abs(await page.evaluate(() => scrollY) - y) <= 1, 'Math and fonts do not shift result scroll after navigation');
  await page.locator('[data-action="next"]').press('Enter');
  await settle();
  assert.equal(await page.locator('.question-title').evaluate(element => document.activeElement === element), true);
  assert.equal(await page.locator('.question-title').evaluate(element => getComputedStyle(element).outlineStyle), 'solid');
  assert.equal(await page.evaluate(() => document.fonts.status), 'loaded');
  const fontStates = await page.evaluate(() => [...document.fonts].filter(font => font.family.startsWith('KaTeX') && font.status === 'error').map(font => font.family));
  assert.deepEqual(fontStates, [], 'Self-hosted mathematical fonts load');
  console.log('Passed: keyboard reading focus and stable result scroll with loaded self-hosted fonts.');
  }

  for (const title of ['Predict a future count after learning', 'Learn from several beta forecasters', 'Posterior probability of a general law']) {
    const coldContext = await browser.newContext({ viewport: { width: 320, height: 844 }, reducedMotion: 'reduce' });
    const cold = await coldContext.newPage();
    const delayedFonts = [];
    cold.on('pageerror', error => errors.push(error.message));
    cold.on('request', request => { if (!request.url().startsWith(new URL(base).origin)) external.push(request.url()); });
    cold.on('response', response => { if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`); });
    await cold.route('**/*.woff2*', async route => {
      delayedFonts.push(route.request().url());
      await new Promise(resolve => setTimeout(resolve, 300));
      await route.continue();
    });
    const coldExample = [...cases.values()].find(({ q }) => q.title === title);
    await cold.addInitScript(seed => Object.defineProperty(crypto, 'getRandomValues', {
      configurable: true, value(array) { array.fill(seed); return array; },
    }), coldExample.seed);
    await cold.goto(`${base}#skills`);
    await cold.locator(`[data-action="skill"][data-id="${coldExample.skillId}"]`).click();
    await cold.locator('[data-action="reveal"]').click();
    await cold.locator('.result-card').waitFor();
    const firstPosition = await cold.evaluate(() => ({ y: scrollY, top: document.querySelector('#result-title').getBoundingClientRect().top }));
    await cold.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => setTimeout(resolve, 500)); });
    const finalPosition = await cold.evaluate(() => ({ y: scrollY, top: document.querySelector('#result-title').getBoundingClientRect().top }));
    assert.ok(delayedFonts.length > 0, 'Cold font-load check intercepted local font files');
    assert.ok(Math.abs(firstPosition.y - finalPosition.y) <= 1, `${title}: delayed font loading does not move the result scroll position`);
    assert.ok(Math.abs(firstPosition.top - finalPosition.top) <= 1, `${title}: delayed font loading does not move the result heading`);
    assert.equal(await cold.locator('.math-fallback, .katex-error').count(), 0);
    await coldContext.close();
  }
  console.log('Passed: three cold mobile scenarios, including piecewise mathematics, stay stable with each font delayed by 300ms.');

  assert.deepEqual(errors, [], 'No browser errors');
  assert.deepEqual(failed, [], 'No failing asset requests');
  assert.deepEqual(external, [], 'No third-party requests');
  console.log('Presentation browser audit passed.');
} finally {
  await browser.close();
}
