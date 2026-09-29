// Optional browser QA. Set BAYESVILLE_PLAYWRIGHT_MODULE and, when needed,
// BAYESVILLE_CHROMIUM to installed Playwright/browser paths. Start npm run dev first.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.BAYESVILLE_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BAYESVILLE_URL || 'http://127.0.0.1:4173/BayesianInferenceForPsychology/';
const browser = await chromium.launch({ headless: true, ...(process.env.BAYESVILLE_CHROMIUM ? { executablePath: process.env.BAYESVILLE_CHROMIUM } : {}) });
const errors = [];
await mkdir('.artifacts', { recursive: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
page.on('pageerror', e => errors.push(e.message));
const click = action => page.locator(`[data-action="${action}"]`).click();
async function route(hash) { await page.goto(`${base}#${hash}`); await page.locator('h1').waitFor(); }
async function overflow() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No page-wide overflow'); }
async function setup(chapter, type) {
  await route('chapters');
  await page.locator(`[data-action="chapter"][data-id="${chapter}"]`).click();
  if (type) await page.locator('.mode-option').filter({ has: page.locator(`input[value="${type}"]`) }).click();
  await page.locator('[name="shuffle"]').uncheck();
  await click('start');
}
try {
  await page.goto(base);
  assert.equal(await page.locator('.chapter-card').count(), 6);
  assert.equal(await page.locator('.hero-art img').evaluate(img => img.complete && img.naturalWidth > 0), true);
  await overflow();
  await page.screenshot({ path: '.artifacts/desktop-home.png', fullPage: true });
  await page.locator('[data-action="week"][data-value="2"]').click();
  assert.equal(await page.locator('.chapter-card').count(), 3);
  await page.locator('[data-action="week"][data-value="all"]').click();
  await page.locator('[data-action="chapter"][data-id="synopsis"]').click();
  assert.equal(await page.locator('input[value="calculation"]').isDisabled(), true);
  await page.screenshot({ path: '.artifacts/setup.png' });
  await page.locator('[name="shuffle"]').uncheck();
  await click('start');
  await page.locator('.question-card').waitFor();
  await page.locator('.skip-link').focus();
  await page.locator('.skip-link').press('Enter');
  assert.equal(await page.evaluate(() => location.hash), '#practice');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'main');
  await click('check');
  assert.match(await page.locator('#answer-error').innerText(), /Choose True/);
  await click('hint'); await click('hint');
  assert.equal(await page.locator('.hint-panel strong').count(), 2);
  assert.equal(await page.locator('[data-action="hint"]').isDisabled(), true);
  await click('bookmark');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'bookmark');
  await page.locator('[data-action="select-answer"][data-value="false"]').click();
  await click('check');
  assert.equal(await page.locator('.result-card.incorrect').count(), 1);
  await page.locator('[data-action="self-mark"][data-value="true"]').click();
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'self-mark');
  assert.equal(await page.locator('[data-action="self-mark"][data-value="false"]').getAttribute('aria-pressed'), 'false');
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bayesville.progress.v1')));
  assert.equal(saved.attempts.length, 1, 'Self-assessment replaces the same attempt');
  assert.equal(saved.attempts[0].correct, true);
  assert.equal(saved.attempts[0].hinted, true);
  await click('next');
  for (let i = 1; i < 5; i++) {
    await click('reveal');
    if (i !== 4) await page.locator(`[data-action="self-mark"][data-value="${i % 2 === 0}"]`).click();
    await click('next');
  }
  assert.equal(await page.locator('.roundup-item').count(), 5);
  assert.match(await page.locator('h1').innerText(), /wiser/);
  await page.screenshot({ path: '.artifacts/roundup.png', fullPage: true });
  await click('review-session');
  assert.equal(await page.locator('.question-count').innerText(), 'Question 1 / 3');

  await setup('3', 'calculation');
  await page.locator('#numeric-answer').fill('not a number'); await click('check');
  assert.match(await page.locator('#answer-error').innerText(), /Use a number/);
  await page.locator('#numeric-answer').fill('58%');
  await page.locator('.scratchpad summary').click();
  await page.locator('#scratchpad').fill('0.40 × 0.80 + 0.35 × 0.60 + 0.25 × 0.20');
  await page.reload();
  assert.equal(await page.locator('#numeric-answer').inputValue(), '58%');
  assert.match(await page.locator('#scratchpad').inputValue(), /0.40/);
  await page.locator('#numeric-answer').press('Enter');
  assert.equal(await page.locator('.result-card.correct').count(), 1);
  assert.equal(await page.locator('.correct-answer strong').innerText(), '0.58');
  assert.ok((await page.locator('.explanation').innerText()).length > 30);
  assert.ok(await page.locator('.worked-solution li').count() >= 2);
  await page.screenshot({ path: '.artifacts/calculation-result.png', fullPage: true });
  await click('next');
  await page.locator('#numeric-answer').fill('0'); await click('check');
  assert.equal(await page.locator('.result-card.incorrect').count(), 1);
  await click('pause');
  await page.locator('.resume-banner').waitFor();
  assert.equal(await page.locator('.resume-banner').count(), 1);
  await click('resume');
  await page.locator('.result-card.incorrect').waitFor();
  assert.equal(await page.locator('.result-card.incorrect').count(), 1);

  for (const width of [390, 320, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await route('home'); await overflow();
    await page.screenshot({ path: `.artifacts/home-${width}.png`, fullPage: true });
    await click('resume'); await page.locator('.question-card').waitFor(); await overflow();
    await page.screenshot({ path: `.artifacts/practice-${width}.png`, fullPage: true });
    await route('progress'); await overflow();
  }
  await page.setViewportSize({ width: 1440, height: 1080 });
  await route('progress');
  await page.screenshot({ path: '.artifacts/progress.png', fullPage: true });
  await click('bookmarks'); await click('start');
  assert.equal(await page.locator('.question-count').innerText(), 'Question 1 / 1');
  await route('progress');
  await click('reset'); await page.getByRole('button', { name: 'Keep my progress' }).click();
  assert.ok(await page.locator('.recent-item').count() > 0, 'Cancel reset preserves progress');
  await click('reset'); await click('confirm-reset');
  assert.equal(await page.locator('.recent-item').count(), 0);
  assert.equal(await page.locator('.empty-state').count(), 1);
  assert.equal((await page.request.get(`${base}quizzes/BIPS2026_Q1.pdf`)).status(), 404);
  assert.equal((await page.request.get(`${base}docs/quiz-1-2-alignment.md`)).status(), 404);

  const noStorage = await browser.newPage();
  await noStorage.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error('Storage disabled'); }; });
  await noStorage.goto(base);
  await noStorage.locator('[data-action="chapter"][data-id="1"]').click();
  await noStorage.locator('[data-action="start"]').click();
  assert.match(await noStorage.locator('.save-label').innerText(), /this tab/);
  await noStorage.locator('[data-action="reveal"]').click();
  assert.equal(await noStorage.locator('.result-card').count(), 1);
  await noStorage.close();
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: chapter filters, both question modes, input validation, hints, bookmark, paper self-assessment, review, summary, saved session, storage fallback, reset, project-path assets, source isolation, desktop/mobile layouts.');
} finally { await browser.close(); }
