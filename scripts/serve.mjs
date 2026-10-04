import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDirectory = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '../site'));
const projectPrefix = '/BayesianInferenceForPsychology';
const port = Number(process.env.PORT || 4173);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const insideSite = (path) => path === siteDirectory || path.startsWith(`${siteDirectory}${sep}`);

function respond(response, status, message, method) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(method === 'HEAD' ? undefined : message);
}

const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD');
    return respond(response, 405, 'Method not allowed.', request.method);
  }

  let pathname;
  let url;
  try {
    url = new URL(request.url, `http://127.0.0.1:${port}`);
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return respond(response, 400, 'Invalid URL.', request.method);
  }

  if (pathname === projectPrefix) {
    response.writeHead(301, { Location: `${projectPrefix}/${url.search}` });
    return response.end();
  }
  if (pathname.startsWith(`${projectPrefix}/`)) {
    pathname = pathname.slice(projectPrefix.length);
  }
  // Serve only public files from site/, including after resolving symlinks.
  if (pathname.includes('\0') || pathname.split('/').some((part) => part.startsWith('.'))) {
    return respond(response, 404, 'Not found.', request.method);
  }

  try {
    let path = resolve(siteDirectory, `.${pathname}`);
    if (!insideSite(path)) return respond(response, 404, 'Not found.', request.method);
    let information = await stat(path);
    if (information.isDirectory()) {
      if (!url.pathname.endsWith('/')) {
        response.writeHead(301, { Location: `${url.pathname}/${url.search}` });
        return response.end();
      }
      path = resolve(path, 'index.html');
      information = await stat(path);
    }
    path = await realpath(path);
    if (!insideSite(path) || !information.isFile()) {
      return respond(response, 404, 'Not found.', request.method);
    }
    response.writeHead(200, {
      'Content-Type': mimeTypes[extname(path).toLowerCase()] || 'application/octet-stream',
      'Content-Length': information.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') return response.end();
    const stream = createReadStream(path);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  } catch (error) {
    const expected = ['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code);
    respond(response, expected ? 404 : 500, expected ? 'Not found.' : 'Unable to read file.', request.method);
  }
});

server.on('error', (error) => {
  console.error(`Could not start Probability Playground: ${error.message}`);
  process.exitCode = 1;
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Probability Playground: http://127.0.0.1:${port}${projectPrefix}/`);
  console.log('Press Ctrl+C to stop.');
});
