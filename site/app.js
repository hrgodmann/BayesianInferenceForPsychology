import { skills, generateQuestion, generateExam } from './questions.js';
import { gradeAnswer } from './engine.js';
import { renderFormula, renderWorking, renderProse, displayAnswer, isIntegerDisplay } from './math-display.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const skillMap = new Map(skills.map(s => [s.id, s]));
const skillName = id => id === 'exam' ? 'Exam practice' : skillMap.get(id)?.title || '';
const icons = {
  arrow: '<path d="m9 5 7 7-7 7"/>', check: '<path d="m5 12 4 4L19 6"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  book: '<path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1m0-14c3-2 6-2 9-1v14c-3-1-6-1-9 1V6Z"/>',
  cycle: '<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
  hint: '<path d="M9 18h6m-6 3h6M8 14a6 6 0 1 1 8 0l-1 2H9l-1-2Z"/>',
  calculator: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 11h1m6 0h1m-8 4h1m6 0h1m-8 4h1m6 0h1"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.calculator}</svg>`;
// Only the current question (or linked exam scenario) lives in memory.
// Leaving practice or reloading discards it; nothing is read from or saved to browser storage.
let practice = null;
let modalOpener;
let modalScroll;
let calculationOrigin = null;
// Navigation positions are temporary UI state, never saved practice or answers.
// A history entry stores only a key; all positions disappear on reload.
const positions = new Map();
const navigationSession = `${Date.now()}-${Math.random()}`;
let entryNumber = 0, activeEntry = null, renderedHash = null;
history.scrollRestoration = 'manual';
const scrollGap = 24;
const newSeed = () => globalThis.crypto?.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 4294967296);
const nextSeed = seed => (seed + 0x9e3779b9) >>> 0;
const currentQuestion = () => practice?.questions[practice.index];

function scrollToPosition(y, x = 0) {
  // One immediate move: never animate through content from the previous screen.
  window.scrollTo({ left: x, top: y, behavior: 'instant' });
}
function scrollToElement(element) {
  scrollToPosition(window.scrollY + element.getBoundingClientRect().top - scrollGap);
}
function focusElement(element, keyboard = false) {
  if (!element) return;
  if (!element.matches('button, a, input, summary')) element.setAttribute('tabindex', '-1');
  element.classList.toggle('keyboard-focus', keyboard);
  element.focus({ preventScroll: true });
}
function revealIfNeeded(element) {
  const rect = element.getBoundingClientRect();
  if (rect.top < scrollGap || rect.height > window.innerHeight - 2 * scrollGap) scrollToElement(element);
  else if (rect.bottom > window.innerHeight - scrollGap) scrollToPosition(window.scrollY + rect.bottom - window.innerHeight + scrollGap);
}
function rememberPosition() {
  if (!activeEntry) return;
  const saved = positions.get(activeEntry);
  const element = saved?.focus ? $(saved.focus) : null;
  positions.set(activeEntry, { ...saved, x: window.scrollX, y: window.scrollY,
    width: window.innerWidth, height: window.innerHeight,
    ...(element ? { offset: element.getBoundingClientRect().top } : {}) });
}
function restorePosition(position, keyboard) {
  const element = position.focus ? $(position.focus) : null;
  focusElement(element || $('#main'), keyboard);
  // Anchor a return to its card even if the viewport changed while practising.
  if (element && position.offset !== undefined && (position.width !== window.innerWidth || position.height !== window.innerHeight)) scrollToPosition(window.scrollY + element.getBoundingClientRect().top - Math.min(position.offset, window.innerHeight / 2));
  else scrollToPosition(position.y, position.x);
}
function navigate(hash, { keyboard = false, position = null } = {}) {
  rememberPosition();
  if (location.hash !== `#${hash}`) history.pushState(null, '', `#${hash}`);
  routeChanged({ keyboard, position });
}
function renderHome() {
  return `<div class="home"><section class="hero" aria-labelledby="welcome-title">
    <div class="hero-copy"><h1 id="welcome-title">Probability Playground</h1><p class="hero-lede">Bayesian calculation practice</p></div>
    <figure class="hero-art"><img src="./assets/autumn-village.png" width="1672" height="941" fetchpriority="high" alt="An autumn village in watercolor, with an empty wooden playground, a stone bridge, and soft clouds forming Bayes’ rule: P(H given D) equals P(D given H) times P(H), divided by P(D)."></figure>
    </section><div class="home-content wrap">
    <section class="chapter-section" aria-labelledby="skills-title"><div class="section-heading"><h2 id="skills-title">Choose a calculation</h2></div>
    <div class="chapter-grid skill-grid">${skills.map((s, i) => `<button class="chapter-card skill-card" data-action="skill" data-id="${s.id}"><span class="card-top"><span class="skill-symbol" aria-hidden="true">${['Σ','P(H | D)','P(D)','α, β','∑ wᵢpᵢ','P(next)','BF'][i]}</span><span class="card-chevron">${icon('arrow')}</span></span><h3>${esc(s.title)}</h3><span class="card-bottom">${esc(s.description)}</span></button>`).join('')}
    <button class="chapter-card skill-card exam-card" data-action="exam"><span class="card-top">${icon('book')}<span class="card-chevron">${icon('arrow')}</span></span><h3>Exam practice</h3><span class="card-bottom">Linked calculations in one fresh scenario.</span></button>
    </div></section></div></div>`;
}
function tableMarkup(table) {
  if (!table) return '';
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="Question data"><table><thead><tr>${table.headers.map(h => `<th scope="col" data-source="${esc(h)}">${renderProse(h)}</th>`).join('')}</tr></thead><tbody>${table.rows.map(row => `<tr>${row.map((cell,i) => i ? `<td data-source="${esc(cell)}">${renderProse(cell)}</td>` : `<th scope="row" data-source="${esc(cell)}">${renderProse(cell)}</th>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function answerHelp(q) {
  if (isIntegerDisplay(q)) return 'Whole number';
  return `${q.unit === 'probability' ? 'Probability from 0 to 1' : q.unit === 'ratio' ? 'Ratio' : 'Number'} · ${q.decimals ?? 2} decimal places`;
}
function guidedMarkup(q, revealed) {
  if (!q.steps.length) return '';
  if (revealed) {
    const entered = q.steps.map((step, i) => ({ step, saved: practice.steps[i] })).filter(item => item.saved?.input);
    return entered.length ? `<details class="intermediate-answers"><summary>Your intermediate answers</summary><ol>${entered.map(({ step, saved }) => `<li>${renderProse(step.prompt)}<br><strong>${esc(saved.input)}</strong>${saved.checked && !saved.error ? saved.correct ? ' · Correct' : ' · Not quite' : ''}</li>`).join('')}</ol></details>` : '';
  }
  return `<section class="guided-work"><button class="text-button" data-action="toggle-guided" aria-expanded="${practice.guided}" aria-controls="guided-fields">${icon('calculator')} ${practice.guided ? 'Hide' : 'Show'} guided steps</button>
  ${practice.guided ? `<div id="guided-fields"><p class="input-help">Check each step separately. Use unrounded values in later calculations.</p>${q.steps.map((step, i) => {
    const saved = practice.steps[i] || {};
    return `<div class="guided-step"><label for="step-${i}"><span class="step-number">${i + 1}</span><span>${renderProse(step.prompt)}</span></label><div class="step-entry"><input id="step-${i}" data-step="${i}" type="text" inputmode="decimal" autocomplete="off" maxlength="100" value="${esc(saved.input || '')}" aria-describedby="step-help-${i} step-feedback-${i}" ${saved.error ? 'aria-invalid="true"' : ''} ${revealed ? 'disabled' : ''}><button class="button secondary small" data-action="check-step" data-index="${i}" ${revealed ? 'disabled' : ''}>Check step ${i + 1}</button></div><p class="input-help" id="step-help-${i}">${answerHelp(step)}</p><p class="step-feedback ${saved.correct ? 'good' : ''}" id="step-feedback-${i}" role="status">${saved.error ? esc(saved.error) : saved.checked ? saved.correct ? 'Correct.' : 'Not quite. Try again or use a hint.' : ''}</p></div>`;
  }).join('')}</div>` : ''}</section>`;
}
function renderPractice() {
  const q = currentQuestion(), result = practice.result, revealed = Boolean(result);
  return `<div class="practice-wrap"><div class="practice-top"><button class="text-button" data-action="pause">${icon('book')} Back to calculations</button></div>
    <div class="session-heading"><h1>${esc(skillName(practice.skillId))}</h1>${practice.skillId === 'exam' ? `<span class="question-count">Part ${practice.index + 1} of ${practice.questions.length}</span>` : ''}</div>
    <article class="question-card"><h2 class="question-title">${esc(q.title)}</h2><p class="question-context" data-source="${esc(q.context)}">${renderProse(q.context)}</p>${tableMarkup(q.table)}<p class="question-prompt" data-source="${esc(q.prompt)}">${renderProse(q.prompt)}</p>
    ${guidedMarkup(q, revealed)}
    <form id="answer-form" novalidate><label for="numeric-answer" class="input-label">Your answer <span>${answerHelp(q)}</span></label><div class="numeric-row"><input id="numeric-answer" type="text" inputmode="decimal" autocomplete="off" maxlength="100" value="${esc(practice.input)}" placeholder="Enter your answer" ${revealed ? 'disabled' : ''} aria-describedby="answer-help answer-error"><span class="numeric-unit">${q.unit === 'probability' ? 'P' : q.unit === 'ratio' ? 'ratio' : ''}</span></div><p class="input-help" id="answer-help">${isIntegerDisplay(q) ? 'Equivalent decimals and fractions also work.' : `${q.unit === 'probability' ? 'Decimals, fractions, and percentages work.' : 'Decimals and fractions work.'} Round only your final answer; round an exact halfway value up.`}</p><p class="answer-error" id="answer-error" role="alert"></p>
    ${!revealed ? `<div class="question-actions"><button class="button primary" type="submit" data-action="check">Check answer ${icon('check')}</button><button class="button ghost" type="button" data-action="hint" ${practice.hint >= q.hints.length ? 'disabled' : ''}>${icon('hint')} ${practice.hint ? 'Next hint' : 'Show hint'}</button></div>` : ''}</form>
    ${practice.hint && !revealed ? `<div class="hint-panel" id="hint-panel">${q.hints.slice(0, practice.hint).map((h,i) => `<div id="hint-${i}" tabindex="-1"><strong>${icon('hint')} Hint ${i + 1}</strong><p data-source="${esc(h)}">${renderProse(h)}</p></div>`).join('')}</div>` : ''}
    ${!revealed ? `<div class="reveal-row"><button class="text-button" data-action="reveal">Show solution</button><button class="text-button" data-action="skip">${practice.skillId === 'exam' ? 'Skip part' : 'Another question'}</button></div>` : ''}
    </article>${revealed ? renderResult(q, result) : ''}
    </div>`;
}
function solutionMarkup(q) {
  const rounding = isIntegerDisplay(q) ? 'Final answer' : `To ${q.decimals ?? 2} decimal places`;
  const calculation = (step, className) => `<li class="${className}"><span class="solution-step-title">${renderProse(step.prompt)}</span><div class="formula">${renderFormula(step.formula)}</div><div class="calculation">${renderWorking(step.working, step)}</div></li>`;
  return `<div class="worked-solution"><h3>Working</h3><ol>${q.steps.map(step => calculation(step, 'intermediate-calculation')).join('')}${(q.solution.preparation || []).map(step => calculation(step, 'preparation-calculation')).join('')}
    <li class="final-calculation"><span class="solution-step-title">${q.steps.length ? 'Final calculation' : 'Calculate the answer'}</span><div class="formula">${renderFormula(q.solution.formula)}</div><div class="calculation">${renderWorking(q.solution.working, q)}</div><p class="rounding-note">${rounding}: <strong>${displayAnswer(q)}</strong></p></li>
    </ol></div><p class="explanation" data-source="${esc(q.solution.interpretation)}">${renderProse(q.solution.interpretation)}</p>`;
}
function renderResult(q, result) {
  const status = result.correct === null ? 'revealed' : result.correct ? 'correct' : 'incorrect';
  const title = result.correct === null ? 'Solution' : result.correct ? 'Correct' : 'Not quite';
  return `<section class="result-card ${status}" aria-labelledby="result-title"><div class="result-heading"><span class="result-icon">${icon(result.correct ? 'check' : result.correct === null ? 'book' : 'close')}</span><h2 id="result-title" tabindex="-1">${title}</h2></div>
    <div class="answer-comparison">${practice.input.trim() ? `<div class="submitted-answer"><span>${result.correct === null ? 'Your entry (unchecked)' : 'Your answer'}</span><strong>${esc(practice.input)}</strong></div>` : ''}<div class="correct-answer"><span>Correct answer</span><strong>${displayAnswer(q)}</strong></div></div>
    ${solutionMarkup(q)}<p class="source-note">Reading: ${esc(q.source.label)}</p>
    <div class="next-row"><button class="button primary" data-action="next">${practice.skillId === 'exam' ? practice.index === practice.questions.length - 1 ? 'New scenario' : 'Next part' : 'Another question'} ${icon('arrow')}</button></div></section>`;
}
function render(focus, anchor = focus) {
  const scroll = window.scrollY;
  const offset = anchor ? $(anchor)?.getBoundingClientRect().top : undefined;
  const inPractice = location.hash === '#practice' && practice;
  $('#main').innerHTML = inPractice ? renderPractice() : renderHome();
  labelScrollableMath();
  document.title = `${inPractice ? skillName(practice.skillId) : 'Calculation practice'} · Probability Playground`;
  if (focus) {
    focusElement($(focus));
    const element = anchor ? $(anchor) : null;
    scrollToPosition(element && offset !== undefined ? window.scrollY + element.getBoundingClientRect().top - offset : scroll);
  }
}
function labelScrollableMath() {
  for (const element of document.querySelectorAll('.math-block')) {
    const scrollable = element.scrollWidth > element.clientWidth + 1;
    if (scrollable) {
      element.setAttribute('tabindex', '0');
      element.setAttribute('role', 'region');
      element.setAttribute('aria-label', 'Equation; scroll horizontally to read all of it');
    } else {
      element.removeAttribute('tabindex');
      element.removeAttribute('role');
      element.removeAttribute('aria-label');
    }
  }
}
function showModal(content) {
  modalOpener = document.activeElement;
  modalScroll = window.scrollY;
  $('#modal').innerHTML = `<button class="icon-button modal-close" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button>${content}`;
  document.documentElement.classList.add('dialog-open');
  $('#modal').showModal();
  scrollToPosition(modalScroll);
}
function resetInputs() {
  practice.input = ''; practice.hint = 0; practice.steps = []; practice.result = null;
}
function focusQuestion(keyboard) {
  const heading = $('.question-title');
  // Retain the reading/Tab starting point without making a mouse-opened
  // heading look selected. Keyboard and assistive activation keep an outline.
  focusElement(heading, keyboard);
  scrollToElement($('.question-card'));
}
function startPractice(skillId, keyboard) {
  const selector = skillId === 'exam' ? '[data-action="exam"]' : `[data-action="skill"][data-id="${skillId}"]`;
  calculationOrigin = { x: window.scrollX, y: window.scrollY, width: window.innerWidth, height: window.innerHeight, focus: selector, offset: $(selector).getBoundingClientRect().top };
  positions.set(activeEntry, { ...positions.get(activeEntry), ...calculationOrigin });
  const seed = newSeed();
  practice = { skillId, seed, questions: skillId === 'exam' ? generateExam(seed) : [generateQuestion(skillId, seed)], index: 0, guided: false };
  resetInputs(); navigate('practice', { keyboard });
  positions.set(activeEntry, { ...positions.get(activeEntry), origin: calculationOrigin });
}
function showResult(correct) {
  practice.result = { correct };
  render(); focusElement($('#result-title')); scrollToElement($('.result-card'));
}
function checkAnswer() {
  if (!practice || practice.result) return;
  const result = gradeAnswer(currentQuestion(), practice.input);
  if (result.error) { $('#answer-error').textContent = result.error; $('#numeric-answer').setAttribute('aria-invalid', 'true'); $('#numeric-answer').focus(); return; }
  showResult(result.correct);
}
function nextQuestion(keyboard) {
  if (practice.skillId === 'exam' && practice.index < practice.questions.length - 1) practice.index++;
  else {
    practice.seed = nextSeed(practice.seed);
    practice.questions = practice.skillId === 'exam' ? generateExam(practice.seed) : [generateQuestion(practice.skillId, practice.seed)];
    practice.index = 0;
  }
  resetInputs(); render();
  focusQuestion(keyboard);
}

$('.skip-link').addEventListener('click', e => {
  e.preventDefault(); focusElement($('#main')); scrollToElement($('#main'));
});
$('#main').addEventListener('input', e => {
  if (!practice) return;
  if (e.target.id === 'numeric-answer') { practice.input = e.target.value; e.target.removeAttribute('aria-invalid'); $('#answer-error').textContent = ''; }
  if (e.target.dataset.step !== undefined) {
    practice.steps[Number(e.target.dataset.step)] = { input: e.target.value };
    $(`#step-feedback-${e.target.dataset.step}`).textContent = ''; e.target.removeAttribute('aria-invalid');
  }
});
$('#modal').addEventListener('close', () => {
  document.documentElement.classList.remove('dialog-open');
  if (modalOpener?.isConnected) modalOpener.focus({ preventScroll: true });
  if (modalScroll !== null) scrollToPosition(modalScroll);
});
document.addEventListener('submit', e => {
  if (e.target.id === 'answer-form') { e.preventDefault(); checkAnswer(); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset.step !== undefined) { e.preventDefault(); document.querySelector(`[data-action="check-step"][data-index="${e.target.dataset.step}"]`)?.click(); }
});
document.addEventListener('click', e => {
  const link = e.target.closest('a[href="#home"], a[href="#skills"]');
  if (link && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
    e.preventDefault(); navigate(link.hash.slice(1), { keyboard: e.detail === 0 }); return;
  }
  const button = e.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const { action, id, index } = button.dataset;
  if (action === 'skill') startPractice(id, e.detail === 0);
  else if (action === 'exam') startPractice('exam', e.detail === 0);
  else if (action === 'close-modal') $('#modal').close();
  else if (action === 'pause') navigate('skills', { keyboard: e.detail === 0, position: calculationOrigin });
  else if (action === 'about') showModal(`<h2 id="modal-title">Using Probability Playground</h2><p>Choose a calculation, enter your answer, and check the worked solution. Use hints or guided steps whenever you need them.</p><p>Decimals, decimal commas, and fractions work; probabilities also accept percentages. Keep intermediate values unrounded and round your final answer to the precision shown.</p><p>Choose another question for fresh numbers. Exam practice links five calculations in one scenario.</p>`);
  else if (!practice) return;
  else if (action === 'hint') {
    practice.hint = Math.min(currentQuestion().hints.length, practice.hint + 1);
    const selector = `#hint-${practice.hint - 1}`;
    render(selector, '[data-action="hint"]'); revealIfNeeded($(selector));
  }
  else if (action === 'toggle-guided') { practice.guided = !practice.guided; render('[data-action="toggle-guided"]'); }
  else if (action === 'check-step') {
    const i = Number(index), input = practice.steps[i]?.input || '';
    practice.steps[i] = { input, checked: true, ...gradeAnswer(currentQuestion().steps[i], input) };
    render(`#step-${i}`);
  }
  else if (action === 'reveal') showResult(null);
  else if (action === 'next' || action === 'skip') nextQuestion(e.detail === 0);
});
function routeChanged({ keyboard = false, position = null, restore = false } = {}) {
  if ($('#modal').open) {
    // Browser Back can navigate while a dialog is open. Its queued close event
    // must not restore the old screen's scroll or focus after the new render.
    modalOpener = null; modalScroll = null;
    $('#modal').close();
    document.documentElement.classList.remove('dialog-open');
  }
  activeEntry = history.state?.playgroundNavigation;
  if (!positions.has(activeEntry)) {
    activeEntry = `${navigationSession}-${++entryNumber}`;
    history.replaceState({ playgroundNavigation: activeEntry }, '');
    positions.set(activeEntry, {});
  }
  if (['#chapters', '#progress'].includes(location.hash)) history.replaceState(history.state, '', '#skills');
  if (location.hash !== '#practice') practice = null;
  if (location.hash === '#practice' && !practice) {
    // Discarded questions stay discarded; an old practice link returns to its list.
    position = positions.get(activeEntry).origin || calculationOrigin;
    restore = false;
    history.replaceState(history.state, '', '#skills');
  }
  renderedHash = location.hash;
  render();
  const saved = position || (restore ? positions.get(activeEntry) : null);
  if (saved?.y !== undefined) {
    restorePosition(saved, keyboard);
    positions.set(activeEntry, { ...positions.get(activeEntry), ...saved });
  }
  else if (location.hash === '#practice') focusQuestion(keyboard);
  else if (location.hash === '#skills') { focusElement($('#skills-title'), keyboard); scrollToElement($('#skills-title')); }
  else { focusElement($('#main')); scrollToPosition(0); }
  rememberPosition();
}
function historyChanged() {
  // A history traversal emits popstate and hashchange. Handle it only once.
  if (history.state?.playgroundNavigation === activeEntry && location.hash === renderedHash) return;
  routeChanged({ restore: true });
}
window.addEventListener('scroll', () => {
  if (location.hash === renderedHash && history.state?.playgroundNavigation === activeEntry) rememberPosition();
}, { passive: true });
window.addEventListener('popstate', historyChanged);
window.addEventListener('hashchange', historyChanged);
window.addEventListener('resize', labelScrollableMath);
// Load the locally hosted math fonts before the first reading position is set.
// Later question/answer renders then have their final size immediately.
if (document.fonts) await Promise.all([
  '1em KaTeX_Main', 'italic 1em KaTeX_Math', '1em KaTeX_Size1',
  '1em KaTeX_Size2', '1em KaTeX_Size3', '1em KaTeX_Size4', '1em KaTeX_AMS',
].map(font => document.fonts.load(font))).catch(() => {});
routeChanged();
