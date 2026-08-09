// Bundles the Jekyll build in _site/ into ONE self-contained HTML page suitable
// for publishing as an Artifact (strict CSP: no external requests, single file).
//
// Fidelity notes (the only deliberate departures from the real site):
//   1. Multi-page navigation becomes hash routing (#/spec/1.0, #/docs/apps).
//   2. The home canvas's <iframe src="/spec/1.0?hidenav=true"> becomes an
//      inline scrolling div with the same content (iframes are CSP-risky).
//   3. A "UA defaults" stylesheet is prepended so the artifact host's CSS reset
//      can't strip the default margins the real site relies on.
//   4. /404 is not included (its layout re-uses every id the home canvas owns).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(REPO, '_site');
const OUT_DIR = process.env.PREVIEW_OUT_DIR || join(REPO, '.preview');
const OUT = join(OUT_DIR, 'jsoncanvas-preview.html');

const read = (p) => readFileSync(join(SITE, p), 'utf8');

const bodyOf = (html) => {
  const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (!m) throw new Error('no <body> found');
  return m[1];
};
const stripScripts = (html) => html.replace(/<script\b[\s\S]*?<\/script>/gi, '');
// #navbar contains no nested <div>, so the first </div> is its own.
const stripNavbar = (html) => html.replace(/<div id="navbar">[\s\S]*?<\/div>/i, '');

// ---------------------------------------------------------------- assets ----
const logoSvg = readFileSync(join(SITE, 'logo.svg'), 'utf8');
const logoDataUri =
  'data:image/svg+xml;base64,' + Buffer.from(logoSvg, 'utf8').toString('base64');

const siteCss = read('assets/style.css');
const canvasJs = read('assets/canvas.js');
const prismJs = read('assets/prism.js');

const inlineAssets = (html) => html.replaceAll('/logo.svg', logoDataUri);

// ----------------------------------------------------------------- pages ----
const homeRaw = bodyOf(read('index.html'));
const edgesScript = (homeRaw.match(/<script>\s*let edges[\s\S]*?<\/script>/i) || [
  '',
])[0].replace(/<\/?script>/gi, '');

const specBody = bodyOf(read('spec/1.0/index.html'));
const appsBody = bodyOf(read('docs/apps/index.html'));

// The spec node's iframe -> inline scrolling copy of the spec page, nav hidden.
const specEmbed = `<div class="jc-embed">${stripNavbar(stripScripts(specBody))}</div>`;

let homeMarkup = stripScripts(homeRaw).replace(
  /<iframe[\s\S]*?<\/iframe>/i,
  specEmbed
);

homeMarkup = inlineAssets(homeMarkup);

const pages = {
  '/spec/1.0': inlineAssets(stripScripts(specBody)),
  '/docs/apps': inlineAssets(stripScripts(appsBody)),
};

// ------------------------------------------------------------- shim CSS -----
// Restores the browser defaults the real site inherits, in case the artifact
// host's reset removes them. Loaded BEFORE the site's own stylesheet.
const uaDefaults = `
html { box-sizing: border-box; }
body { margin: 0; padding: 0; }
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
table { display: table; }
thead { display: table-header-group; }
tbody { display: table-row-group; }
tr { display: table-row; }
th, td { display: table-cell; }
`;

// Preview-only styling: the inlined spec panel must behave like the iframe did.
// jsoncanvas.org is a deliberately light-only design, so the artifact host's
// theme must not show through beneath short pages.
const previewCss = `
html { background-color: var(--color-bg-1); }
body { min-height: 100%; }
.jc-embed {
  width: 100%;
  height: 100%;
  overflow: auto;
  border-radius: 8px;
  background-color: var(--color-bg-1);
  -webkit-overflow-scrolling: touch;
}
.node.is-dragging .jc-embed { pointer-events: none; }
#jc-doc[hidden] { display: none; }
`;

// ------------------------------------------------------------- the page -----
const routerJs = `
(function () {
  var HOME = document.getElementById('jc-home');
  var DOC  = document.getElementById('jc-doc');
  var PAGES = ${JSON.stringify(pages)};

  function externalize(root) {
    root.querySelectorAll('a[href]').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (/^https?:/i.test(href) && a.hostname !== window.location.hostname) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
    });
  }

  function route() {
    var path = (window.location.hash || '').replace(/^#/, '') || '/';
    var page = PAGES[path.replace(/\\/$/, '')];

    if (!page) {
      DOC.hidden = true;
      DOC.innerHTML = '';
      HOME.hidden = false;
      document.body.id = 'home';
      if (typeof adjustCanvasToViewport === 'function') adjustCanvasToViewport();
      if (typeof drawEdges === 'function') drawEdges();
      return;
    }

    HOME.hidden = true;
    document.body.id = '';
    DOC.innerHTML = page;
    DOC.hidden = false;
    externalize(DOC);
    if (window.Prism) Prism.highlightAllUnder(DOC);
    window.scrollTo(0, 0);
  }

  // Site-root links become hash routes so navigation stays inside the page.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="/"]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    var to = a.getAttribute('href').replace(/\\/$/, '') || '/';
    if (('#' + to) === window.location.hash) route();
    else window.location.hash = to;
  });

  window.addEventListener('hashchange', route);

  // Runs after canvas.js's own DOMContentLoaded handler, so the canvas has
  // already measured itself at full size before we possibly hide it.
  document.addEventListener('DOMContentLoaded', function () {
    if (window.location.hash) route();
  });
})();
`;

const html = `<title>JSON Canvas — preview</title>
<style>${uaDefaults}</style>
<style>${siteCss}</style>
<style>${previewCss}</style>

<div id="jc-home">${homeMarkup}</div>
<div id="jc-doc" hidden></div>

<script>
document.body.id = 'home';
document.body.style.setProperty('--scale', '1');
document.body.style.setProperty('--pan-x', '0px');
document.body.style.setProperty('--pan-y', '0px');
</script>

<script>${edgesScript}</script>
<script>${canvasJs}</script>
<script>${prismJs}</script>
<script>${routerJs}</script>
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, html, 'utf8');
console.log(`wrote ${OUT} (${(html.length / 1024).toFixed(1)} KB)`);
