# tools

Development tooling. Nothing here is part of the published site.

## build-preview.mjs

Bundles the Jekyll output in `_site/` into a single self-contained HTML file at
`.preview/jsoncanvas-preview.html`, with all CSS, JS, and images inlined and
site-root links rewritten to hash routes.

This exists so the site can be previewed somewhere that only serves one file and
blocks external requests — useful when there is no reachable port to run
`jekyll serve` on.

```sh
bundle exec jekyll build
node tools/build-preview.mjs
```

Deliberate departures from the served site are listed in the comment block at the
top of the script.

## Local setup notes

Two things are needed to build this site locally:

- Install gems **outside** the source tree. `_config.yml` sets `exclude:`, which
  replaces Jekyll's default exclude list, so a local `vendor/` gets crawled and
  fails the build:

  ```sh
  bundle config set --local path "$(mktemp -d)/bundle"
  bundle install
  ```

- Build with a UTF-8 locale, or the Sass converter fails on a non-ASCII
  character in the default theme's stylesheet:

  ```sh
  LANG=C.UTF-8 bundle exec jekyll build
  ```
