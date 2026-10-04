// Deeper local UI audit. Uses the same optional Playwright environment variables
// as browser.mjs; no dependencies are installed and no remote site is modified.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { generateQuestion, generateExam, skills } from '../site/questions.js';
import { formatAnswer } from '../site/engine.js';

const { chromium } = await import(process.env.BAYESVILLE_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BAYESVILLE_URL || 'http://127.0.0.1:4173/BayesianInferenceForPsychology/';
const browser = await chromium.launch({ headless: true, ...(process.env.BAYESVILLE_CHROMIUM ? { executablePath: process.env.BAYESVILLE_CHROMIUM } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 1024 }, reducedMotion: 'reduce' });
const errors = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => requests.push(request.url()));
page.setDefaultTimeout(10000);
await mkdir('.artifacts', { recursive: true });

const cases = new Map();
for (const skill of skills) for (let seed = 0; seed < 1000; seed++) {
  const q = generateQuestion(skill.id, seed);
  const prompt = q.prompt.replace(/\d+(?:\.\d+)?/g, '#').replace(/\b[SF](?:,\s*[SF])*/g, 'sequence');
  const signature = [skill.id, q.contextId, q.title, prompt, q.table?.rows.length || 0, q.steps.map(s => s.unit).join(',')].join('|');
  if (!cases.has(signature)) cases.set(signature, { skillId: skill.id, seed, q });
}
const longCase = [...cases.values()].find(({ q }) => q.title === 'Learn from several beta forecasters' && q.table.rows.length === 3);

async function openCase({ skillId, seed, q }) {
  await page.goto(`${base}#skills`);
  await page.locator('[data-action="skill"]').first().waitFor();
  await page.evaluate(seed => Object.defineProperty(crypto, 'getRandomValues', {
    configurable: true, value(array) { array.fill(seed); return array; },
  }), seed);
  await page.locator(`[data-action="skill"][data-id="${skillId}"]`).click();
  await page.locator('.question-card').waitFor();
  assert.equal(await page.locator('.question-title').innerText(), q.title);
}
async function tabTo(selector) {
  for (let i = 0; i < 50; i++) {
    if (await page.evaluate(selector => document.activeElement.matches(selector), selector)) return;
    await page.keyboard.press('Tab');
  }
  assert.fail(`Keyboard cannot reach ${selector}`);
}
async function visibleFocus(selector) {
  await page.waitForFunction(selector => {
    const element = document.querySelector(selector);
    if (!element) return false; // Hash navigation renders on the next event turn.
    const rect = element.getBoundingClientRect();
    return document.activeElement === element && rect.top >= -1 && rect.bottom <= innerHeight + 1;
  }, selector);
}
async function noOverflow(label) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, label);
}
async function questionOutline(visible) {
  const state = await page.locator('.question-title').evaluate(element => ({
    focused: document.activeElement === element,
    style: getComputedStyle(element).outlineStyle,
    color: getComputedStyle(element).outlineColor,
  }));
  assert.equal(state.focused, true, 'Heading remains the accessible reading and Tab starting point');
  assert.equal(state.style, visible ? 'solid' : 'none', 'Only keyboard activation shows a heading outline');
  if (visible) assert.equal(state.color, 'rgb(141, 61, 40)', 'Keyboard outline uses the existing palette');
}
function luminance(rgb) {
  const linear = rgb.map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
  return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
}

try {
  // Keyboard-only navigation after load: no locator.click/focus/fill calls.
  await page.goto(`${base}#skills`);
  await tabTo('[data-action="skill"][data-id="prediction"]');
  await page.keyboard.press('Enter');
  await visibleFocus('.question-title');
  await questionOutline(true);
  await tabTo('[data-action="toggle-guided"]');
  await page.keyboard.press('Space');
  await tabTo('#step-0');
  await page.keyboard.type('not a number');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#step-0').getAttribute('aria-invalid'), 'true');
  await visibleFocus('#step-0');
  const cdp = await page.context().newCDPSession(page);
  const ax = (await cdp.send('Accessibility.getFullAXTree')).nodes;
  const inputAX = ax.find(node => node.role?.value === 'textbox' && node.properties?.some(p => p.name === 'focused' && p.value.value));
  assert.ok(inputAX?.name?.value, 'The focused input has an accessible label');
  assert.match(inputAX.description.value, /Use a number/, 'The input description exposes the validation error');
  assert.ok(inputAX.properties.some(p => p.name === 'invalid' && p.value.value === 'true'));
  await tabTo('[data-action="reveal"]');
  await page.keyboard.press('Enter');
  await visibleFocus('#result-title');
  await tabTo('[data-action="next"]');
  await page.keyboard.press('Enter');
  await visibleFocus('.question-title');
  await questionOutline(true);
  await tabTo('[data-action="about"]');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#modal').evaluate(d => d.open), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'about');
  console.log('Passed: keyboard-only entry, guided validation, accessible error description, reveal, next question, and Help.');

  await openCase(longCase);
  await visibleFocus('.question-title');
  await questionOutline(false);
  await page.locator('#numeric-answer').fill('0.25');
  await page.locator('[data-action="skip"]').click();
  await visibleFocus('.question-title');
  await questionOutline(false);
  await page.locator('[data-action="skip"]').press('Enter');
  await visibleFocus('.question-title');
  await questionOutline(true);
  console.log('Passed: pointer entry/next have no heading highlight, including after typing; keyboard activation retains a visible themed outline.');

  // 1280×1024 at 200% and 400% browser zoom yields these CSS viewports.
  // This checks equivalent layout/reflow, rather than pretending DPR is zoom.
  for (const [width, height] of [[640, 512], [320, 256]]) {
    await page.setViewportSize({ width, height });
    await openCase(longCase);
    await visibleFocus('.question-title');
    await noOverflow(`${width}px question reflow`);
    await page.locator('[data-action="toggle-guided"]').click();
    await noOverflow(`${width}px guided reflow`);
    await page.locator('[data-action="reveal"]').click();
    await visibleFocus('#result-title');
    await noOverflow(`${width}px solution reflow`);
    await page.locator('[data-action="next"]').click();
    await visibleFocus('.question-title');
    await page.screenshot({ path: `.artifacts/audit-focus-${width}.png` });
    await page.locator('[data-action="about"]').click();
    assert.equal(await page.locator('#modal').evaluate(d => d.scrollWidth > d.clientWidth), false);
    await page.keyboard.press('Escape');
  }
  console.log('Passed: 200%/400%-equivalent reflow and visible focus on entry/results/next, including Help.');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openCase(longCase);
  await visibleFocus('.question-title');
  await page.locator('[data-action="reveal"]').click();
  await visibleFocus('#result-title');
  await page.locator('[data-action="next"]').click();
  await visibleFocus('.question-title');
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.setViewportSize({ width: 320, height: 844 });
  for (const item of cases.values()) {
    await openCase(item);
    await noOverflow(`${item.q.title}: question`);
    if (item.q.steps.length) {
      await page.locator('[data-action="toggle-guided"]').click();
      assert.equal(await page.locator('[data-step]').count(), item.q.steps.length);
      await noOverflow(`${item.q.title}: guidance`);
    }
    await page.locator('#numeric-answer').fill(formatAnswer(item.q));
    await page.locator('#numeric-answer').press('Enter');
    await page.locator('.result-card.correct').waitFor();
    await noOverflow(`${item.q.title}: result`);
  }
  console.log(`Passed: all ${cases.size} distinct generated presentation shapes at 320px (titles, prompt variants, row counts, guided units).`);

  // Every story must remain consistent across the linked exam, including the
  // prompt, table, hints, guided calculations, and the final worked solution.
  for (let seed = 0; seed < 5; seed++) {
    const exam = generateExam(seed);
    await page.goto(`${base}#skills`);
    await page.locator('[data-action="exam"]').waitFor();
    await page.evaluate(seed => Object.defineProperty(crypto, 'getRandomValues', {
      configurable: true, value(array) { array.fill(seed); return array; },
    }), seed);
    await page.locator('[data-action="exam"]').click();
    for (const [part, q] of exam.entries()) {
      await page.locator('.question-card').waitFor();
      assert.equal(await page.locator('.question-context').innerText(), q.context);
      assert.equal(await page.locator('.question-prompt').innerText(), q.prompt);
      const rows = await page.locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.cells].map(cell => cell.textContent)));
      assert.deepEqual(rows, q.table.rows.map(row => row.map(String)));
      await page.locator('[data-action="hint"]').click();
      assert.ok((await page.locator('#hint-panel').innerText()).includes(q.hints[0]));
      await page.locator('[data-action="toggle-guided"]').click();
      await noOverflow(`Exam ${seed}, part ${part + 1}: guidance`);
      await page.locator('#numeric-answer').fill(formatAnswer(q));
      await page.locator('#numeric-answer').press('Enter');
      await page.locator('.result-card.correct').waitFor();
      assert.equal(await page.locator('.explanation').innerText(), q.explanation);
      await noOverflow(`Exam ${seed}, part ${part + 1}: result`);
      if (part === 4) await page.screenshot({ path: `.artifacts/story-exam-${seed}-320.png`, fullPage: true });
      await page.locator('[data-action="next"]').click();
    }
    assert.notEqual(await page.locator('.question-context').innerText(), exam[0].context, 'New scenario changes the story');
  }
  console.log('Passed: all five exam stories, every linked part, hints, worked solutions, and fresh scenarios at 320px.');

  await openCase(longCase);
  await page.locator('[data-action="toggle-guided"]').click();
  for (const selector of ['#numeric-answer', '#step-0']) {
    const colors = await page.locator(selector).evaluate(element => {
      const css = getComputedStyle(element);
      return [css.borderTopColor, css.backgroundColor, getComputedStyle(element.closest('.question-card')).backgroundColor, getComputedStyle(document.body).backgroundColor]
        .map(color => color.match(/[\d.]+/g).map(Number));
    });
    const [border, fill, card, body] = colors;
    const cardAlpha = card[3] ?? 1;
    const compositeCard = card.slice(0, 3).map((v, i) => v * cardAlpha + body[i] * (1 - cardAlpha));
    for (const background of [fill, compositeCard]) {
      const values = [border, background].map(rgb => luminance(rgb.slice(0, 3)));
      const ratio = (Math.max(...values) + .05) / (Math.min(...values) + .05);
      assert.ok(ratio >= 3, `${selector}: input boundary contrast ${ratio.toFixed(2)}:1 is below 3:1`);
      console.log(`${selector}: boundary contrast ${ratio.toFixed(2)}:1 against ${background === fill ? 'input fill' : 'surrounding card'}.`);
    }
  }
  for (const root of [base, `${new URL(base).origin}/`]) {
    for (const [path, mime] of [['', 'text/html'], ['app.js', 'text/javascript'], ['questions.js', 'text/javascript'], ['contexts.js', 'text/javascript'], ['exam-contexts.js', 'text/javascript'], ['styles.css', 'text/css'], ['assets/autumn-village.png', 'image/png'], ['assets/favicon.svg', 'image/svg+xml']]) {
      const response = await page.request.get(`${root}${path}`);
      assert.equal(response.status(), 200);
      assert.ok(response.headers()['content-type'].startsWith(mime));
      assert.ok((await response.body()).length > 0);
    }
  }
  const redirect = await page.request.get(`${new URL(base).origin}/BayesianInferenceForPsychology?audit=1`, { maxRedirects: 0 });
  assert.equal(redirect.status(), 301);
  assert.equal(redirect.headers().location, '/BayesianInferenceForPsychology/?audit=1');
  const head = await page.request.head(`${base}app.js`);
  assert.equal(head.status(), 200);
  assert.equal((await head.body()).length, 0);
  assert.equal((await page.request.post(base)).status(), 405);
  assert.deepEqual(errors, []);
  assert.deepEqual(requests.filter(url => new URL(url).origin !== new URL(base).origin), []);
  assert.deepEqual(await page.context().cookies(), []);
  console.log('Passed: input boundary contrast, real assets/MIME, both site roots, canonical redirect, HEAD/method handling, and no third-party requests/cookies.');
} catch (error) {
  await page.screenshot({ path: '.artifacts/audit-failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
