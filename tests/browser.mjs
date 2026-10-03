// Optional browser QA. Set BAYESVILLE_PLAYWRIGHT_MODULE and, when needed,
// BAYESVILLE_CHROMIUM to installed Playwright/browser paths. Start npm run dev first.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.BAYESVILLE_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BAYESVILLE_URL || 'http://127.0.0.1:4173/BayesianInferenceForPsychology/';
const browser = await chromium.launch({ headless: true, ...(process.env.BAYESVILLE_CHROMIUM ? { executablePath: process.env.BAYESVILLE_CHROMIUM } : {}) });
const PROGRESS_KEY = 'bayesville.calculations.progress.v2';
const SESSION_KEY = 'bayesville.calculations.session.v2';
const skillIds = ['probability', 'bayes', 'sequences', 'beta', 'mixtures', 'prediction', 'bayes-factors'];
const errors = [];
await mkdir('.artifacts', { recursive: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
function watchErrors(target) {
  target.on('pageerror', error => errors.push(error.message));
  target.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
}
watchErrors(page);
page.setDefaultTimeout(10000);

const click = action => page.locator(`[data-action="${action}"]`).click();
const session = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), SESSION_KEY);
const progress = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), PROGRESS_KEY);
async function route(hash) { await page.goto(`${base}#${hash}`); await page.locator('h1').waitFor(); }
async function overflow(label = '') {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `No page-wide overflow ${label}`);
}
async function current() {
  return page.evaluate(async ({ key, engineUrl }) => {
    const { questionFor, formatAnswer } = await import(engineUrl);
    const saved = JSON.parse(localStorage.getItem(key));
    const ref = saved.refs[saved.index];
    const question = questionFor(ref);
    return { ref, question, formatted: formatAnswer(question), steps: question.steps.map(formatAnswer) };
  }, { key: SESSION_KEY, engineUrl: `${base}engine.js` });
}
async function setup(skillId, { difficulty = 'practice', length = '5', guided = false } = {}) {
  await route('skills');
  await page.locator(skillId === 'exam' ? '[data-action="exam"]' : `[data-action="skill"][data-id="${skillId}"]`).click();
  await page.locator('#practice-difficulty').selectOption(difficulty);
  if (skillId !== 'exam') await page.locator('#practice-length').selectOption(String(length));
  await page.locator('#guided-mode').setChecked(guided);
  await click('start');
  await page.locator('.question-card').waitFor();
}
async function answer(value) {
  await page.locator('#numeric-answer').fill(String(value));
  await page.locator('#answer-form button[type="submit"]').click();
}
async function correct(value) {
  const data = await current();
  await answer(value ?? data.formatted);
  await page.locator('.result-card.correct').waitFor();
  assert.equal(await page.locator('.correct-answer strong').innerText(), data.formatted);
  assert.ok((await page.locator('.explanation').innerText()).length > 20);
  assert.equal(await page.locator('.worked-solution li').count(), data.question.steps.length);
}
async function openSaved(action) {
  await route('progress');
  await click(action);
  assert.match(await page.locator('.modal-lede').innerText(), /original numbers/);
  await click('start');
  await page.locator('.question-card').waitFor();
}
async function selfAssess(value) {
  await page.locator('.self-assessment summary').click();
  await page.locator(`[data-action="self-mark"][data-value="${value}"]`).click();
  assert.equal(await page.locator(`[data-action="self-mark"][data-value="${value}"]`).getAttribute('aria-pressed'), 'true');
}

try {
  await page.goto(base);
  await page.locator('[data-action="skill"]').first().waitFor();
  assert.equal(await page.locator('[data-action="skill"]').count(), 7);
  assert.equal(await page.locator('[data-action="exam"]').count(), 1);
  assert.equal(await page.locator('.hero-art img').evaluate(img => img.complete && img.naturalWidth > 0), true);
  assert.equal(await page.locator('[data-action="chapter"], [data-action="select-answer"], .tf-options').count(), 0);
  await overflow('on the desktop landing page');
  await page.screenshot({ path: '.artifacts/calculations-home-desktop.png', fullPage: true });
  await route('chapters');
  assert.equal(new URL(page.url()).hash, '#skills', 'Old chapter links lead to skills');

  for (const [i, skillId] of skillIds.entries()) {
    await setup(skillId, { difficulty: 'foundation' });
    const first = await current();
    assert.equal(first.ref.skillId, skillId);
    assert.equal(typeof first.question.answer, 'number');
    assert.equal(await page.locator('#numeric-answer').count(), 1);
    assert.equal(await page.locator('[data-action="select-answer"]').count(), 0);
    const value = i === 0 ? `${first.question.answer}/1`
      : i === 1 ? `${first.question.answer * 100}%`
      : i === 2 ? first.formatted.replace('.', ',') : first.formatted;
    await correct(value);
    await click('next');
    const second = await current();
    assert.notEqual(first.ref.seed, second.ref.seed, `${skillId}: the next question has a fresh seed`);
    assert.equal((await session()).index, 1);
  }
  console.log('Passed: seven calculation skills, decimal/fraction/percent/comma input, fresh seeded questions.');

  await setup('bayes', { guided: true });
  await page.locator('.skip-link').focus();
  await page.locator('.skip-link').press('Enter');
  assert.equal(new URL(page.url()).hash, '#practice');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'main');
  const original = await current();
  const attemptsBefore = (await progress()).attempts.length;
  await answer('');
  assert.match(await page.locator('#answer-error').innerText(), /Enter an answer/);
  await answer('not a number');
  assert.match(await page.locator('#answer-error').innerText(), /Use a number/);
  await answer('101%');
  assert.match(await page.locator('#answer-error').innerText(), /between 0 and 1/);
  assert.equal((await progress()).attempts.length, attemptsBefore, 'Invalid input records no attempt');

  const firstStep = page.locator('.guided-step input[data-step="0"]');
  await firstStep.fill('not a number');
  await page.locator('[data-action="check-step"][data-index="0"]').click();
  assert.match(await page.locator('#step-feedback-0').innerText(), /Use a number/);
  await firstStep.fill(original.steps[0]);
  await firstStep.press('Enter');
  assert.equal(await page.locator('#step-feedback-0').innerText(), 'Correct.');
  const pendingAnswer = `${original.question.answer * 100}%`;
  await page.locator('#numeric-answer').fill(pendingAnswer);
  await page.locator('.scratchpad summary').click();
  await page.locator('#scratchpad').fill('Keep the weighted likelihoods unrounded.');
  await click('hint');
  await click('hint');
  assert.equal(await page.locator('.hint-panel strong').count(), 2);
  assert.equal(await page.locator('[data-action="hint"]').isDisabled(), true);
  await click('bookmark');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'bookmark');
  await page.reload();
  await page.locator('.question-card').waitFor();
  assert.deepEqual((await current()).ref, original.ref);
  assert.equal(await page.locator('#numeric-answer').inputValue(), pendingAnswer);
  assert.match(await page.locator('#scratchpad').inputValue(), /unrounded/);
  assert.equal(await firstStep.inputValue(), original.steps[0]);
  assert.equal(await page.locator('#step-feedback-0').innerText(), 'Correct.');
  assert.equal(await page.locator('[data-action="bookmark"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.hint-panel strong').count(), 2);
  await page.screenshot({ path: '.artifacts/calculations-guided.png', fullPage: true });

  await answer(Number(original.formatted) === 0 ? '1' : '0');
  await page.locator('.result-card.incorrect').waitFor();
  assert.equal(await page.locator('.guided-step, .hint-panel').count(), 0, 'Result hides redundant guided fields and hints');
  assert.equal(await page.locator('.intermediate-answers').evaluate(details => details.open), false);
  await page.locator('.intermediate-answers summary').click();
  assert.equal(await page.locator('.intermediate-answers strong').innerText(), original.steps[0]);
  await page.locator('.intermediate-answers summary').click();
  const failed = (await progress()).attempts.at(-1);
  assert.equal(failed.hinted, true);
  assert.equal(failed.method, 'checked');
  await click('pause');
  await page.locator('.resume-banner').waitFor();
  await click('resume');
  await page.locator('.result-card.incorrect').waitFor();
  assert.deepEqual((await current()).ref, original.ref);
  await page.screenshot({ path: '.artifacts/calculations-result.png', fullPage: true });

  await openSaved('review');
  assert.deepEqual((await current()).ref, original.ref, 'Review preserves exactly the failed seed and difficulty');
  assert.equal(await page.locator('.question-context').innerText(), original.question.context);
  await correct();
  await route('progress');
  assert.equal(await page.locator('[data-action="review"]').isDisabled(), true, 'Correct retry removes a question from review');
  await page.reload();
  await openSaved('bookmarks');
  assert.deepEqual((await current()).ref, original.ref, 'Bookmark preserves the original numbers across refresh');
  await click('reveal');
  const selfAttemptCount = (await progress()).attempts.length;
  await selfAssess(true);
  assert.equal((await progress()).attempts.length, selfAttemptCount, 'Self-assessment replaces the same attempt');
  assert.equal((await progress()).attempts.at(-1).method, 'self');
  assert.equal((await progress()).attempts.at(-1).correct, true);
  await click('next');
  assert.equal(await page.locator('h1').innerText(), 'Practice complete');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'summary-title', 'Completing a session focuses its summary');
  assert.equal(await page.locator('.roundup-item').count(), 1);
  console.log('Passed: invalid inputs, guided steps, hints, notes, refresh, pause/resume, exact-seed review/bookmarks, paper self-assessment.');

  await setup('beta', { difficulty: 'practice', length: '5' });
  await correct(); await click('next');
  await click('reveal'); await selfAssess(false); await click('next');
  await click('skip');
  await click('reveal'); await click('next');
  await correct(); await click('next');
  assert.equal(await page.locator('h1').innerText(), 'Practice complete');
  assert.equal(await page.locator('.roundup-item').count(), 5);
  assert.equal((await page.locator('.summary-stats strong').nth(1).innerText()).replace(/\s/g, ''), '2/2');
  assert.equal((await session()).answers.filter(item => item.correct !== true).length, 3);
  await page.screenshot({ path: '.artifacts/calculations-summary.png', fullPage: true });
  await click('review-session'); await click('start');
  assert.equal((await session()).refs.length, 3);
  assert.equal((await session()).mode, 'review');

  await setup('sequences', { difficulty: 'challenge', length: '10' });
  assert.equal((await session()).refs.length, 10);
  const earlyQuestion = await current();
  await click('finish');
  assert.equal((await session()).answers.length, 0, 'Finishing does not mark an untouched answer wrong');
  assert.equal(await page.locator('h1').innerText(), 'Practice complete');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'summary-title', 'Finishing early focuses its summary');
  await click('again'); await page.locator('.question-card').waitFor();
  assert.equal((await session()).refs.length, 10);
  assert.notEqual((await current()).ref.seed, earlyQuestion.ref.seed);

  await setup('prediction', { difficulty: 'challenge', length: 'endless' });
  assert.equal((await session()).length, 0);
  assert.equal(await page.locator('.endless-label').count(), 1);
  const endlessSeed = (await current()).ref.seed;
  await correct(); await click('next');
  await correct(); await click('next');
  assert.equal((await session()).refs.length, 3);
  assert.notEqual((await current()).ref.seed, endlessSeed);
  await click('finish');
  assert.equal(await page.locator('.roundup-item').count(), 2);
  await page.reload();
  assert.equal(await page.locator('h1').innerText(), 'Practice complete');
  console.log('Passed: five/ten-question sessions, early finish, fresh restart, endless generation and summary.');

  await setup('exam', { difficulty: 'challenge', guided: true });
  const exam = await session();
  assert.ok(exam.refs.length >= 4);
  assert.equal(new Set(exam.refs.map(ref => ref.seed)).size, 1);
  assert.deepEqual(exam.refs.map(ref => ref.part), exam.refs.map((_, i) => i));
  for (let i = 0; i < exam.refs.length; i++) {
    const part = await current();
    assert.equal(part.ref.part, i);
    assert.match(await page.locator('.question-count').innerText(), new RegExp(`Part\\s+${i + 1}`));
    assert.equal(await page.locator('.guided-step').count(), part.question.steps.length, 'Guided preference continues into each exam part');
    await correct();
    assert.equal(await page.locator('.guided-step, .intermediate-answers').count(), 0, 'Unfilled guided fields disappear from results');
    if (i === exam.refs.length - 1) await page.screenshot({ path: '.artifacts/calculations-exam.png', fullPage: true });
    await click('next');
  }
  assert.equal(await page.locator('.roundup-item').count(), exam.refs.length);
  assert.ok((await session()).answers.every(item => item.correct));
  await click('again'); await page.locator('.question-card').waitFor();
  assert.notEqual((await current()).ref.seed, exam.refs[0].seed);

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width >= 1000 ? 1080 : 844 });
    await route('home'); await overflow(`on home at ${width}px`);
    await page.screenshot({ path: `.artifacts/calculations-home-${width}.png`, fullPage: true });
    await click('resume'); await page.locator('.question-card').waitFor(); await overflow(`on exam practice at ${width}px`);
    await page.screenshot({ path: `.artifacts/calculations-practice-${width}.png`, fullPage: true });
    await route('progress'); await overflow(`on progress at ${width}px`);
    await page.locator('[data-action="skill"]').first().click(); await overflow(`with setup at ${width}px`);
    assert.equal(await page.locator('#modal').evaluate(dialog => dialog.scrollWidth > dialog.clientWidth), false, `No dialog overflow at ${width}px`);
    await click('close-modal');
  }
  await page.screenshot({ path: '.artifacts/calculations-progress.png', fullPage: true });
  await click('reset'); await page.getByRole('button', { name: 'Keep my progress' }).click();
  assert.ok(await page.locator('.recent-item').count() > 0, 'Cancel reset preserves progress');
  await click('reset'); await click('confirm-reset');
  assert.equal(await page.locator('.recent-item').count(), 0);
  assert.equal(await page.locator('.empty-state').count(), 1);
  assert.deepEqual((await progress()).attempts, []);
  assert.deepEqual((await progress()).bookmarks, []);
  assert.equal(await session(), null);

  for (const path of ['2025/quizzes25.md', '2025/BIPS-Exam-2025.md', 'quizzes/BIPS2026_Q1.pdf', 'docs/quiz-1-2-alignment.md']) {
    assert.equal((await page.request.get(`${base}${path}`)).status(), 404, `Private course source stays outside public site: ${path}`);
  }

  // Saved bookmarks must remain accessible beyond the 100-question review cap.
  const manyBookmarks = await browser.newPage();
  watchErrors(manyBookmarks);
  await manyBookmarks.goto(base);
  const lastBookmark = await manyBookmarks.evaluate(async ({ engineUrl, key }) => {
    const { emptyProgress, makeRef } = await import(engineUrl);
    const saved = emptyProgress();
    saved.bookmarks = Array.from({ length: 201 }, (_, i) => makeRef('probability', 10000 + i, 'foundation'));
    localStorage.setItem(key, JSON.stringify(saved));
    return saved.bookmarks.at(-1);
  }, { engineUrl: `${base}engine.js`, key: PROGRESS_KEY });
  await manyBookmarks.goto(`${base}#progress`);
  await manyBookmarks.reload();
  await manyBookmarks.locator('[data-action="bookmarks"]').click();
  await manyBookmarks.locator('[data-action="start"]').click();
  await manyBookmarks.locator('.question-card').waitFor();
  assert.match(await manyBookmarks.locator('.question-count').innerText(), /201/);
  assert.equal(await manyBookmarks.evaluate(key => JSON.parse(localStorage.getItem(key)).refs.length, SESSION_KEY), 201);
  // Resume immediately before the last bookmark and navigate to it normally.
  await manyBookmarks.evaluate(key => {
    const saved = JSON.parse(localStorage.getItem(key));
    saved.index = 199;
    localStorage.setItem(key, JSON.stringify(saved));
  }, SESSION_KEY);
  await manyBookmarks.reload();
  await manyBookmarks.locator('[data-action="skip"]').click();
  assert.deepEqual(await manyBookmarks.evaluate(key => {
    const saved = JSON.parse(localStorage.getItem(key));
    return saved.refs[saved.index];
  }, SESSION_KEY), lastBookmark);
  assert.match(await manyBookmarks.locator('.question-count').innerText(), /201\s*\/\s*201/);
  await manyBookmarks.close();

  const noStorage = await browser.newPage();
  watchErrors(noStorage);
  await noStorage.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error('Storage disabled'); }; });
  await noStorage.goto(base);
  await noStorage.locator('[data-action="skill"][data-id="probability"]').click();
  await noStorage.locator('[data-action="start"]').click();
  await noStorage.locator('.question-card').waitFor();
  assert.match(await noStorage.locator('.save-label').innerText(), /this tab/);
  await noStorage.locator('[data-action="reveal"]').click();
  assert.equal(await noStorage.locator('.result-card').count(), 1);
  await noStorage.locator('[data-action="next"]').click();
  assert.match(await noStorage.locator('.question-count').innerText(), /Question\s+2/);
  await noStorage.locator('[data-action="finish"]').click();
  assert.match(await noStorage.locator('.local-note').innerText(), /this tab/);
  await noStorage.close();

  assert.deepEqual(errors, [], 'No browser exceptions or console errors');
  console.log('Passed: linked exam, responsive 320/390/768/1440 layouts, reset, source isolation, storage fallback, and console checks.');
  console.log('All Bayesville calculation browser checks passed. Screenshots saved in .artifacts/.');
} catch (error) {
  await page.screenshot({ path: '.artifacts/calculations-failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
