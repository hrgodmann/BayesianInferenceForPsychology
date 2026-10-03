import { skills, difficulties, generateExam, GENERATOR_VERSION } from './questions.js';
import { STORAGE_KEY, SESSION_KEY, emptyProgress, normalizeProgress, recordAttempt, summarize, latestAttempts,
  reviewRefs, gradeAnswer, formatAnswer, restoreSession, makeRef, refKey, questionFor, appendEndlessRef } from './engine.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const skillMap = new Map(skills.map(s => [s.id, s]));
const levelName = id => difficulties.find(d => d.id === id)?.label || 'Practice';
const skillName = id => id === 'exam' ? 'Exam practice' : skillMap.get(id)?.title || 'Review';
const icons = {
  arrow: '<path d="m9 5 7 7-7 7"/>', check: '<path d="m5 12 4 4L19 6"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4V3Z"/>', book: '<path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1m0-14c3-2 6-2 9-1v14c-3-1-6-1-9 1V6Z"/>',
  cycle: '<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
  hint: '<path d="M9 18h6m-6 3h6M8 14a6 6 0 1 1 8 0l-1 2H9l-1-2Z"/>',
  calculator: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 11h1m6 0h1m-8 4h1m6 0h1m-8 4h1m6 0h1"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.calculator}</svg>`;
const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
let storageWorks = true;
let progress = normalizeProgress(read(STORAGE_KEY));
let session = restoreSession(read(SESSION_KEY));
let setup;
let toastTimer;
let modalOpener;
const newSeed = () => globalThis.crypto?.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 4294967296);
const nextSeed = seed => (seed + 0x9e3779b9) >>> 0;
const sessionId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${newSeed()}`;
const currentRef = () => session?.refs[session.index];
const currentQuestion = () => session ? questionFor(currentRef()) : null;
const currentAnswer = () => session?.answers.find(a => a.key === refKey(currentRef()));
const recentAttempts = () => [...latestAttempts(progress).values()].reverse();
const sessionTitle = () => session.mode === 'review' ? 'Saved questions' : skillName(session.skillId);

function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4500);
}
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    if (storageWorks) toast('Your browser could not save progress. You can still practice in this tab.');
    storageWorks = false;
  }
}
function navigate(hash) {
  if (location.hash === `#${hash}`) { render(); window.scrollTo(0, 0); }
  else location.hash = hash;
}
function renderHome() {
  return `<div class="home"><section class="hero" aria-labelledby="welcome-title">
    <div class="hero-copy"><h1 id="welcome-title">Bayesville</h1><p class="hero-lede">Bayesian calculation practice</p></div>
    <figure class="hero-art"><img src="./assets/autumn-village.png" width="1672" height="941" fetchpriority="high" alt="An autumn village in watercolor, with russet leaves, winding paths, and a stone bridge beside a lake."></figure>
    </section><div class="home-content wrap">
    ${session && !session.complete ? `<aside class="resume-banner"><div><strong>Continue practice</strong><span>${esc(sessionTitle())} · ${session.mode === 'exam' ? 'part' : 'question'} ${(session.offset || 0) + session.index + 1}${session.length ? ` of ${session.refs.length}` : ''}</span></div><button class="button small primary" data-action="resume">Continue</button></aside>` : ''}
    <section class="chapter-section" id="skills" aria-labelledby="skills-title"><div class="section-heading"><h2 id="skills-title">Choose a calculation</h2></div>
    <div class="chapter-grid skill-grid">${skills.map((s, i) => `<button class="chapter-card skill-card" data-action="skill" data-id="${s.id}"><span class="card-top"><span class="skill-symbol" aria-hidden="true">${['Σ','P(H | D)','P(D)','α, β','∑ wᵢpᵢ','P(next)','BF'][i]}</span><span class="card-chevron">${icon('arrow')}</span></span><h3>${esc(s.title)}</h3><span class="card-bottom">${esc(s.description)}</span></button>`).join('')}
    <button class="chapter-card skill-card exam-card" data-action="exam"><span class="card-top">${icon('book')}<span class="card-chevron">${icon('arrow')}</span></span><h3>Exam practice</h3><span class="card-bottom">Linked calculations in one fresh scenario.</span></button>
    </div></section></div></div>`;
}
function tableMarkup(table) {
  if (!table) return '';
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="Question data"><table><thead><tr>${table.headers.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${table.rows.map(row => `<tr>${row.map((cell,i) => i ? `<td>${esc(cell)}</td>` : `<th scope="row">${esc(cell)}</th>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function answerHelp(q) {
  return `${q.unit === 'probability' ? 'Probability from 0 to 1' : q.unit === 'ratio' ? 'Ratio' : 'Number'} · ${q.decimals ?? 2} decimal places`;
}
function guidedMarkup(q, revealed) {
  if (!q.steps.length) return '';
  if (revealed) {
    const entered = q.steps.map((step, i) => ({ step, saved: session.steps[i] })).filter(item => item.saved?.input);
    return entered.length ? `<details class="intermediate-answers"><summary>Your intermediate answers</summary><ol>${entered.map(({ step, saved }) => `<li>${esc(step.prompt)}<br><strong>${esc(saved.input)}</strong>${saved.checked && !saved.error ? saved.correct ? ' · Correct' : ' · Needs review' : ''}</li>`).join('')}</ol></details>` : '';
  }
  return `<section class="guided-work"><button class="text-button" data-action="toggle-guided" aria-expanded="${session.guided}" aria-controls="guided-fields">${icon('calculator')} ${session.guided ? 'Hide' : 'Show'} guided steps</button>
  ${session.guided ? `<div id="guided-fields"><p class="input-help">Check each step separately. Use unrounded values in later calculations.</p>${q.steps.map((step, i) => {
    const saved = session.steps[i] || {};
    return `<div class="guided-step"><label for="step-${i}"><span class="step-number">${i + 1}</span>${esc(step.prompt)}</label><div class="step-entry"><input id="step-${i}" data-step="${i}" type="text" inputmode="decimal" autocomplete="off" maxlength="100" value="${esc(saved.input || '')}" aria-describedby="step-help-${i} step-feedback-${i}" ${revealed ? 'disabled' : ''}><button class="button secondary small" data-action="check-step" data-index="${i}" ${revealed ? 'disabled' : ''}>Check step ${i + 1}</button></div><p class="input-help" id="step-help-${i}">${answerHelp(step)}</p><p class="step-feedback ${saved.correct ? 'good' : ''}" id="step-feedback-${i}" role="status">${saved.error ? esc(saved.error) : saved.checked ? saved.correct ? 'Correct.' : 'Not quite. Try again or use a hint.' : ''}</p></div>`;
  }).join('')}</div>` : ''}</section>`;
}
function renderPractice() {
  if (!session) return renderHome();
  if (session.complete) return renderSummary();
  const q = currentQuestion(), result = currentAnswer(), revealed = Boolean(result);
  const marked = progress.bookmarks.some(r => refKey(r) === refKey(currentRef()));
  return `<div class="practice-wrap"><div class="practice-top"><button class="text-button" data-action="pause">${icon('book')} Back to skills</button><span class="save-label">${icon('check')} ${storageWorks ? 'Saved on this device' : 'Kept in this tab'}</span></div>
    <div class="session-heading"><div><p class="eyebrow">${esc(levelName(session.difficulty))}${session.mode === 'exam' ? ' · Linked scenario' : session.mode === 'review' ? ' · Same numbers' : ''}</p><h1>${esc(sessionTitle())}</h1></div><span class="question-count">${session.mode === 'exam' ? 'Part' : 'Question'} <strong>${(session.offset || 0) + session.index + 1}</strong>${session.length ? ` / ${session.refs.length}` : ''}</span></div>
    ${session.length ? `<div class="session-track" role="progressbar" aria-label="Session progress" aria-valuenow="${session.answers.length}" aria-valuemin="0" aria-valuemax="${session.refs.length}"><span style="width:${100 * session.answers.length / session.refs.length}%"></span></div>` : '<p class="endless-label">Endless practice · finish whenever you like</p>'}
    <article class="question-card"><div class="question-meta"><span class="tag">${esc(skillName(q.skillId))}</span><button class="icon-button ${marked ? 'is-bookmarked' : ''}" data-action="bookmark" aria-pressed="${marked}" aria-label="${marked ? 'Remove bookmark' : 'Bookmark this question'}">${icon('bookmark')}</button></div>
    <h2 class="question-title">${esc(q.title)}</h2><p class="question-context">${esc(q.context)}</p>${tableMarkup(q.table)}<p class="question-prompt">${esc(q.prompt)}</p>
    ${guidedMarkup(q, revealed)}
    <form id="answer-form" novalidate><label for="numeric-answer" class="input-label">Your answer <span>${answerHelp(q)}</span></label><div class="numeric-row"><input id="numeric-answer" type="text" inputmode="decimal" autocomplete="off" maxlength="100" value="${esc(session.input)}" placeholder="Enter your answer" ${revealed ? 'disabled' : ''} aria-describedby="answer-help answer-error"><span class="numeric-unit">${q.unit === 'probability' ? 'P' : q.unit === 'ratio' ? 'ratio' : ''}</span></div><p class="input-help" id="answer-help">${q.unit === 'probability' ? 'Decimals, fractions, and percentages work.' : 'Decimals and fractions work.'} Round only your final answer; round an exact halfway value up.</p><p class="answer-error" id="answer-error" role="alert"></p>
    ${!revealed ? `<div class="question-actions"><button class="button primary" type="submit" data-action="check">Check answer ${icon('check')}</button><button class="button ghost" type="button" data-action="hint" ${session.hint >= q.hints.length ? 'disabled' : ''}>${icon('hint')} ${session.hint ? 'Next hint' : 'Show hint'}</button></div>` : ''}</form>
    ${session.hint && !revealed ? `<div class="hint-panel" id="hint-panel" tabindex="-1">${q.hints.slice(0, session.hint).map((h,i) => `<div><strong>${icon('hint')} Hint ${i + 1}</strong><p>${esc(h)}</p></div>`).join('')}</div>` : ''}
    ${!revealed ? `<div class="reveal-row"><button class="text-button" data-action="reveal">Show solution</button><button class="text-button" data-action="skip">Skip question</button></div><details class="scratchpad" ${session.notes ? 'open' : ''}><summary>Working notes</summary><label class="sr-only" for="scratchpad">Your working notes</label><textarea id="scratchpad" rows="4" maxlength="5000" placeholder="Your working…">${esc(session.notes)}</textarea></details>` : ''}
    </article>${revealed ? renderResult(q, result) : ''}
    <div class="finish-row"><button class="text-button" data-action="finish">Finish session</button></div>
    </div>`;
}
function solutionMarkup(q) {
  return `${q.steps.length ? `<div class="worked-solution"><strong>Working</strong><ol>${q.steps.map(step => `<li><span>${esc(step.prompt)}</span><span class="formula">${esc(step.formula)}</span><span class="calculation">${esc(step.working)}${step.working ? '' : ` = ${formatAnswer(step)}`}</span></li>`).join('')}</ol></div>` : ''}<p class="explanation">${esc(q.explanation)}</p>`;
}
function renderResult(q, result) {
  const status = result.correct === null ? 'revealed' : result.correct ? 'correct' : 'incorrect';
  const title = result.method === 'self' ? result.correct ? 'Marked correct' : 'Marked for review' : result.correct === null ? 'Solution' : result.correct ? 'Correct' : 'Not quite';
  return `<section class="result-card ${status}" aria-labelledby="result-title"><div class="result-heading"><span class="result-icon">${icon(result.correct ? 'check' : result.correct === null ? 'book' : 'close')}</span><h2 id="result-title" tabindex="-1">${title}</h2><div class="correct-answer"><span>Answer</span><strong>${formatAnswer(q)}</strong></div></div>
    ${solutionMarkup(q)}<p class="source-note">Reading: ${esc(q.source.label)}</p>
    <details class="self-assessment"><summary>Worked it out on paper?</summary><p>Record how you did. Self-assessments are kept separate from checked answers.</p><div class="self-mark-buttons">${[[true,'I got it right'],[false,'I need more practice']].map(([value,label]) => `<button class="button secondary small ${result.method === 'self' && result.correct === value ? 'selected-mark' : ''}" data-action="self-mark" data-value="${value}" aria-pressed="${result.method === 'self' && result.correct === value}">${label}</button>`).join('')}</div></details>
    <div class="next-row"><button class="button primary" data-action="next">${session.length && session.index === session.refs.length - 1 ? 'View summary' : session.mode === 'exam' ? 'Next part' : 'Next question'} ${icon('arrow')}</button></div></section>`;
}
function renderSummary() {
  const answers = session.answers;
  const checked = answers.filter(a => a.method === 'checked');
  const review = answers.filter(a => a.correct !== true);
  return `<div class="summary-wrap"><p class="eyebrow">${esc(sessionTitle())}</p><h1 id="summary-title" tabindex="-1">Practice complete</h1>
    <div class="summary-stats"><div><strong>${answers.length}</strong><span>Questions practised</span></div><div><strong>${checked.filter(a => a.correct).length}<small> / ${checked.length}</small></strong><span>Checked answers correct</span></div><div><strong>${review.length}</strong><span>To review</span></div></div>
    <p class="local-note">${answers.filter(a => a.method === 'self').length} self-assessed · ${storageWorks ? 'saved on this device' : 'kept in this tab only'}${session.offset ? '. Summary covers the most recent 5,000 questions.' : ''}</p>
    <div class="summary-actions"><button class="button primary" data-action="again">New ${session.mode === 'exam' ? 'scenario' : 'questions'}</button>${review.length ? `<button class="button secondary" data-action="review-session">Review these questions</button>` : ''}<button class="button ghost" data-action="pause">Choose a skill</button></div>
    <section class="roundup"><h2>Your questions</h2>${answers.length > 100 ? '<p class="local-note">Showing the most recent 100 questions.</p>' : ''}${answers.slice(-100).map(a => {
      const ref = session.refs.find(r => refKey(r) === a.key), q = questionFor(ref);
      return `<details class="roundup-item"><summary><span class="roundup-status ${a.correct ? 'good' : ''}">${icon(a.correct ? 'check' : 'cycle')}</span><span>${esc(q.title)}<small>${a.method === 'self' ? 'Self-assessed' : a.method === 'checked' ? a.correct ? 'Correct' : 'Incorrect' : a.method === 'skipped' ? 'Skipped' : 'Solution viewed'}${a.hinted ? ' · Hint used' : ''}</small></span>${icon('arrow')}</summary><div><p>${esc(q.context)}</p>${tableMarkup(q.table)}<p>${esc(q.prompt)}</p><p><strong>Answer: ${formatAnswer(q)}</strong></p>${solutionMarkup(q)}</div></details>`;
    }).join('') || '<p>No answers recorded yet.</p>'}</section></div>`;
}
function renderProgress() {
  const s = summarize(progress), recent = recentAttempts(), review = reviewRefs(progress);
  return `<div class="progress-wrap wrap"><div class="progress-intro"><h1>Your practice</h1><p>Review questions or return to a saved problem.</p></div>
    <div class="progress-stats"><div><span>Attempts</span><strong>${s.attempts}</strong></div><div><span>Checked accuracy</span><strong>${s.checked ? Math.round(100 * s.correct / s.checked) + '%' : '—'}</strong></div><div><span>To review</span><strong>${s.review}</strong></div><div><span>Bookmarked</span><strong>${progress.bookmarks.length}</strong></div></div>
    <div class="progress-actions"><button class="button primary" data-action="review" ${review.length ? '' : 'disabled'}>Review questions (${review.length})</button><button class="button secondary" data-action="bookmarks" ${progress.bookmarks.length ? '' : 'disabled'}>${icon('bookmark')} Bookmarks (${progress.bookmarks.length})</button></div>
    ${!s.attempts ? '<div class="empty-state"><h2>No practice yet</h2><p>Your calculation practice will appear here.</p><button class="text-button" data-action="pause">Choose a skill</button></div>' : `<section class="chapter-log"><h2>By skill</h2>${[...skills, { id: 'exam', title: 'Exam practice' }].map(skill => {
      const stat = summarize(progress, skill.id);
      if (!stat.attempts) return '';
      return `<div class="chapter-log-row"><h3>${esc(skill.title)}</h3><span>${stat.attempts} attempts · ${stat.checked ? `${Math.round(100 * stat.correct / stat.checked)}% checked correct` : 'No checked answers'}</span><button class="button secondary small" data-action="${skill.id === 'exam' ? 'exam' : 'skill'}" data-id="${skill.id}">Practise</button></div>`;
    }).join('')}</section><section class="recent-section"><h2>Recent questions</h2>${recent.slice(0, 12).map((a,i) => `<div class="recent-item"><span class="roundup-status ${a.correct ? 'good' : ''}">${icon(a.correct ? 'check' : 'cycle')}</span><div><strong>${esc(questionFor(a.ref).title)}</strong><span>${esc(skillName(a.ref.skillId))} · ${a.method === 'checked' ? a.correct ? 'Correct' : 'Incorrect' : a.method === 'self' ? a.correct ? 'Self-assessed correct' : 'Self-assessed for review' : a.method === 'skipped' ? 'Skipped' : 'Solution viewed'}</span></div><button class="icon-button" data-action="revisit" data-index="${i}" aria-label="Practise ${esc(questionFor(a.ref).title)} again">${icon('arrow')}</button></div>`).join('')}</section>`}
    <div class="privacy-note"><p>Saved in this browser. Checked accuracy excludes self-assessments and viewed solutions. The most recent 5,000 attempts are kept.</p><button class="text-button reset-link" data-action="reset">Reset progress</button></div></div>`;
}
function render(focus) {
  const scroll = window.scrollY;
  const route = location.hash.slice(1);
  $('#main').innerHTML = route === 'progress' ? renderProgress() : route === 'practice' && session ? renderPractice() : renderHome();
  document.title = `${route === 'progress' ? 'Your practice' : route === 'practice' && session ? sessionTitle() : 'Calculation practice'} · Bayesville`;
  document.querySelectorAll('[data-nav]').forEach(link => {
    if (link.dataset.nav === (route === 'progress' ? 'progress' : 'skills')) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (focus) { window.scrollTo(0, scroll); $(focus)?.focus({ preventScroll: true }); }
}
function showModal(content) {
  modalOpener = document.activeElement;
  $('#modal').innerHTML = `<button class="icon-button modal-close" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button>${content}`;
  $('#modal').showModal();
}
function closeModal() { $('#modal').close(); }
function openSetup(config) {
  setup = config;
  const isExam = config.mode === 'exam', isReview = config.mode === 'review';
  showModal(`<h2 id="modal-title">${isReview ? config.title || 'Review questions' : skillName(isExam ? 'exam' : config.skillId)}</h2>
    <p class="modal-lede">${isExam ? 'One scenario, with linked updates and predictions. Show your working at each part.' : isReview ? `${config.refs.length} saved questions with their original numbers.${config.truncated ? ' Showing the most recent 100; finish these to continue reviewing.' : ''}` : esc(skillMap.get(config.skillId).description)}</p>
    <form id="setup-form"><div class="setup-row">${!isReview ? `<label for="practice-difficulty">Difficulty<select id="practice-difficulty">${difficulties.map(d => `<option value="${d.id}" ${d.id === 'practice' ? 'selected' : ''}>${esc(d.label)}</option>`).join('')}</select></label>` : ''}${!isExam && !isReview ? '<label for="practice-length">Session length<select id="practice-length"><option value="5">5 questions</option><option value="10">10 questions</option><option value="endless">Endless</option></select></label>' : ''}</div>
    ${!isReview ? '<p class="difficulty-help" id="difficulty-help"></p>' : ''}<label class="check-label"><input id="guided-mode" type="checkbox" ${session?.guided ? 'checked' : ''}> Show guided calculation steps</label>
    ${session && !session.complete ? '<p class="replace-note">Starting replaces your current session. Recorded progress stays saved.</p>' : ''}<button class="button primary full" type="submit" data-action="start">Start practice ${icon('arrow')}</button></form>`);
  updateDifficultyHelp();
}
function updateDifficultyHelp() { if ($('#difficulty-help')) $('#difficulty-help').textContent = difficulties.find(d => d.id === $('#practice-difficulty').value)?.description || ''; }
function startSession(config, difficulty = 'practice', length = 5, guided = false) {
  const seed = newSeed();
  let refs;
  if (config.mode === 'exam') refs = generateExam(seed, difficulty).map((_,i) => makeRef('exam', seed, difficulty, i));
  else if (config.mode === 'review') refs = config.refs;
  else { let value = seed; refs = Array.from({ length: length || 1 }, () => { const ref = makeRef(config.skillId, value, difficulty); value = nextSeed(value); return ref; }); }
  if (!refs.length) { toast('There are no questions to review yet.'); return; }
  session = { version: GENERATOR_VERSION, id: sessionId(), mode: config.mode, skillId: config.mode === 'exam' ? 'exam' : config.skillId || 'review', offset: 0,
    difficulty, length: config.mode === 'skill' ? length : refs.length, refs, index: 0, answers: [], input: '', hint: 0, notes: '', steps: [], guided, complete: false };
  persist(); navigate('practice');
}
function saveAnswer(correct, method, raw = session.input) {
  const key = refKey(currentRef());
  const answer = { key, correct, method, raw, hinted: session.hint > 0 };
  session.answers = [...session.answers.filter(a => a.key !== key), answer];
  progress = recordAttempt(progress, { id: `${session.id}:${(session.offset || 0) + session.index}`, ref: currentRef(), correct, method, hinted: answer.hinted, at: new Date().toISOString() });
  persist();
}
function checkAnswer() {
  if (!session || currentAnswer()) return;
  const result = gradeAnswer(currentQuestion(), session.input);
  if (result.error) { $('#answer-error').textContent = result.error; $('#numeric-answer').setAttribute('aria-invalid', 'true'); $('#numeric-answer').focus(); return; }
  saveAnswer(result.correct, 'checked');
  render('#result-title'); $('.result-card').scrollIntoView({ block: 'start' });
}
function nextQuestion() {
  if (!currentAnswer()) saveAnswer(null, 'skipped');
  if (session.length && session.index === session.refs.length - 1) session.complete = true;
  else {
    if (session.index === session.refs.length - 1) session = appendEndlessRef(session, makeRef(session.skillId, nextSeed(currentRef().seed), session.difficulty));
    session.index++; session.input = ''; session.notes = ''; session.hint = 0; session.steps = [];
  }
  persist(); render(); window.scrollTo(0, 0);
  const heading = session.complete ? $('#summary-title') : $('.question-title');
  heading?.setAttribute('tabindex', '-1'); heading?.focus({ preventScroll: true });
}
function beginReview(refs, title = 'Review questions', limit = 100) { openSetup({ mode: 'review', refs: refs.slice(0, limit), title, truncated: refs.length > limit }); }

$('.skip-link').addEventListener('click', e => {
  e.preventDefault();
  $('#main').focus({ preventScroll: true });
  $('#main').scrollIntoView({ block: 'start' });
});
$('#main').addEventListener('input', e => {
  if (!session) return;
  if (e.target.id === 'numeric-answer') { session.input = e.target.value; e.target.removeAttribute('aria-invalid'); $('#answer-error').textContent = ''; }
  if (e.target.id === 'scratchpad') session.notes = e.target.value;
  if (e.target.dataset.step !== undefined) {
    session.steps[Number(e.target.dataset.step)] = { input: e.target.value };
    $(`#step-feedback-${e.target.dataset.step}`).textContent = '';
    e.target.removeAttribute('aria-invalid');
  }
  persist();
});
$('#modal').addEventListener('change', updateDifficultyHelp);
$('#modal').addEventListener('close', () => { if (modalOpener?.isConnected) modalOpener.focus({ preventScroll: true }); });
document.addEventListener('submit', e => {
  if (e.target.id === 'answer-form') { e.preventDefault(); checkAnswer(); }
  if (e.target.id === 'setup-form') {
    e.preventDefault(); const difficulty = $('#practice-difficulty')?.value || 'practice';
    const length = $('#practice-length')?.value === 'endless' ? 0 : Number($('#practice-length')?.value || 5);
    const guided = $('#guided-mode').checked; closeModal(); startSession(setup, difficulty, length, guided);
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset.step !== undefined) { e.preventDefault(); document.querySelector(`[data-action="check-step"][data-index="${e.target.dataset.step}"]`)?.click(); }
});
document.addEventListener('click', e => {
  const button = e.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const { action, id, value, index } = button.dataset;
  if (action === 'skill') openSetup({ mode: 'skill', skillId: id });
  else if (action === 'exam') openSetup({ mode: 'exam' });
  else if (action === 'close-modal') closeModal();
  else if (action === 'pause') navigate('skills');
  else if (action === 'resume') navigate('practice');
  else if (action === 'hint') { session.hint = Math.min(currentQuestion().hints.length, session.hint + 1); persist(); render('#hint-panel'); }
  else if (action === 'toggle-guided') { session.guided = !session.guided; persist(); render('[data-action="toggle-guided"]'); }
  else if (action === 'check-step') {
    const i = Number(index), input = session.steps[i]?.input || '';
    session.steps[i] = { input, checked: true, ...gradeAnswer(currentQuestion().steps[i], input) };
    persist(); render(`#step-${i}`);
  }
  else if (action === 'reveal') { saveAnswer(null, 'revealed'); render('#result-title'); $('.result-card').scrollIntoView({ block: 'start' }); }
  else if (action === 'self-mark') { saveAnswer(value === 'true', 'self'); render('#result-title'); $('.self-assessment').open = true; document.querySelector(`[data-action="self-mark"][data-value="${value}"]`).focus({ preventScroll: true }); }
  else if (action === 'next' || action === 'skip') nextQuestion();
  else if (action === 'finish') { session.complete = true; persist(); render(); window.scrollTo(0, 0); $('#summary-title').focus({ preventScroll: true }); }
  else if (action === 'bookmark') {
    const key = refKey(currentRef()), exists = progress.bookmarks.some(r => refKey(r) === key);
    if (exists) progress.bookmarks = progress.bookmarks.filter(r => refKey(r) !== key);
    else if (progress.bookmarks.length < 500) progress.bookmarks.push(currentRef());
    else { toast('Your 500 bookmarks are full. Remove one to save another question.'); return; }
    persist(); render('[data-action="bookmark"]'); toast(exists ? 'Bookmark removed.' : 'Question bookmarked with these numbers.');
  }
  else if (action === 'again') {
    if (session.mode === 'review') navigate('skills');
    else startSession({ mode: session.mode, skillId: session.skillId }, session.difficulty, session.length, session.guided);
  }
  else if (action === 'review-session') beginReview(session.answers.filter(a => a.correct !== true).map(a => session.refs.find(r => refKey(r) === a.key)));
  else if (action === 'review') beginReview(reviewRefs(progress));
  else if (action === 'bookmarks') beginReview(progress.bookmarks, 'Bookmarked questions', 500);
  else if (action === 'revisit') beginReview([recentAttempts()[Number(index)].ref], 'Practise this question again');
  else if (action === 'reset') showModal('<h2 id="modal-title">Reset calculation progress?</h2><p>This removes your calculation attempts, bookmarks, and current session from this browser.</p><div class="summary-actions"><button class="button secondary" data-action="close-modal">Keep my progress</button><button class="button danger" data-action="confirm-reset">Reset progress</button></div>');
  else if (action === 'confirm-reset') { progress = emptyProgress(); session = null; persist(); closeModal(); render(); toast('Calculation progress reset.'); }
  else if (action === 'about') showModal(`<h2 id="modal-title">Using Bayesville</h2><p>Choose a calculation skill for fresh questions, or practise linked questions in Exam practice. Use guided steps, hints, and working notes whenever you need them.</p><p>Enter a decimal, decimal comma, fraction, or—for probabilities—a percentage. Keep intermediate values unrounded. Round final answers to the precision shown, rounding exact halfway values up.</p><p>After checking an answer, read the worked solution. If you worked on paper, you can record your own result. Viewed, skipped, and incorrect questions are available for review.</p><p>Progress and bookmarks stay in this browser. There are no accounts. Earlier chapter-practice records are kept separately and do not count toward calculation progress.</p>`);
});
window.addEventListener('hashchange', () => {
  if (location.hash === '#chapters') { history.replaceState(null, '', '#skills'); }
  render(); window.scrollTo(0, 0); $('#main').focus({ preventScroll: true });
  if (location.hash === '#skills') $('#skills')?.scrollIntoView({ block: 'start' });
});
if (location.hash === '#chapters') history.replaceState(null, '', '#skills');
render();
