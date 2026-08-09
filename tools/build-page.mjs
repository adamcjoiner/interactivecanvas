// Bundles ONE page of the Jekyll build in _site/ into a self-contained HTML
// file suitable for publishing as an Artifact (strict CSP: no external
// requests, single file, no <html>/<head>/<body> wrapper of its own).
//
// Unlike build-preview.mjs, this keeps the page's own <script> tags intact, so
// an interactive page (the canvas app) actually runs. It resolves every
// stylesheet, script, and image reference against _site and inlines it.
//
//   bundle exec jekyll build
//   node tools/build-page.mjs /app/ .preview/app-preview.html

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(REPO, '_site');

const pagePath = process.argv[2] || '/app/';
const outArg = process.argv[3] || '.preview/app-preview.html';
const OUT = resolve(REPO, outArg);

const MIME = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

// Asset URLs in the built site are absolute against site.url; strip either form.
const toSitePath = (url) =>
  url.replace(/^https?:\/\/[^/]+/i, '').replace(/^\//, '').split(/[?#]/)[0];

const readSite = (sitePath) => readFileSync(join(SITE, sitePath), 'utf8');

function dataUri(sitePath) {
  const ext = sitePath.slice(sitePath.lastIndexOf('.')).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const buf = readFileSync(join(SITE, sitePath));
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// ------------------------------------------------------------------- page ---
const indexPath = join(pagePath.replace(/^\//, ''), 'index.html').replace(/\\/g, '/');
if (!existsSync(join(SITE, indexPath))) {
  throw new Error(`no built page at _site/${indexPath} — run "jekyll build" first`);
}

const html = readSite(indexPath);
const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [, 'JSON Canvas'])[1].trim();
let body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [, ''])[1];

// Stylesheets referenced from <head>, in document order.
const styles = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)]
  .map((m) => (m[0].match(/href=["']([^"']+)["']/i) || [])[1])
  .filter(Boolean)
  .map(toSitePath)
  .filter((p) => existsSync(join(SITE, p)))
  .map((p) => `/* ${p} */\n${readSite(p)}`)
  .join('\n');

// Scripts in the body, inlined in place so load order is preserved.
body = body.replace(/<script[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi, (whole, src) => {
  const p = toSitePath(src);
  if (!existsSync(join(SITE, p))) return whole;
  return `<script>\n/* ${p} */\n${readSite(p)}\n</script>`;
});

// Images and any other root-relative asset references.
body = body.replace(/(src|href)=["'](\/[^"']+\.(?:svg|png|jpe?g|gif|webp|ico))["']/gi, (whole, attr, url) => {
  const p = toSitePath(url);
  if (!existsSync(join(SITE, p))) return whole;
  return `${attr}="${dataUri(p)}"`;
});

// The page becomes a fragment inside the host's document, so links that would
// leave it need to open in a new tab rather than navigate the frame.
body = body.replace(/<a\s+href=["']\/["']/gi, '<a href="https://jsoncanvas.org/" target="_blank" rel="noopener noreferrer"');

// --------------------------------------------------------------- shim CSS ---
// Restores the browser defaults the site inherits, in case the host's reset
// removes them, and pins the light ground the site is designed for.
const uaDefaults = `
html { box-sizing: border-box; background-color: var(--color-bg-1, #fff); }
body { margin: 0; padding: 0; min-height: 100%; }
h1,h2,h3,h4,h5,h6 { font-weight: bold; }
h1 { font-size: 2em;    margin: 0.67em 0; }
h2 { font-size: 1.5em;  margin: 0.83em 0; }
h3 { font-size: 1.17em; margin: 1em 0; }
h4 { font-size: 1em;    margin: 1.33em 0; }
h5 { font-size: 0.83em; margin: 1.67em 0; }
h6 { font-size: 0.67em; margin: 2.33em 0; }
p { margin: 1em 0; }
ul, ol { margin: 1em 0; padding-inline-start: 40px; list-style: disc outside; }
ol { list-style: decimal outside; }
li { display: list-item; }
blockquote { margin: 1em 40px; }
pre { margin: 1em 0; }
strong, b { font-weight: bolder; }
em, i { font-style: italic; }
`;

const out = `<title>${title}</title>
<style>${uaDefaults}</style>
<style>
${styles}
</style>
${body}
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out, 'utf8');
console.log(`wrote ${OUT} (${(out.length / 1024).toFixed(1)} KB) from _site/${indexPath}`);
