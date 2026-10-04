// Focused navigation regression checks. Start npm run dev first. Uses the same
// optional Playwright/Chromium environment variables as the other browser audits.
import assert from 'node:assert/strict';
import { generateQuestion } from '../site/questions.js';

const { chromium } = await import(process.env.BAYESVILLE_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BAYESVILLE_URL || 'http://127.0.0.1:4173/BayesianInferenceForPsychology/';
const browser = await chromium.launch({ headless: true, ...(process.env.BAYESVILLE_CHROMIUM ? { executablePath: process.env.BAYESVILLE_CHROMIUM } : {}) });
const errors = [];
let seed = 0;
while (generateQuestion('prediction', seed).title !== 'Learn from several beta forecasters') seed++;

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function stableScroll(page, label) {
  await settle(page);
  const initial = await page.evaluate(() => scrollY);
  await page.waitForTimeout(350);
  const final = await page.evaluate(() => scrollY);
  assert.ok(Math.abs(final - initial) <= 1, `${label}: scroll does not keep moving (${initial} → ${final})`);
  return final;
}
async function landing(page, selector, label, gap = 24) {
  await page.locator(selector).waitFor();
  await stableScroll(page, label);
  const position = await page.locator(selector).evaluate((element, gap) => {
    const top = element.getBoundingClientRect().top;
    const absoluteTop = top + scrollY;
    const maximum = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    return { top, expected: absoluteTop - Math.min(maximum, Math.max(0, absoluteTop - gap)) };
  }, gap);
  assert.ok(Math.abs(position.top - position.expected) <= 2, `${label}: predictable top gap (${position.top}, expected ${position.expected})`);
}
async function expectScroll(page, expected, label) {
  const actual = await stableScroll(page, label);
  assert.ok(Math.abs(actual - expected) <= 2, `${label}: restores ${expected}px, got ${actual}px`);
}
async function setScroll(page, y) {
  await page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' }), y);
  await settle(page);
  return page.evaluate(() => scrollY);
}
async function outline(page, keyboard) {
  const state = await page.locator('.question-title').evaluate(element => ({
    focused: document.activeElement === element,
    outline: getComputedStyle(element).outlineStyle,
  }));
  assert.equal(state.focused, true, 'The new question remains the reading and Tab starting point');
  assert.equal(state.outline, keyboard ? 'solid' : 'none', 'Only keyboard activation highlights the question heading');
}
async function keepAnchor(page, selector, label) {
  const element = page.locator(selector);
  await element.scrollIntoViewIfNeeded();
  const oldTop = await element.evaluate(node => node.getBoundingClientRect().top);
  await element.click();
  await stableScroll(page, label);
  const position = await page.locator(selector).evaluate((node, oldTop) => {
    const top = node.getBoundingClientRect().top;
    const absoluteTop = top + scrollY;
    const maximum = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    return { top, expected: absoluteTop - Math.min(maximum, Math.max(0, absoluteTop - oldTop)) };
  }, oldTop);
  assert.ok(Math.abs(position.top - position.expected) <= 2, `${label}: the control stays in place`);
}

try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    for (const reducedMotion of ['no-preference', 'reduce']) {
      const context = await browser.newContext({ viewport, reducedMotion });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(seed => {
        Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value(array) { array.fill(seed); return array; } });
        const accesses = [];
        Object.defineProperty(window, '__qaStorageAccesses', { get: () => [...accesses] });
        for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, {
          configurable: true, get() { accesses.push(name); throw new Error(`Unexpected ${name} access`); },
        });
      }, seed);
      const label = `${viewport.width}px, ${reducedMotion}`;
      await page.goto(`${base}#home`);
      await page.locator('[data-action="skill"]').first().waitFor();
      await expectScroll(page, 0, `${label}: initial home`);

      // The return button restores the actual card position, including a card
      // far down a one-column mobile list, rather than jumping to the list top.
      const origin = page.locator('[data-action="skill"][data-id="prediction"]');
      await origin.scrollIntoViewIfNeeded();
      const originY = await stableScroll(page, `${label}: calculation list`);
      await origin.click();
      await landing(page, '.question-card', `${label}: question entry`);
      await outline(page, false);
      await page.locator('[data-action="pause"]').click();
      await page.locator('[data-action="skill"]').first().waitFor();
      await expectScroll(page, originY, `${label}: Back to calculations`);
      assert.equal(await origin.evaluate(element => document.activeElement === element), true, 'Return focuses the originating card');

      await origin.click();
      await landing(page, '.question-card', `${label}: second entry`);
      await keepAnchor(page, '[data-action="toggle-guided"]', `${label}: open guided steps`);
      await page.locator('#step-0').fill('not a number');
      await page.locator('[data-action="check-step"][data-index="0"]').click();
      await stableScroll(page, `${label}: guided validation`);
      assert.equal(await page.locator('#step-0').getAttribute('aria-invalid'), 'true');
      await keepAnchor(page, '[data-action="toggle-guided"]', `${label}: close guided steps`);
      await page.locator('[data-action="hint"]').click();
      await stableScroll(page, `${label}: hint`);
      const hint = await page.locator('.hint-panel').evaluate(element => ({ top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom, height: innerHeight }));
      assert.ok(hint.bottom > 0 && hint.top < hint.height, 'The requested hint appears in the viewport');

      await page.locator('[data-action="reveal"]').click();
      await landing(page, '.result-card', `${label}: solution`);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'result-title');
      await page.locator('[data-action="next"]').click();
      await landing(page, '.question-card', `${label}: next question`);
      await outline(page, false);
      await page.locator('[data-action="skip"]').press('Enter');
      await landing(page, '.question-card', `${label}: keyboard next question`);
      await outline(page, true);

      await page.locator('[data-action="about"]').scrollIntoViewIfNeeded();
      const helpY = await stableScroll(page, `${label}: before Help`);
      await page.locator('[data-action="about"]').click();
      await expectScroll(page, helpY, `${label}: Help opens`);
      await page.keyboard.press('Escape');
      await expectScroll(page, helpY, `${label}: Help closes`);
      assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'about');

      await page.locator('.brand').click();
      await page.locator('#welcome-title').waitFor();
      await expectScroll(page, 0, `${label}: Home`);
      await page.locator('[data-nav="skills"]').click();
      await landing(page, '#skills-title', `${label}: Practice navigation`);
      // A repeat click must have the same destination as the first click.
      await page.locator('[data-nav="skills"]').click();
      await landing(page, '#skills-title', `${label}: repeated Practice navigation`);

      // Exercise native hash navigation and actual history traversal, with two
      // distinct #home entries, so a route-keyed single scroll slot cannot pass.
      await page.goto(`${base}#home`);
      await page.locator('#welcome-title').waitFor();
      const firstHomeY = await setScroll(page, 110);
      await page.evaluate(() => { location.hash = 'skills'; });
      await page.waitForURL('**/#skills');
      await landing(page, '#skills-title', `${label}: direct skills hash`);
      const skillsY = await setScroll(page, 220);
      await page.evaluate(() => { location.hash = 'home'; });
      await page.waitForURL('**/#home');
      await expectScroll(page, 0, `${label}: direct home hash`);
      const secondHomeY = await setScroll(page, 55);
      await page.goBack();
      await page.waitForURL('**/#skills');
      await expectScroll(page, skillsY, `${label}: history back to skills`);
      await page.goBack();
      await page.waitForURL('**/#home');
      await expectScroll(page, firstHomeY, `${label}: history back to first home`);
      await page.goForward();
      await page.waitForURL('**/#skills');
      await expectScroll(page, skillsY, `${label}: history forward to skills`);
      await page.goForward();
      await page.waitForURL('**/#home');
      await expectScroll(page, secondHomeY, `${label}: history forward to second home`);

      const finalOrigin = page.locator('[data-action="skill"][data-id="bayes-factors"]');
      await finalOrigin.scrollIntoViewIfNeeded();
      const finalOriginY = await stableScroll(page, `${label}: browser-return origin`);
      await finalOrigin.click();
      await landing(page, '.question-card', `${label}: practice before browser Back`);
      await page.locator('[data-action="about"]').click();
      assert.equal(await page.locator('#modal').evaluate(dialog => dialog.open), true);
      await page.goBack();
      await page.locator('#welcome-title').waitFor();
      assert.equal(await page.locator('#modal').evaluate(dialog => dialog.open), false, 'Browser navigation dismisses Help');
      await expectScroll(page, finalOriginY, `${label}: browser Back from practice with Help open`);
      await page.goForward();
      await page.waitForURL('**/#skills');
      assert.equal(await page.locator('.question-card').count(), 0, 'Forward does not resurrect a discarded question');
      await stableScroll(page, `${label}: empty practice history fallback`);

      if (viewport.width === 1440) {
        await origin.scrollIntoViewIfNeeded();
        await origin.click();
        await landing(page, '.question-card', `${label}: before resize`);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('[data-action="pause"]').click();
        await page.locator('#skills-title').waitFor();
        await stableScroll(page, `${label}: return after desktop-to-mobile resize`);
        const card = await origin.evaluate(element => {
          const rect = element.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom, viewport: innerHeight, focused: document.activeElement === element };
        });
        assert.ok(card.focused && card.top >= 0 && card.bottom <= card.viewport, 'Resizing returns to the originating card, not an unrelated absolute scroll offset');
        await page.setViewportSize(viewport);
      }
      assert.deepEqual(await page.evaluate(() => window.__qaStorageAccesses), [], 'Scroll restoration never accesses browser storage');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      console.log(`Passed: ${label}; consistent question/result entry, list return, inline controls, Help, keyboard focus, and per-entry Back/Forward restoration.`);
      await context.close();
    }
  }
  assert.deepEqual(errors, [], 'No browser errors during navigation');
} finally {
  await browser.close();
}
