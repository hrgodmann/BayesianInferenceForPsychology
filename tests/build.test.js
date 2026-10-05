import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildSite } from '../scripts/build.mjs';

const publicFiles = {
  'index.html': '<link rel="icon" href="./assets/favicon.svg?v=previous&theme=autumn#mark"><link rel="stylesheet" href="./theme.css?theme=autumn#palette"><script type="module" src="./app.js"></script><a href="#home">Home</a><a href="https://example.org/help?q=1#answer">Help</a>',
  'app.js': 'import { question } from "./questions.js"; export const html = `<img src="./assets/village.png">`; export { question };',
  'questions.js': 'import { context } from "./contexts.js?locale=en#story"; export const question = context;',
  'contexts.js': 'export const context = "A toy passes inspection.";',
  'theme.css': 'body { background: url("./assets/grain.svg?texture=paper#grain"); } @font-face { font-family: Example; src: url(fonts/example.woff2); }',
  'fonts/example.woff2': Buffer.from([0x77, 0x4f, 0x46, 0x32]),
  'assets/favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg"><text>PP</text></svg>',
  'assets/village.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0xff, 0xfe]),
  'assets/grain.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
};

async function fixture(t, entries = Object.entries(publicFiles)) {
  const root = await mkdtemp(join(tmpdir(), 'probability-playground-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceDirectory = join(root, 'site'), outputDirectory = join(root, 'dist');
  for (const [relative, contents] of entries) {
    const path = join(sourceDirectory, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  }
  return { root, sourceDirectory, outputDirectory };
}

async function filesUnder(directory, prefix = '') {
  const paths = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) paths.push(...await filesUnder(directory, relative));
    else paths.push(relative);
  }
  return paths.sort();
}

function reference(text, expression, revision, pathname, parameters = {}, hash = '') {
  const match = text.match(expression);
  assert.ok(match, `Missing reference for ${pathname}`);
  const url = new URL(match[1], 'https://example.org/course/');
  assert.equal(url.pathname, `/course/${pathname}`);
  assert.equal(url.searchParams.get('v'), revision);
  assert.equal(url.searchParams.getAll('v').length, 1);
  for (const [name, value] of Object.entries(parameters)) assert.equal(url.searchParams.get(name), value);
  assert.equal(url.hash, hash);
}

test('production build versions the complete module and asset graph without changing navigation', async t => {
  const paths = await fixture(t);
  const { revision, fileCount } = await buildSite(paths);
  assert.equal(typeof revision, 'string');
  assert.ok(revision.length > 0);
  assert.equal(fileCount, Object.keys(publicFiles).length);
  const read = path => readFile(join(paths.outputDirectory, path), 'utf8');
  const index = await read('index.html'), app = await read('app.js');
  const questions = await read('questions.js'), css = await read('theme.css');
  reference(index, /href="([^\"]*favicon\.svg[^\"]*)"/, revision, 'assets/favicon.svg', { theme: 'autumn' }, '#mark');
  reference(index, /href="([^\"]*theme\.css[^\"]*)"/, revision, 'theme.css', { theme: 'autumn' }, '#palette');
  reference(index, /src="([^\"]*app\.js[^\"]*)"/, revision, 'app.js');
  reference(app, /from "([^\"]*questions\.js[^\"]*)"/, revision, 'questions.js');
  reference(questions, /from "([^\"]*contexts\.js[^\"]*)"/, revision, 'contexts.js', { locale: 'en' }, '#story');
  reference(app, /src="([^\"]*village\.png[^\"]*)"/, revision, 'assets/village.png');
  reference(css, /url\("([^\"]*)"\)/, revision, 'assets/grain.svg', { texture: 'paper' }, '#grain');
  reference(css, /src: url\(([^)]*)\)/, revision, 'fonts/example.woff2');
  assert.ok(index.includes('href="#home"'));
  assert.ok(index.includes('href="https://example.org/help?q=1#answer"'));
  assert.deepEqual(await readFile(join(paths.outputDirectory, 'assets/village.png')), publicFiles['assets/village.png']);
  for (const [relative, contents] of Object.entries(publicFiles)) {
    assert.deepEqual(await readFile(join(paths.sourceDirectory, relative)), Buffer.from(contents), `Source changed: ${relative}`);
  }
});

test('revision and output are deterministic across file creation order and output location', async t => {
  const first = await fixture(t), second = await fixture(t, Object.entries(publicFiles).reverse());
  const resultA = await buildSite(first), resultB = await buildSite(second);
  assert.deepEqual(resultA, resultB);
  for (const relative of Object.keys(publicFiles)) {
    assert.deepEqual(await readFile(join(first.outputDirectory, relative)), await readFile(join(second.outputDirectory, relative)));
  }
  const repeated = await buildSite({ sourceDirectory: first.sourceDirectory, outputDirectory: join(first.root, 'another-build') });
  assert.deepEqual(repeated, resultA);
});

test('changing only a transitive dependency refreshes entry points and every imported revision', async t => {
  const paths = await fixture(t), before = await buildSite(paths);
  const originalEntry = await readFile(join(paths.sourceDirectory, 'app.js'));
  await writeFile(join(paths.sourceDirectory, 'contexts.js'), 'export const context = "A seed germinates.";');
  const after = await buildSite(paths);
  assert.notEqual(after.revision, before.revision);
  assert.deepEqual(await readFile(join(paths.sourceDirectory, 'app.js')), originalEntry);
  reference(await readFile(join(paths.outputDirectory, 'index.html'), 'utf8'), /src="([^\"]*app\.js[^\"]*)"/, after.revision, 'app.js');
  reference(await readFile(join(paths.outputDirectory, 'questions.js'), 'utf8'), /from "([^\"]*contexts\.js[^\"]*)"/, after.revision, 'contexts.js', { locale: 'en' }, '#story');
});

test('build copies only public files and excludes hidden material from artifacts and revision', async t => {
  const paths = await fixture(t), before = await buildSite(paths);
  await mkdir(join(paths.root, 'exams'));
  await writeFile(join(paths.root, 'exams', 'answers.txt'), 'Private answers');
  await mkdir(join(paths.sourceDirectory, '.private'));
  await writeFile(join(paths.sourceDirectory, '.private', 'notes.txt'), 'Private notes');
  await writeFile(join(paths.sourceDirectory, '.DS_Store'), 'Local metadata');
  const after = await buildSite(paths);
  assert.deepEqual(after, before);
  assert.deepEqual(await filesUnder(paths.outputDirectory), Object.keys(publicFiles).sort());
});

test('build rejects symlinks rather than following files outside the public source', async t => {
  const paths = await fixture(t);
  await writeFile(join(paths.root, 'private.txt'), 'Private answers');
  await symlink(join(paths.root, 'private.txt'), join(paths.sourceDirectory, 'answers.txt'));
  await assert.rejects(buildSite(paths));
});

test('build rejects overlapping source and output before removing or rewriting source', async t => {
  const paths = await fixture(t);
  for (const outputDirectory of [paths.sourceDirectory, join(paths.sourceDirectory, 'dist'), paths.root]) {
    await assert.rejects(buildSite({ sourceDirectory: paths.sourceDirectory, outputDirectory }));
    assert.deepEqual(await readFile(join(paths.sourceDirectory, 'app.js')), Buffer.from(publicFiles['app.js']));
  }
});

test('a broken local reference fails before replacing the previous deployable build', async t => {
  const paths = await fixture(t);
  await buildSite(paths);
  const previousIndex = await readFile(join(paths.outputDirectory, 'index.html'));
  const previousModule = await readFile(join(paths.outputDirectory, 'app.js'));
  await writeFile(join(paths.sourceDirectory, 'app.js'), 'import "./missing-module.js";');
  await assert.rejects(buildSite(paths));
  assert.deepEqual(await readFile(join(paths.outputDirectory, 'index.html')), previousIndex);
  assert.deepEqual(await readFile(join(paths.outputDirectory, 'app.js')), previousModule);
});
