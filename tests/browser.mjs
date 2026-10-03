// Optional browser QA. Start npm run dev first, and set BAYESVILLE_PLAYWRIGHT_MODULE
// and BAYESVILLE_CHROMIUM when Playwright or Chromium are outside normal paths.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { generateQuestion, generateExam } from '../site/questions.js';
import { formatAnswer } from '../site/engine.js';

const { chromium } = await import(process.env.BAYESVILLE_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BAYESVILLE_URL || 'http://127.0.0.1:4173/BayesianInferenceForPsychology/';
const browser = await chromium.launch({ headless: true, ...(process.env.BAYESVILLE_CHROMIUM ? { executablePath: process.env.BAYESVILLE_CHROMIUM } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const skillIds = ['probability', 'bayes', 'sequences', 'beta', 'mixtures', 'prediction', 'bayes-factors'];
const initialSeed = 0x12345678;
const seedStep = 0x9e3779b9;
const errors = [];
const requests = [];
page.setDefaultTimeout(10000);
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('request', request => requests.push(request.url()));
await mkdir('.artifacts', { recursive: true });

await page.addInitScript(({ initialSeed, seedStep }) => {
  // Seed legacy records before installing spies. Any application access after this
  // setup is an error, including an access hidden inside a try/catch fallback.
  try {
    const ref = { version: 2, skillId: 'bayes', seed: 42, difficulty: 'practice' };
    localStorage.setItem('bayesville.calculations.progress.v2', JSON.stringify({ version: 2, attempts: [{ id: 'legacy:0', ref, correct: false, method: 'checked', hinted: false, at: '2025-01-01T12:00:00Z' }], bookmarks: [ref] }));
    localStorage.setItem('bayesville.calculations.session.v2', JSON.stringify({ version: 2, id: 'legacy', mode: 'skill', skillId: 'bayes', difficulty: 'practice', length: 5, refs: [ref], index: 0, answers: [], input: '0.12345', hint: 2, steps: [], guided: true, complete: false }));
    sessionStorage.setItem('bayesville.previous', 'old practice');
  } catch {}
  const accesses = [];
  Object.defineProperty(window, '__qaStorageAccesses', { get: () => [...accesses] });
  for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, {
    configurable: true, get() { accesses.push(name); throw new Error(`Storage access forbidden in stateless practice: ${name}`); },
  });
  for (const name of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) Object.defineProperty(Storage.prototype, name, {
    configurable: true, value() { accesses.push(name); throw new Error(`Storage API forbidden: ${name}`); },
  });
  let seed = initialSeed;
  Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value(array) {
    for (let i = 0; i < array.length; i++) { array[i] = seed; seed = (seed + seedStep) >>> 0; }
    return array;
  } });
}, { initialSeed, seedStep });

const click = action => page.locator(`[data-action="${action}"]`).click();
async function noStorage() {
  assert.deepEqual(await page.evaluate(() => window.__qaStorageAccesses), [], 'Application never accesses localStorage or sessionStorage');
}
async function home(hash = 'skills') {
  if (page.url().startsWith(base)) await noStorage();
  await page.goto(`${base}#${hash}`);
  await page.locator('[data-action="skill"]').first().waitFor();
  assert.equal(await page.locator('.question-card').count(), 0);
}
async function open(skillId) {
  await home();
  await page.locator(skillId === 'exam' ? '[data-action="exam"]' : `[data-action="skill"][data-id="${skillId}"]`).click();
  await page.locator('.question-card').waitFor();
  assert.equal(await page.locator('#setup-form, #practice-difficulty, #practice-length').count(), 0, 'Card opens a question directly');
}
async function current(skillId, part = 0) {
  const context = await page.locator('.question-context').innerText();
  const prompt = await page.locator('.question-prompt').innerText();
  const title = await page.locator('.question-title').innerText();
  const cells = await page.locator('.question-card tbody tr').evaluateAll(rows => rows.map(row => [...row.cells].map(cell => cell.textContent.trim())));
  // Match the visible question to the controlled seed stream. This reads no app
  // internals; the expected numerical answer comes from the public generator API.
  let seed = initialSeed;
  for (let i = 0; i < 80; i++) {
    const question = skillId === 'exam' ? generateExam(seed)[part] : generateQuestion(skillId, seed);
    if (question.context === context && question.prompt === prompt && question.title === title) {
      if (JSON.stringify(cells) !== JSON.stringify(question.table?.rows.map(row => row.map(String)) || [])) { seed = (seed + seedStep) >>> 0; continue; }
      return { question, seed, formatted: formatAnswer(question), steps: question.steps.map(formatAnswer) };
    }
    seed = (seed + seedStep) >>> 0;
  }
  assert.fail(`Visible ${skillId} question does not match its deterministic generated inputs: ${prompt}`);
}
async function answer(value) {
  await page.locator('#numeric-answer').fill(String(value));
  await page.locator('#answer-form button[type="submit"]').click();
}
async function correct(skillId, part = 0, value) {
  const data = await current(skillId, part);
  await answer(value ?? data.formatted);
  await page.locator('.result-card.correct').waitFor();
  assert.equal(await page.locator('.correct-answer strong').innerText(), data.formatted);
  assert.ok((await page.locator('.explanation').innerText()).length > 20);
  assert.equal(await page.locator('.worked-solution li').count(), data.question.steps.length);
  return data;
}
async function overflow(label) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `No horizontal page overflow: ${label}`);
}
async function simplifiedControls() {
  assert.equal(await page.locator('[data-action="bookmark"], [data-action="bookmarks"], [data-action="review"], [data-action="self-mark"], [data-action="reset"], [data-action="resume"], [data-action="finish"], .resume-banner, .summary-wrap, .progress-stats, .save-label, #practice-difficulty, #practice-length, #setup-form, #scratchpad').count(), 0);
  assert.equal(await page.locator('[data-nav="progress"]').count(), 0);
}

try {
  await home();
  assert.equal(await page.locator('[data-action="skill"]').count(), 7);
  assert.equal(await page.locator('[data-action="exam"]').count(), 1);
  assert.equal(await page.locator('.hero-art img').evaluate(img => img.complete && img.naturalWidth > 0), true);
  await simplifiedControls();
  await overflow('desktop home');
  await page.screenshot({ path: '.artifacts/simplified-home-desktop.png', fullPage: true });
  for (const hash of ['chapters', 'progress', 'practice']) {
    await home(hash);
    assert.equal(new URL(page.url()).hash, '#skills', `Old or empty #${hash} route returns to skills`);
  }

  for (const [i, skillId] of skillIds.entries()) {
    await open(skillId);
    const first = await current(skillId);
    assert.equal(await page.locator('.question-count').count(), 0, 'Ordinary practice has no running question counter');
    assert.equal(await page.locator('#numeric-answer').count(), 1);
    assert.equal(await page.locator('.tf-options, [data-action="select-answer"]').count(), 0);
    if (skillId === 'bayes') await page.screenshot({ path: '.artifacts/simplified-question-desktop.png', fullPage: true });
    const value = i === 0 ? `${first.question.answer}/1` : i === 1 ? `${first.question.answer * 100}%` : i === 2 ? first.formatted.replace('.', ',') : first.formatted;
    await correct(skillId, 0, value);
    await click('next');
    assert.equal(await page.locator('.result-card').count(), 0);
    assert.equal(await page.locator('#numeric-answer').inputValue(), '');
    assert.notEqual((await current(skillId)).seed, first.seed, `${skillId}: another question has fresh inputs`);
    await simplifiedControls();
    await noStorage();
  }
  console.log('Passed: seven direct-entry skills, answer formats, fresh questions, and minimal controls.');

  await open('bayes');
  await page.locator('.skip-link').focus();
  await page.locator('.skip-link').press('Enter');
  assert.equal(new URL(page.url()).hash, '#practice');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'main');
  const guidedQuestion = await current('bayes');
  await answer('');
  assert.match(await page.locator('#answer-error').innerText(), /Enter an answer/);
  await answer('not a number');
  assert.match(await page.locator('#answer-error').innerText(), /Use a number/);
  await answer('101%');
  assert.match(await page.locator('#answer-error').innerText(), /between 0 and 1/);
  assert.equal(await page.locator('.result-card').count(), 0);
  await click('toggle-guided');
  const firstStep = page.locator('[data-step="0"]');
  await firstStep.fill('not a number');
  await page.locator('[data-action="check-step"][data-index="0"]').click();
  assert.match(await page.locator('#step-feedback-0').innerText(), /Use a number/);
  assert.equal(await firstStep.getAttribute('aria-invalid'), 'true', 'Invalid guided input is exposed to assistive technology');
  await firstStep.fill(guidedQuestion.steps[0]);
  assert.notEqual(await firstStep.getAttribute('aria-invalid'), 'true', 'Editing clears guided validation state');
  await firstStep.press('Enter');
  assert.equal(await page.locator('#step-feedback-0').innerText(), 'Correct.');
  await click('hint'); await click('hint');
  assert.equal(await page.locator('.hint-panel strong').count(), 2);
  assert.equal(await page.locator('[data-action="hint"]').isDisabled(), true);
  await page.screenshot({ path: '.artifacts/simplified-guided.png', fullPage: true });
  await answer(Number(guidedQuestion.formatted) === 0 ? '1' : '0');
  await page.locator('.result-card.incorrect').waitFor();
  assert.equal(await page.locator('.correct-answer strong').innerText(), guidedQuestion.formatted);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'result-title');
  await page.screenshot({ path: '.artifacts/simplified-result.png', fullPage: true });
  await simplifiedControls();

  await open('bayes');
  await page.locator('#numeric-answer').fill('0.12345');
  await click('toggle-guided');
  await page.locator('[data-step="0"]').fill('1/3');
  await click('toggle-guided');
  await click('hint');
  assert.equal(await page.locator('#numeric-answer').inputValue(), '0.12345', 'Hints and guided toggles retain the draft final answer');
  await click('toggle-guided');
  assert.equal(await page.locator('[data-step="0"]').inputValue(), '1/3', 'Hidden guided drafts are retained');
  await click('about');
  assert.equal(await page.locator('#modal').evaluate(dialog => dialog.open), true);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'close-modal');
  await page.keyboard.press('Tab');
  // Chromium may briefly hand focus to browser chrome after the only dialog
  // control. Background page controls must remain unreachable while modal.
  assert.equal(await page.locator('#modal').evaluate(dialog => dialog.contains(document.activeElement) || document.activeElement === document.body), true, 'Help prevents focus from reaching background page controls');
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#modal').evaluate(dialog => dialog.contains(document.activeElement)), true, 'Tab returns to the modal control');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#modal').evaluate(dialog => dialog.open), false);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'about', 'Escape returns focus to Help');
  assert.equal(await page.locator('#numeric-answer').inputValue(), '0.12345', 'Help preserves the draft answer');
  await click('reveal');
  await page.locator('.result-card.revealed').waitFor();
  assert.equal(await page.locator('#result-title').innerText(), 'Solution', 'Revealing does not imply the student answered incorrectly');
  assert.equal(await page.locator('#numeric-answer').isDisabled(), true);
  assert.equal(await page.locator('.guided-work, [data-action="check"], [data-action="hint"]').count(), 0);
  assert.equal(await page.locator('.intermediate-answers').count(), 1, 'The revealed solution retains the student’s intermediate draft for comparison');
  await click('next');
  assert.equal(await page.locator('#numeric-answer').inputValue(), '');
  assert.equal(await page.locator('.hint-panel, .intermediate-answers, .result-card').count(), 0);
  console.log('Passed: draft retention, Help keyboard focus, answer reveal, and clean next-question state.');

  await open('bayes-factors');
  assert.doesNotMatch(await page.locator('#answer-help').innerText(), /percentages work/);
  await answer('50%');
  assert.match(await page.locator('#answer-error').innerText(), /without a percent sign/);
  assert.equal(await page.locator('.result-card').count(), 0);
  const ratioQuestion = await current('bayes-factors');
  await page.locator('#numeric-answer').fill(ratioQuestion.formatted);
  await page.locator('#numeric-answer').press('Enter');
  await page.locator('.result-card.correct').waitFor();

  await click('pause');
  await page.locator('[data-action="skill"]').first().waitFor();
  assert.equal(await page.locator('.resume-banner').count(), 0);
  await page.evaluate(() => { location.hash = 'practice'; });
  await page.waitForURL('**/#skills');
  assert.equal(await page.locator('.question-card').count(), 0, 'Leaving practice clears the in-memory question');
  await page.locator('[data-action="skill"][data-id="bayes"]').click();
  await page.locator('#numeric-answer').fill('0.12345');
  await click('hint');
  await noStorage();
  await page.reload();
  await page.locator('[data-action="skill"]').first().waitFor();
  assert.equal(new URL(page.url()).hash, '#skills');
  assert.equal(await page.locator('.question-card, .resume-banner').count(), 0, 'Reload restores no old or current session');
  await page.locator('[data-action="skill"][data-id="bayes"]').click();
  assert.equal(await page.locator('#numeric-answer').inputValue(), '');
  assert.equal(await page.locator('.hint-panel, .result-card').count(), 0);
  const skipped = await current('bayes');
  await click('skip');
  assert.notEqual((await current('bayes')).seed, skipped.seed);
  assert.equal(await page.locator('.result-card, .summary-wrap').count(), 0);
  console.log('Passed: validation, guided checks, hints, worked feedback, skip, and clearing on leave/reload.');

  await open('exam');
  const originalExam = await current('exam', 0);
  for (let part = 0; part < 5; part++) {
    const expected = await current('exam', part);
    assert.equal(expected.seed, originalExam.seed);
    assert.equal(await page.locator('.question-card tbody tr').count(), 3, 'Exam uses two fixed-rate models and one beta model');
    assert.match(await page.locator('.question-count').innerText(), new RegExp(`Part\\s+${part + 1}`));
    await correct('exam', part);
    assert.match(await page.locator('[data-action="next"]').innerText(), part === 4 ? /New scenario/ : /Next part/);
    if (part === 4) await page.screenshot({ path: '.artifacts/simplified-exam-result.png', fullPage: true });
    await click('next');
  }
  assert.notEqual((await current('exam', 0)).seed, originalExam.seed);
  assert.equal(await page.locator('.summary-wrap').count(), 0, 'A new scenario replaces a finished exam without a summary');
  await click('skip');
  await current('exam', 1);
  await noStorage();
  console.log('Passed: five linked exam parts, shared inputs, skip-part, and fresh scenario restart.');

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width >= 1000 ? 1080 : 844 });
    await home(); await overflow(`home at ${width}px`);
    await page.screenshot({ path: `.artifacts/simplified-home-${width}.png`, fullPage: true });
    await page.locator('[data-action="exam"]').click();
    await page.locator('.question-card').waitFor();
    await overflow(`exam question at ${width}px`);
    await page.screenshot({ path: `.artifacts/simplified-practice-${width}.png`, fullPage: true });
    await click('reveal');
    await page.locator('.result-card').waitFor();
    await overflow(`worked solution at ${width}px`);
    await simplifiedControls();
    if (width === 320 || width === 1440) await page.screenshot({ path: `.artifacts/simplified-solution-${width}.png`, fullPage: true });
  }

  // Reproduce numerical boundary cases through the public input controls. The
  // expected answers are independently known values, not app-generated strings.
  for (const item of [
    { seed: 117, skill: 'prediction', step: 1, places: 2, incorrect: '0.12', correct: '0.13' },
    { seed: 76, skill: 'sequences', step: 0, places: 6, incorrect: '0', correct: '0.000013' },
  ]) {
    await home();
    await page.evaluate(seed => Object.defineProperty(crypto, 'getRandomValues', {
      configurable: true, value(array) { array.fill(seed); return array; },
    }), item.seed);
    await page.locator(`[data-action="skill"][data-id="${item.skill}"]`).click();
    await page.locator('.question-card').waitFor();
    await click('toggle-guided');
    assert.match(await page.locator(`#step-help-${item.step}`).innerText(), new RegExp(`${item.places} decimal places`));
    const field = page.locator(`#step-${item.step}`);
    await field.fill(item.incorrect);
    await field.press('Enter');
    assert.match(await page.locator(`#step-feedback-${item.step}`).innerText(), /Not quite/);
    await field.fill(item.correct);
    await field.press('Enter');
    assert.equal(await page.locator(`#step-feedback-${item.step}`).innerText(), 'Correct.');
    if (item.seed === 76) {
      assert.match(await page.locator('label[for="numeric-answer"]').innerText(), /4 decimal places/);
      await answer('0.9996');
      await page.locator('.result-card.correct').waitFor();
    }
  }
  console.log('Passed: exact-half rounding and nonzero display/grading for tiny guided probabilities.');

  for (const path of ['2025/quizzes25.md', '2025/BIPS-Exam-2025.md', 'quizzes/BIPS2026_Q1.pdf', 'syllabus/syllabusWeek1-4.md', 'docs/course-material-map.md', 'docs/quiz-1-2-alignment.md', 'README.md', '.git/config', '%2e%2e%2fREADME.md']) {
    for (const prefix of [base, `${new URL(base).origin}/`]) {
      assert.equal((await page.request.get(`${prefix}${path}`)).status(), 404, `Private course source stays outside the public site: ${prefix}${path}`);
    }
  }
  await noStorage();
  assert.deepEqual(await page.context().cookies(), [], 'Practice creates no cookies');
  assert.deepEqual(requests.filter(url => new URL(url).origin !== new URL(base).origin), [], 'Practice makes no third-party requests');
  assert.deepEqual(errors, [], 'No browser exceptions or console errors');
  console.log('Passed: responsive 320/390/768/1440 layouts, source isolation, and no storage access.');
  console.log('All simplified Bayesville browser checks passed. Screenshots saved in .artifacts/.');
} catch (error) {
  await page.screenshot({ path: '.artifacts/simplified-failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
