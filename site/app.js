import { chapters, questions } from './questions.js';
import { STORAGE_KEY, SESSION_KEY, emptyProgress, normalizeProgress, recordAttempt, selectQuestions,
  shuffle, summarize, latestAttempts, gradeAnswer, formatAnswer, restoreSession } from './engine.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bank = new Map(questions.map(q => [q.id, q]));
const chapterMap = new Map(chapters.map(ch => [ch.id, ch]));
const ids = questions.map(q => q.id);
const icons = {
  book: '<path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1m0-14c3-2 6-2 9-1v14c-3-1-6-1-9 1V6Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4V3Z"/>',
  cycle: '<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
  mind: '<path d="M9 20v-3c-3-1-5-3-5-7a8 8 0 0 1 16 0v3l-3 1v6M8 10h.01M12 10h.01M16 10h.01"/>',
  uncertainty: '<path d="M4 17h16M6 17V9m6 8V4m6 13v-5M4 9h4m2-5h4m2 8h4"/>',
  calculator: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 11h1m6 0h1m-8 4h1m6 0h1m-8 4h1m6 0h1"/>',
  ruler: '<path d="m3 16 13-13 5 5L8 21l-5-5Zm5-5 3 3m1-7 3 3"/>',
  coherence: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  hint: '<path d="M9 18h6m-6 3h6M8 14a6 6 0 1 1 8 0l-1 2H9l-1-2Z"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  leaf: '<path d="M20 3C9 2 2 9 6 16c7 4 14-3 14-13ZM4 20 15 9"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>'
};
function icon(name, cls = '') { return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.book}</svg>`; }
let storageWorks = true;
function read(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
let progress = normalizeProgress(read(STORAGE_KEY), ids);
let session = restoreSession(read(SESSION_KEY), questions);
let week = 'all';
let setup = null;
let toastTimer;

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
function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4500);
}
function navigate(hash) {
  if (location.hash === `#${hash}`) render();
  else location.hash = hash;
}
function currentQuestion() { return session ? bank.get(session.ids[session.index]) : null; }
function currentAnswer() { return session?.answers.find(a => a.questionId === currentQuestion()?.id); }
function chapterTitle(id) { return id === 'all' ? 'A little bit of everything' : chapterMap.get(id)?.title || 'Practice'; }
function typeName(type) { return type === 'tf' ? 'True or false' : type === 'calculation' ? 'Calculations' : 'Mixed practice'; }
function counts(list) { return { tf: list.filter(q => q.type === 'tf').length, calculation: list.filter(q => q.type === 'calculation').length }; }

function renderHome() {
  const stats = summarize(progress, ids);
  const subset = chapters.filter(ch => week === 'all' || String(ch.week) === week);
  return `<div class="home wrap">
    <section class="hero" aria-labelledby="welcome-title">
      <div class="hero-copy"><p class="eyebrow"><span class="tiny-line"></span>BAYESIAN INFERENCE FOR PSYCHOLOGY</p>
        <h1 id="welcome-title">A little practice.<br>A clearer <span>picture.</span></h1>
        <p class="hero-lede">Welcome to Bayesville. A friendly little place to build your Bayesian intuition, one question at a time.</p>
        <div class="hero-actions"><a class="button primary" href="#chapters">Find your chapter ${icon('book')}</a><button class="button secondary" data-action="surprise">Surprise me ${icon('spark')}</button></div>
        <p class="hero-note">${icon('leaf')} No timer. No pressure. Room to figure it out.</p>
      </div>
      <figure class="hero-art"><img src="./assets/village.jpg" width="1536" height="1024" alt="A small green village with a library, cosy houses, trees, and winding paths."><figcaption><span class="caption-dot"></span> A good place to change your mind.</figcaption></figure>
    </section>
    ${session && !session.complete ? `<aside class="resume-banner"><span class="icon-disc">${icon('book')}</span><div><strong>Your place is saved.</strong><span>${esc(chapterTitle(session.chapterId))} · question ${session.index + 1} of ${session.ids.length}</span></div><button class="button small primary" data-action="resume">Keep going</button></aside>` : ''}
    <div class="village-strip"><span><strong>${questions.length}</strong> questions to explore</span><span><strong>${chapters.length}</strong> little chapters</span><span>${stats.practiced ? `<strong>${stats.practiced}</strong> questions explored` : `${icon('check')} Hints & explanations included`}</span></div>
    <section class="chapter-section" id="chapters" aria-labelledby="chapters-title">
      <div class="section-heading"><div><p class="eyebrow">YOUR LEARNING NEIGHBOURHOOD</p><h2 id="chapters-title">Pick your next stop.</h2><p>Follow the course, or visit a chapter you’d like to know better.</p></div>
      <div class="segmented week-filter" role="group" aria-label="Filter by course week">${[['all','All chapters'],['1','Week 1'],['2','Week 2']].map(([v,t])=>`<button data-action="week" data-value="${v}" aria-pressed="${week===v}">${t}</button>`).join('')}</div></div>
      <div class="chapter-grid">${subset.map(ch => {
        const list = questions.filter(q=>q.chapterId===ch.id), n = counts(list), s = summarize(progress,list.map(q=>q.id));
        const motifs = {synopsis:'cycle',1:'mind',2:'uncertainty',3:'calculator',5:'ruler',6:'coherence'};
        return `<button class="chapter-card" data-action="chapter" data-id="${esc(ch.id)}"><span class="card-top"><span class="chapter-icon tone-${ch.week}">${icon(motifs[ch.id])}</span><span class="chapter-number">${ch.id==='synopsis'?'THE SYNOPSIS':`CHAPTER ${String(ch.id).padStart(2,'0')}`}</span><span class="card-chevron">${icon('arrow')}</span></span><h3>${esc(ch.title)}</h3><p>${esc(ch.description)}</p><span class="card-bottom"><span>${n.tf} true / false${n.calculation ? ` <span class="middle-dot">·</span> ${n.calculation} calculations` : ''}</span><span class="week-badge">Week ${ch.week}</span></span><span class="card-progress"><span class="mini-track"><span style="width:${Math.round(100*s.practiced/list.length)}%"></span></span><span>${s.practiced ? `${s.practiced} of ${list.length} explored` : 'A fresh start'}</span></span></button>`;
      }).join('')}</div>
      <p class="chapter-footnote">${icon('info')} Start with weeks 1 & 2. More neighbourhoods will grow here as the course unfolds.</p>
    </section>
    <section class="gentle-band"><span class="band-mark">P(learning | practice)</span><div><h2>Getting it wrong is part of getting it.</h2><p>Take a hint, work it out on paper, or peek at the explanation. Every answer is a chance to update.</p></div><button class="text-button" data-action="about">How Bayesville works ${icon('arrow')}</button></section>
  </div>`;
}

function tableMarkup(table) {
  if (!table) return '';
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="Question data"><table><thead><tr>${table.headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${table.rows.map(row=>`<tr>${row.map((cell,i)=>i===0?`<th scope="row">${esc(cell)}</th>`:`<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function renderPractice() {
  if (!session) return renderHome();
  if (session.complete) return renderSummary();
  const q = currentQuestion(), result = currentAnswer(), revealed = session.revealed || Boolean(result);
  const marked = progress.bookmarks.includes(q.id);
  const answered = session.answers.length;
  const unit = q.unit || 'probability';
  return `<div class="practice-wrap">
    <div class="practice-top"><button class="text-button" data-action="pause">${icon('book')} Back to the chapters</button><span class="save-label">${icon('check')} ${storageWorks?'Your place is saved':'Progress is kept in this tab'}</span></div>
    <div class="session-heading"><div><p class="eyebrow">${esc(chapterTitle(session.chapterId))}</p><h1>${typeName(session.type)}</h1></div><span class="question-count">Question <strong>${session.index+1}</strong> / ${session.ids.length}</span></div>
    <div class="session-track" role="progressbar" aria-label="Session progress" aria-valuenow="${answered}" aria-valuemin="0" aria-valuemax="${session.ids.length}"><span style="width:${100*answered/session.ids.length}%"></span></div>
    <article class="question-card"><div class="question-meta"><div><span class="tag">${q.type==='tf'?'TRUE / FALSE':'CALCULATION'}</span><span class="difficulty">${esc(q.difficulty || 'Foundation')}</span></div><button class="icon-button ${marked?'is-bookmarked':''}" data-action="bookmark" data-id="${esc(q.id)}" aria-pressed="${marked}" aria-label="${marked?'Remove bookmark':'Bookmark this question'}" title="${marked?'Remove bookmark':'Save for later'}">${icon('bookmark')}</button></div>
      <h2 class="question-title">${esc(q.title)}</h2><p class="question-prompt">${esc(q.prompt)}</p>${tableMarkup(q.table)}
      ${q.type==='tf' ? `<div class="tf-choices" role="group" aria-label="Your answer">${[true,false].map((v,i)=>`<button class="answer-choice ${session.selection===v?'selected':''} ${revealed&&q.answer===v?'answer-correct':''}" data-action="select-answer" data-value="${v}" aria-pressed="${session.selection===v}" ${revealed?'disabled':''}><span class="answer-key">${i+1}</span>${v?'True':'False'}<span class="choice-marker">${revealed&&q.answer===v?icon('check'):''}</span></button>`).join('')}</div>` : `<form id="answer-form" novalidate><label for="numeric-answer" class="input-label">Your answer <span>${unit==='probability'?'Probability from 0 to 1':esc(unit==='number'?'Number':unit==='ratio'?'Ratio':unit)} · round to 2 decimals</span></label><div class="numeric-row"><input id="numeric-answer" name="answer" type="text" inputmode="decimal" autocomplete="off" maxlength="100" placeholder="e.g. 0.42" value="${esc(session.input)}" ${revealed?'disabled':''} aria-describedby="answer-help answer-error"><span class="numeric-unit">${unit==='probability'?'P':unit==='odds'?'odds':unit==='ratio'?'ratio':esc(unit==='number'?'':unit)}</span></div><p class="input-help" id="answer-help">${unit==='probability'?'Decimals, decimal commas, fractions, and percentages all work.':'Enter a number. Decimal commas and fractions work too.'}</p></form>`}
      <p class="answer-error" id="answer-error" role="alert"></p>
      ${session.hint ? `<div class="hint-panel" id="hint-panel" tabindex="-1">${q.hints.slice(0,session.hint).map((h,i)=>`<div><strong>${icon('hint')} Hint ${i+1}</strong><p>${esc(h)}</p></div>`).join('')}</div>`:''}
      ${!revealed?`<div class="question-actions"><button class="button primary" data-action="check">Check my answer ${icon('check')}</button><button class="button ghost" data-action="hint" ${session.hint>=q.hints.length?'disabled':''}>${icon('hint')} ${session.hint===0?'A little hint':session.hint<q.hints.length?'One more hint':'All hints shown'}</button></div><div class="reveal-row"><span>Working on paper, or feeling stuck?</span><button class="text-button" data-action="reveal">Show the solution</button></div>`:''}
      ${q.type==='calculation'&&!revealed?`<details class="scratchpad" ${session.notes?'open':''}><summary>A little space to think <span>Optional scratchpad</span></summary><label class="sr-only" for="scratchpad">Your working notes</label><textarea id="scratchpad" placeholder="Jot down your steps here…" rows="4" maxlength="5000">${esc(session.notes)}</textarea><p>For your working only. These notes aren’t graded.</p></details>`:''}
    </article>
    ${revealed?renderResult(q,result):`<p class="practice-reassurance">${icon('leaf')} A hint is a stepping stone, not a shortcut.</p>`}
  </div>`;
}

function renderResult(q, result) {
  const status = !result || result.correct===null ? 'revealed' : result.correct ? 'correct' : 'incorrect';
  const heading = status==='revealed'?'Let’s work through it.':result.method==='self'?(result.correct?'Marked as understood.':'Saved for another visit.'):(result.correct?'You’ve got it.':'Let’s take another look.');
  return `<section class="result-card ${status}" aria-labelledby="result-title"><div class="result-heading"><span class="result-icon">${icon(status==='correct'?'check':status==='incorrect'?'cycle':'book')}</span><div><p class="eyebrow">${status==='correct'?'A LITTLE MORE CLARITY':status==='incorrect'?'A CHANCE TO UPDATE':'THE SOLUTION'}</p><h2 id="result-title" tabindex="-1">${heading}</h2></div><div class="correct-answer"><span>${q.type==='tf'?'The statement is':'Answer'}</span><strong>${formatAnswer(q)}</strong></div></div>
    <p class="explanation">${esc(q.explanation)}</p>
    ${q.working?.length?`<div class="worked-solution"><p class="input-label">Step by step</p><ol>${q.working.map(step=>`<li>${esc(step)}</li>`).join('')}</ol></div>`:''}
    <div class="source-note">${icon('book')} ${q.chapterId==='synopsis'?'Synopsis':`Chapter ${esc(q.source?.chapter || q.chapterId)}`} · pp. ${esc(q.source?.pages || '')} <span>Bayesian Inference from the Ground Up</span></div>
    <div class="self-mark"><div><strong>${result?.method==='checked'?'How did it go on paper?':'How did you do?'}</strong><p>${result?.method==='checked'?'You can adjust your practice record below.':'Mark your work to keep your review list useful.'}</p></div><div class="self-mark-buttons"><button class="button small ${result?.correct===true?'selected-mark':'secondary'}" data-action="self-mark" data-value="true" aria-pressed="${result?.correct===true}">${icon('check')} I got it right</button><button class="button small ${result?.correct===false?'selected-mark':'secondary'}" data-action="self-mark" data-value="false" aria-pressed="${result?.correct===false}">${icon('cycle')} Needs practice</button></div></div>
    <div class="next-row"><span>${session.index===session.ids.length-1?'A good place to pause and reflect.':'One small step, then the next.'}</span><button class="button primary" data-action="next">${session.index===session.ids.length-1?'See my round-up':'Next question'} ${icon('arrow')}</button></div>
  </section>`;
}

function renderSummary() {
  const correct = session.answers.filter(a=>a.correct===true).length;
  const assisted = session.answers.filter(a=>a.hinted).length;
  const review = session.answers.filter(a=>a.correct!==true);
  return `<div class="summary-wrap"><div class="summary-celebration">${icon('leaf')}</div><p class="eyebrow">ONE MORE VISIT TO BAYESVILLE</p><h1>A little wiser<br>than before.</h1><p class="summary-lede">${correct===session.ids.length?'Everything in this round feels a little clearer. Nicely done.':'You made time to think. That’s how understanding grows.'}</p><div class="summary-stats"><div><strong>${correct}<small> / ${session.ids.length}</small></strong><span>marked understood</span></div><div><strong>${review.length}</strong><span>to revisit</span></div><div><strong>${assisted}</strong><span>helped along by hints</span></div></div><p class="local-note">Includes your own assessment of work done on paper.</p><div class="summary-actions">${review.length?`<button class="button primary" data-action="review-session">${icon('cycle')} Revisit these ${review.length}</button>`:`<button class="button primary" data-action="another">Try another round ${icon('spark')}</button>`}<a class="button secondary" href="#chapters">Explore the chapters</a></div><section class="roundup"><h2>Your round, question by question</h2>${session.ids.map(id=>{
    const q=bank.get(id), a=session.answers.find(item=>item.questionId===id);
    return `<details class="roundup-item"><summary><span class="roundup-status ${a?.correct?'good':''}">${icon(a?.correct?'check':'cycle')}</span><span>${esc(q.title)}<small>${q.type==='tf'?'True / false':'Calculation'} · ${a?.correct?'Understood':a?.correct===false?'Needs practice':'Not self-assessed'}</small></span>${icon('arrow')}</summary><div><p><strong>Answer: ${formatAnswer(q)}</strong></p><p>${esc(q.explanation)}</p></div></details>`;
  }).join('')}</section></div>`;
}

function renderProgress() {
  const stats=summarize(progress,ids), latest=latestAttempts(progress);
  return `<div class="progress-wrap wrap"><div class="progress-intro"><p class="eyebrow">YOUR LITTLE LEARNING LOG</p><h1>Look how far<br>you’ve wandered.</h1><p>A record of the ideas you’ve explored, and a few places worth another visit.</p></div><div class="progress-stats"><div><span>Questions explored</span><strong>${stats.practiced}<small> / ${questions.length}</small></strong></div><div><span>Marked understood</span><strong>${stats.understood}</strong></div><div><span>Worth another visit</span><strong>${stats.review}</strong></div><div><span>Saved for later</span><strong>${progress.bookmarks.length}</strong></div></div><div class="progress-actions"><button class="button primary" data-action="review-all" ${!stats.review?'disabled':''}>${icon('cycle')} Practice my review list</button><button class="button secondary" data-action="bookmarks" ${!progress.bookmarks.length?'disabled':''}>${icon('bookmark')} Practice saved questions</button></div>
    ${!stats.practiced?`<div class="empty-state">${icon('leaf')}<h2>Every good journey starts somewhere.</h2><p>Try a question and your learning log will start to grow.</p><a class="text-button" href="#chapters">Find your first chapter ${icon('arrow')}</a></div>`:''}
    <section class="chapter-log"><h2>Chapter by chapter</h2>${chapters.map(ch=>{
      const list=questions.filter(q=>q.chapterId===ch.id),s=summarize(progress,list.map(q=>q.id));
      return `<div class="chapter-log-row"><div><span class="eyebrow">${ch.id==='synopsis'?'SYNOPSIS':`CHAPTER ${ch.id}`}</span><h3>${esc(ch.title)}</h3></div><div><span class="mini-track"><span style="width:${100*s.understood/list.length}%"></span></span><span>${s.understood} / ${list.length} understood${s.review?` · ${s.review} to revisit`:''}</span></div><button class="button small secondary" data-action="chapter" data-id="${esc(ch.id)}">Practice</button></div>`;
    }).join('')}</section>
    ${latest.size?`<section class="recent-section"><h2>Recent discoveries</h2><div class="recent-list">${[...latest.values()].reverse().slice(0,8).map(a=>{
      const q=bank.get(a.questionId);
      return `<div class="recent-item"><span class="roundup-status ${a.correct?'good':''}">${icon(a.correct?'check':'cycle')}</span><div><strong>${esc(q.title)}</strong><span>${esc(chapterTitle(q.chapterId))} · ${a.method==='self'?'Self-assessed':a.method==='skipped'?'Solution viewed':'Answer checked'}${a.hinted?' · with hints':''}</span></div><button class="icon-button ${progress.bookmarks.includes(q.id)?'is-bookmarked':''}" data-action="bookmark" data-id="${esc(q.id)}" aria-label="${progress.bookmarks.includes(q.id)?'Remove bookmark for':'Bookmark'} ${esc(q.title)}" aria-pressed="${progress.bookmarks.includes(q.id)}">${icon('bookmark')}</button></div>`;
    }).join('')}</div></section>`:''}
    <div class="privacy-note"><div>${icon('info')}<p>Your progress stays in this browser, on this device. There’s no account or gradebook, and nothing is sent to your teacher. Self-assessments count toward “understood.”</p></div><button class="text-button reset-link" data-action="reset">Reset my progress</button></div></div>`;
}

function render(focus = true) {
  const route=location.hash.slice(1);
  const active=route==='progress'?'progress':'chapters';
  document.querySelectorAll('[data-nav]').forEach(link=>{
    if(link.dataset.nav===active) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
  });
  $('#main').innerHTML = route==='progress' ? renderProgress() : route==='practice' && session ? renderPractice() : renderHome();
  document.title = route==='practice'&&session ? `${session.complete?'Round-up':chapterTitle(session.chapterId)} · Bayesville` : route==='progress' ? 'Your progress · Bayesville' : 'Bayesville · Bayesian practice';
  if(focus) {
    $('#main').focus({preventScroll:true});
    if(route==='chapters') $('#chapters')?.scrollIntoView({behavior:'instant',block:'start'});
    else window.scrollTo({top:0,behavior:'instant'});
  }
}

function showDialog(html) {
  const dialog=$('#modal');
  dialog.innerHTML=`<button class="modal-close icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button>${html}`;
  if(!dialog.open) dialog.showModal();
}

function openSetup(chapterId='all', pool='all') {
  setup={chapterId,type:'mixed',pool,length:'5',shuffle:true};
  renderSetup();
}
function renderSetup() {
  const all=selectQuestions(questions,{chapterId:setup.chapterId},progress), n=counts(all);
  const available=selectQuestions(questions,setup,progress);
  const availableCount=available.length;
  const count=setup.length==='all'?availableCount:Math.min(Number(setup.length),availableCount);
  showDialog(`<p class="eyebrow">MAKE YOURSELF AT HOME</p><h2 id="modal-title">${esc(chapterTitle(setup.chapterId))}</h2><p class="modal-lede">A few questions, a little thinking, a clearer picture.</p>
    <fieldset><legend>What would you like to practice?</legend><div class="mode-options">${[['mixed','A bit of both','spark',all.length],['tf','True / false','check',n.tf],['calculation','Calculations','calculator',n.calculation]].map(([value,label,motif,num])=>`<label class="mode-option ${!num?'unavailable':''}"><input type="radio" name="practice-type" value="${value}" ${setup.type===value?'checked':''} ${!num?'disabled':''}><span>${icon(motif)}<strong>${label}</strong><small>${num?`${num} questions`:'Concepts only here'}</small></span></label>`).join('')}</div></fieldset>
    <div class="setup-row"><label>How many questions?<select name="session-length"><option value="5" ${setup.length==='5'?'selected':''}>A little visit · up to 5</option><option value="10" ${setup.length==='10'?'selected':''}>A longer wander · up to 10</option><option value="all" ${setup.length==='all'?'selected':''}>Every available question</option></select></label><label>Choose from<select name="question-pool">${[['all','All questions'],['review','My review list'],['bookmarks','Saved questions']].map(([value,label])=>`<option value="${value}" ${setup.pool===value?'selected':''}>${label}</option>`).join('')}</select></label></div>
    <label class="check-label"><input type="checkbox" name="shuffle" ${setup.shuffle?'checked':''}> Shuffle the questions</label>
    ${!availableCount?'<p class="setup-empty" role="status">No questions here yet. Try another question type or choose “All questions.”</p>':''}
    ${session&&!session.complete?'<p class="replace-note">Starting this round replaces your paused round. Your recorded progress stays saved.</p>':''}
    <button class="button primary full" data-action="start" ${!availableCount?'disabled':''}>Let’s practice · ${count} question${count===1?'':'s'} ${icon('spark')}</button><p class="modal-note">Untimed. Hints always welcome.</p>`);
}

function startSession(list, options={}) {
  if(!list.length) return;
  session={id:globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`,ids:list.map(q=>q.id),index:0,answers:[],chapterId:options.chapterId||'all',type:options.type||'mixed',pool:options.pool||'all',hint:0,revealed:false,selection:null,input:'',notes:'',complete:false};
  persist(); $('#modal').close(); navigate('practice');
}
function storeAnswer(correct,method,raw) {
  const q=currentQuestion();
  const answer={questionId:q.id,correct,method,hinted:session.hint>0,raw};
  session.answers=session.answers.filter(a=>a.questionId!==q.id);
  session.answers.push(answer);
  progress=recordAttempt(progress,{...answer,id:`${session.id}:${q.id}`,at:new Date().toISOString()});
  session.revealed=true; persist();
}
function showResult() {
  render(false);
  $('#result-title')?.focus({preventScroll:true});
  $('.result-card')?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}
function check() {
  if(!session||currentAnswer()||session.revealed) return;
  const q=currentQuestion(),raw=q.type==='tf'?session.selection:session.input;
  const result=gradeAnswer(q,raw);
  if(result.error) { $('#answer-error').textContent=result.error; $('#numeric-answer')?.setAttribute('aria-invalid','true'); return; }
  storeAnswer(result.correct,'checked',raw); showResult();
}

document.addEventListener('click',event=>{
  if(event.target.closest('.skip-link')) {
    event.preventDefault();
    $('#main').focus({preventScroll:true});
    $('#main').scrollIntoView({block:'start',behavior:'instant'});
    return;
  }
  const trigger=event.target.closest('[data-action]'); if(!trigger) return;
  const {action,id,value}=trigger.dataset;
  if(action==='chapter') openSetup(id);
  if(action==='week') { week=value; render(false); $('#chapters')?.scrollIntoView({block:'start',behavior:'instant'}); $(`[data-action="week"][data-value="${value}"]`)?.focus({preventScroll:true}); }
  if(action==='surprise') openSetup('all');
  if(action==='resume') navigate('practice');
  if(action==='close-modal') $('#modal').close();
  if(action==='start'&&setup) {
    let list=selectQuestions(questions,setup,progress);
    if(setup.shuffle) list=shuffle(list);
    if(setup.length!=='all') list=list.slice(0,Number(setup.length));
    startSession(list,setup);
  }
  if(action==='select-answer'&&session&&!session.revealed) { session.selection=value==='true'; persist(); render(false); $(`[data-action="select-answer"][data-value="${value}"]`)?.focus({preventScroll:true}); }
  if(action==='check') check();
  if(action==='hint'&&session) { session.hint=Math.min(currentQuestion().hints.length,session.hint+1); persist(); render(false); $('#hint-panel')?.focus({preventScroll:true}); }
  if(action==='reveal'&&session) { session.revealed=true; persist(); showResult(); }
  if(action==='self-mark'&&session) { storeAnswer(value==='true','self',currentAnswer()?.raw??(currentQuestion().type==='tf'?session.selection:session.input)); render(false); $(`[data-action="self-mark"][data-value="${value}"]`)?.focus({preventScroll:true}); toast(value==='true'?'Marked as understood.':'Added to your review list.'); }
  if(action==='next'&&session) {
    if(!currentAnswer()) storeAnswer(null,'skipped','');
    if(session.index===session.ids.length-1) session.complete=true;
    else { session.index++;session.hint=0;session.revealed=false;session.selection=null;session.input='';session.notes=''; }
    persist();render();
  }
  if(action==='pause') { persist();navigate('chapters'); }
  if(action==='bookmark') {
    progress.bookmarks=progress.bookmarks.includes(id)?progress.bookmarks.filter(item=>item!==id):[...progress.bookmarks,id];
    persist();render(false);$(`[data-action="bookmark"][data-id="${id}"]`)?.focus({preventScroll:true});toast(progress.bookmarks.includes(id)?'Saved for a future visit.':'Bookmark removed.');
  }
  if(action==='review-session'&&session) {
    const review=session.answers.filter(a=>a.correct!==true).map(a=>bank.get(a.questionId));
    startSession(review,{chapterId:session.chapterId,type:session.type,pool:'review'});
  }
  if(action==='another'&&session) openSetup(session.chapterId);
  if(action==='review-all') openSetup('all','review');
  if(action==='bookmarks') openSetup('all','bookmarks');
  if(action==='about') showDialog(`<p class="eyebrow">HELLO, NEIGHBOUR</p><h2 id="modal-title">A small place for big ideas.</h2><p class="modal-lede">Bayesville is a practice companion for Bayesian Inference for Psychology.</p><div class="about-steps"><div>${icon('book')}<div><h3>Pick a chapter. Find your pace.</h3><p>Choose true/false, calculations, or both. There’s no timer and no penalty for taking a hint.</p></div></div><div>${icon('hint')}<div><h3>Think, try, then update.</h3><p>Check calculations to two decimal places, or reveal the solution and assess your own paper working. Every question comes with a short explanation.</p></div></div><div>${icon('bookmark')}<div><h3>Come back to the tricky bits.</h3><p>Save questions and revisit your review list. Your place and progress are stored only in this browser, on this device.</p></div></div></div><div class="about-source"><strong>A note on the material</strong><p>These are new practice variants based on the first two course quizzes and <em>Bayesian Inference from the Ground Up: The Theory of Common Sense</em> by Eric-Jan Wagenmakers and Dora Matzke (September 2026). Book chapters and pages accompany each solution.</p><p>This is ungraded practice. It does not submit answers to your teacher, and it is not a copy of an upcoming assessment.</p></div><button class="button primary full" data-action="close-modal">Sounds good. Let’s explore.</button>`);
  if(action==='reset') showDialog(`<p class="eyebrow">A FRESH START</p><h2 id="modal-title">Reset your learning log?</h2><p class="modal-lede">This removes your answers, bookmarks, scratchpad, and paused round from this browser. It can’t be undone.</p><button class="button danger full" data-action="confirm-reset">Yes, reset my progress</button><button class="button secondary full" data-action="close-modal">Keep my progress</button>`);
  if(action==='confirm-reset') {progress=emptyProgress();session=null;persist();$('#modal').close();navigate('progress');toast('A fresh start. Your learning log has been reset.');}
});
document.addEventListener('input',event=>{
  if(!session) return;
  if(event.target.id==='numeric-answer') {session.input=event.target.value;$('#answer-error').textContent='';event.target.removeAttribute('aria-invalid');persist();}
  if(event.target.id==='scratchpad') {session.notes=event.target.value;persist();}
});
document.addEventListener('change',event=>{
  if(!setup||!$('#modal').open) return;
  const control=event.target;
  if(control.name==='practice-type') setup.type=control.value;
  else if(control.name==='session-length') setup.length=control.value;
  else if(control.name==='question-pool') setup.pool=control.value;
  else if(control.name==='shuffle') setup.shuffle=control.checked;
  else return;
  const name=control.name,value=control.value;
  renderSetup();
  const match=name==='practice-type'?`[name="${name}"][value="${value}"]`:`[name="${name}"]`;
  $(match)?.focus();
});
document.addEventListener('submit',event=>{if(event.target.id==='answer-form'){event.preventDefault();check();}});
$('#modal').addEventListener('click',event=>{
  if(event.target!==$('#modal')) return;
  const rect=$('#modal').getBoundingClientRect();
  if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom) $('#modal').close();
});
window.addEventListener('hashchange',()=>render());
render(false);
if(location.hash==='#chapters') requestAnimationFrame(()=>$('#chapters')?.scrollIntoView());
