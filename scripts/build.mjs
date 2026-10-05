import { createHash } from 'node:crypto';
import { readdir, readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');

// GitHub Pages caches assets independently. A deterministic release version on
// every local URL keeps fresh HTML, CSS, and the complete module graph together.
export async function buildSite({
  sourceDirectory = join(projectRoot, 'site'),
  outputDirectory = join(projectRoot, 'dist'),
} = {}) {
  const source = resolve(sourceDirectory), output = resolve(outputDirectory);
  if (source === output || source.startsWith(output + sep) || output.startsWith(source + sep)) {
    throw new Error('Source and output directories must not overlap.');
  }
  const files = new Map();
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Public assets must not be symlinks: ${path}`);
      if (entry.isDirectory()) await collect(path);
      else if (entry.isFile()) files.set(relative(source, path).split(sep).join('/'), await readFile(path));
    }
  }
  await collect(source);
  const paths = [...files.keys()].sort();
  const hash = createHash('sha256').update(await readFile(scriptPath));
  for (const path of paths) hash.update(path).update('\0').update(files.get(path)).update('\0');
  const revision = hash.digest('hex').slice(0, 16);
  const rendered = new Map();
  for (const path of paths) {
    let content = files.get(path);
    if (/\.(?:html|css|js|mjs)$/.test(path)) {
      // Vendored stylesheets (including KaTeX) use bare relative font URLs.
      // Normalize these to the same asset path form before versioning below.
      if (path.endsWith('.css')) content = content.toString().replace(/url\((['"]?)([^'"()\s]+)\1\)/g, (match, quote, reference) => {
        if (/^(?:[a-z][a-z\d+.-]*:|\/|#|\.)/i.test(reference)) return match;
        return `url(${quote}./${reference}${quote})`;
      });
      // Match quoted relative references and unquoted CSS url(...). Resolve
      // against the referring file and touch only files in the public tree.
      content = content.toString().replace(/(["'(])(\.{1,2}\/[^"'()\s<>`]+)(["')])/g,
        (match, before, reference, after) => {
          const url = new URL(reference, `https://assets.invalid/${path}`);
          const asset = decodeURIComponent(url.pathname.slice(1));
          if (!files.has(asset)) throw new Error(`Missing local asset in ${path}: ${reference}`);
          url.searchParams.set('v', revision);
          return `${before}${reference.split(/[?#]/)[0]}${url.search}${url.hash}${after}`;
        });
    }
    rendered.set(path, content);
  }
  // Validate and render first, so a bad reference leaves an earlier build intact.
  await rm(output, { recursive: true, force: true });
  for (const [path, content] of rendered) {
    const destination = join(output, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  return { revision, fileCount: paths.length };
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const result = await buildSite();
  console.log(`Built ${result.fileCount} public files in dist/ (release ${result.revision}).`);
}
