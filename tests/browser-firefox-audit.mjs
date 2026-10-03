// Optional second-engine smoke audit using an already installed Firefox binary.
// No geckodriver/install is needed: Firefox exposes standard WebDriver BiDi.
// It runs headlessly in a temporary profile, never the user's Firefox profile.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateQuestion, skills } from '../site/questions.js';
import { formatAnswer } from '../site/engine.js';

if (typeof globalThis.WebSocket !== 'function') {
  throw new Error('This optional Firefox audit requires a Node.js runtime with global WebSocket support. Use a newer Node.js runtime for this check; the platform itself still supports Node.js 20.');
}
const base = process.env.BAYESVILLE_URL || 'http://127.0.0.1:4173/BayesianInferenceForPsychology/';
const binary = process.env.BAYESVILLE_FIREFOX || '/Applications/Firefox.app/Contents/MacOS/firefox';
const profile = await mkdtemp(join(tmpdir(), 'bayesville-firefox-audit-'));
const child = spawn(binary, ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', '0', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
let socket, context, nextId = 0;
const pending = new Map();
const processEnded = new Promise(resolve => child.once('exit', resolve));
const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`BiDi command timed out: ${method}`)); }, 15000);
  pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expression) {
  const result = await command('script.evaluate', { expression, target: { context }, awaitPromise: true });
  if (result.type === 'exception') throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Firefox did not expose WebDriver BiDi within 20 seconds')), 20000);
    let output = '';
    const inspect = chunk => {
      output += chunk.toString();
      const match = output.match(/WebDriver BiDi listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    };
    child.stdout.on('data', inspect); child.stderr.on('data', inspect);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Firefox exited before connection (${code}): ${output.slice(-1500)}`)); });
  });
  socket = new WebSocket(`${endpoint.replace(/\/$/, '')}/session`);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.type === 'error') request.reject(new Error(`${message.error}: ${message.message}`));
    else request.resolve(message.result);
  });
  const session = await command('session.new', { capabilities: { alwaysMatch: { browserName: 'firefox' } } });
  ({ context } = await command('browsingContext.create', { type: 'tab' }));
  await command('browsingContext.setViewport', { context, viewport: { width: 320, height: 844 } });
  await command('browsingContext.navigate', { context, url: base, wait: 'complete' });
  const home = JSON.parse(await evaluate(`JSON.stringify({cards:document.querySelectorAll('[data-action="skill"]').length,image:document.querySelector('.hero-art img').naturalWidth,overflow:document.documentElement.scrollWidth>innerWidth})`));
  assert.equal(home.cards, 7); assert.ok(home.image > 0); assert.equal(home.overflow, false);

  const cases = new Map();
  for (const skill of skills) for (let seed = 0; seed < 1000; seed++) {
    const q = generateQuestion(skill.id, seed), key = `${skill.id}:${q.title}`;
    if (!cases.has(key)) cases.set(key, { skill: skill.id, seed, title: q.title, answer: formatAnswer(q) });
  }
  for (const item of cases.values()) {
    const result = JSON.parse(await evaluate(`(async()=>{
      const item=${JSON.stringify(item)};
      location.hash='skills';
      const wait=async(selector)=>{for(let i=0;i<100;i++){if(document.querySelector(selector))return;await new Promise(r=>setTimeout(r,20));}throw new Error('Missing '+selector)};
      await wait('[data-action="skill"]');
      Object.defineProperty(crypto,'getRandomValues',{configurable:true,value(array){array.fill(item.seed);return array}});
      document.querySelector('[data-action="skill"][data-id="'+item.skill+'"]').click();
      await wait('#numeric-answer');
      const title=document.querySelector('.question-title').textContent;
      document.querySelector('[data-action="toggle-guided"]')?.click();
      const input=document.querySelector('#numeric-answer');input.value=item.answer;input.dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('#answer-form').requestSubmit();
      await wait('.result-card');
      return JSON.stringify({title,correct:!!document.querySelector('.result-card.correct'),answer:document.querySelector('.correct-answer strong').textContent,overflow:document.documentElement.scrollWidth>innerWidth,focus:document.activeElement.id,cookies:document.cookie});
    })()`));
    assert.equal(result.title, item.title); assert.equal(result.correct, true, item.title);
    assert.equal(result.answer, item.answer); assert.equal(result.overflow, false, item.title);
    assert.equal(result.focus, 'result-title'); assert.equal(result.cookies, '');
  }
  const screenshot = await command('browsingContext.captureScreenshot', { context, origin: 'viewport', format: { type: 'image/png' } });
  await mkdir('.artifacts', { recursive: true });
  await writeFile('.artifacts/audit-firefox-mobile.png', Buffer.from(screenshot.data, 'base64'));
  console.log(`Passed: Firefox ${session.capabilities.browserVersion}; all ${cases.size} generated titles render, grade, focus feedback, and fit 320px. Fresh profile; no cookie created.`);
} finally {
  socket?.close();
  if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.race([processEnded, new Promise(resolve => setTimeout(resolve, 3000))]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await rm(profile, { recursive: true, force: true });
}
