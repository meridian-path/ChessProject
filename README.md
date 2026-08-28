# lichess-stats-poc

> Chess website for doing cool stuff

A chess stats site built end-to-end (fetch a live public API -> process/aggregate -> render a
stats page). Uses the [Lichess public API](https://lichess.org/api), which needs no API key.

**Status:** live at [Repertoire-Builder.com](https://Repertoire-Builder.com), also reachable
at [meridian-path.github.io/ChessProject](https://meridian-path.github.io/ChessProject/).
Both a local dev server and a static build are supported -- see below to run either
yourself.

## What it does

### Player lookup (original)

Given a Lichess username, it:

1. Fetches that player's rating history (`/api/user/:username/rating-history`)
   and their most recent rated games (`/api/games/user/:username`).
2. Aggregates the raw API data into per-variant rating stats (current, peak,
   low, change) and a game-by-game win/loss/draw summary.
3. Renders the result as a single self-contained HTML page.

### Rating-band opening-repertoire explorer (new)

Given a rating band (`1400-1600`, `1600-1800`, `1800-2000`, `2000+`) and a
color, it queries Lichess's free, keyless [Opening Explorer
API](https://lichess.org/api#tag/Opening-Explorer) and walks the position
tree: at the chosen color's own plies it shows the top-played move choices
(with win/draw/loss rates per move, for players in that rating band); at the
opponent's replies it follows only their single most-played response, since
the user doesn't choose those. The angle: "what's actually played and scores
well at my rating," not just theory.

**Known live-API caveat (found 2026-08-11):** as of this build, Lichess's
dedicated Opening Explorer subdomain (`explorer.lichess.ovh` /
`explorer.lichess.org`) returns HTTP 401 for every API query path when hit
from this environment, while its own bare root path returns 200 and the
*main* `lichess.org/api` (used by the player-lookup feature above) responds
normally with real data from the same environment -- so this isn't a general
network block. The most likely explanation is that Lichess's edge now treats
non-browser requests to the explorer API differently (the endpoint is used
live by lichess.org's own in-browser analysis board, which still works for
real users). The fetch/process/build code here is written to the documented,
publicly-keyless API contract and is fully covered by fixture-based tests;
if `node src/buildRepertoire.js` or the `/repertoire` server route 401s for
you too, that's this external condition, not a bug in this code -- retry
from a different network, or from an actual browser tab hitting the
`explorer.lichess.org` API directly, to confirm.

## Project layout

```
src/
  fetchLichess.js         data-fetch module for the main Lichess API (network I/O, error handling)
  fetchOpeningExplorer.js data-fetch module for the Opening Explorer API (network I/O, error handling)
  process.js               pure aggregation functions for player lookup (no I/O -- unit-testable)
  processRepertoire.js     pure aggregation functions for the repertoire explorer (no I/O -- unit-testable)
  render.js                pure HTML templating functions for both pages (no I/O)
  build.js                 CLI: fetch -> process -> render -> write dist/index.html (player lookup, single user)
  buildRepertoire.js       CLI + tree builder: fetch -> process -> render -> write dist/repertoire-*.html (single band/color)
  buildStatic.js           CLI: full static-site build -- pre-renders all 8 repertoire pages and
                            assembles the static player-lookup page + browser JS bundle into dist/
  server.js                minimal local dev server (Node's built-in http, no framework) -- serves both pages
  browser/
    playerLookup.client.js DOM controller for the static player-lookup page, concatenated into
                            dist/player-lookup.js by buildStatic.js (not loaded via require())
test/
  fixtures/                static JSON/ndjson fixtures used by the test suite
  fetchLichess.test.js
  fetchOpeningExplorer.test.js
  process.test.js
  processRepertoire.test.js
  buildRepertoire.test.js
  buildStatic.test.js
```

## Running it

Requires Node.js 18+ (built-in global `fetch` and `node:test` runner; no
`npm install` needed -- there are no dependencies).

Options A, C, and E below all write into the same `dist/` folder (this project has always
generated everything into one `dist/`, not per-option subfolders). Options A and E both
write `dist/index.html`, so running Option A after Option E will overwrite the static
site's home page with a single-player-page instead -- if that happens, just re-run
`npm run build:static` to restore it. Options C and E intentionally share the same
`repertoire-<band>-<color>.html` filenames -- that's expected, not a collision.

### Option A: static page

```
node src/build.js DrNykterstein
```

This fetches live data for the given Lichess username and writes
`dist/index.html`. Open it in a browser, e.g. on Windows:

```
start "" "dist/index.html"
```

### Option B: local dev server

```
node src/server.js
```

Then open `http://localhost:8787/player/DrNykterstein` in a browser (or visit
`http://localhost:8787/` for a simple form). The server only binds to
`localhost` and is not exposed or published anywhere.

Swap in any real Lichess username you like -- `DrNykterstein` (Magnus
Carlsen's account) is just an example with plenty of rating history and
recent games.

### Option C: rating-band opening-repertoire explorer (static page)

```
node src/buildRepertoire.js 1600-1800 white
```

This fetches live data from the Opening Explorer API for the given rating
band and color, and writes `dist/repertoire-1600-1800-white.html`. Open it
in a browser the same way as Option A. Valid rating bands: `1400-1600`,
`1600-1800`, `1800-2000`, `2000+`. Color is `white` or `black`. See the
live-API caveat above if this errors out with a 401.

### Option D: rating-band opening-repertoire explorer (dev server)

```
node src/server.js
```

Then open `http://localhost:8787/repertoire` for a band/color picker form,
or go directly to e.g. `http://localhost:8787/repertoire?band=1600-1800&color=white`.

### Option E: full static build (no server, GitHub-Pages-ready)

```
npm run build:static
```

(equivalent to `node src/buildStatic.js`). This produces a self-contained `dist/`
directory that works entirely as plain files -- no server, no `localhost`, nothing needs
to keep running. This is what's deployed to GitHub Pages.

What it writes to `dist/`:

- `index.html` -- links to the player-lookup page and all 8 repertoire pages.
- `repertoire-<band>-<color>.html` x8 -- pre-rendered at build time (all 4 rating bands x
  both colors) by reusing `buildRepertoireTree()`/`renderRepertoirePage()` unchanged. This
  is the only step that reads the Lichess API token (see the live-API caveat above); the
  token itself never ends up in any generated file -- `buildStatic.js` explicitly checks
  every file it writes for the token string before finishing, and fails the build loudly if
  it ever found one.
- `player.html` + `player-lookup.js` -- a static shell plus a plain-JS bundle (no bundler,
  no dependencies) assembled from `fetchLichess.js`, `process.js`, `render.js`, and
  `src/browser/playerLookup.client.js`. This calls Lichess's ordinary keyless public API
  directly from the visitor's browser at view time -- no token is read or needed for this
  page.

Open `dist/index.html` directly in a browser (a `file://` URL) and click through both
features. To confirm the Lichess API token never ends up in the build yourself, search the
`dist/` folder's files for the token string from your local `.lichess-token` file -- it
should not appear anywhere.

## Running the tests

```
npm test
```

(equivalent to `node --test test/`). All tests run against static fixture
JSON/ndjson in `test/fixtures/` -- the test suite makes no live network
calls.

## Third-party origins

Every origin loaded or called by the live site, and why:

- `lichess.org` -- the Lichess public API, called from the visitor's browser
  for the player-lookup feature (rating history, recent games). Keyless, no
  account required.
- `explorer.lichess.org` -- the Lichess Opening Explorer API, called at build
  time for the pre-rendered repertoire pages when `data/aggregates/` isn't
  present locally (masters-database lookups always call it; see
  `src/explorerSource.js`'s header). The separate, run-by-hand
  `scripts/buildBandShards.js` crawler (the band-meta shard dataset,
  `data/rep/`, copied into `dist/data/rep/` at build time) now REQUIRES
  `data/aggregates/` and refuses to call this API by default -- see that
  script's own header ("DATA SOURCE, FIXED 2026-08-16") for why: it must
  always draw from the same dataset the pre-rendered repertoire pages do,
  never Lichess's differently-scoped all-time cumulative totals. Requires a
  personal access token as of 2026-08-11 (see "Running it," below).
- `pagead2.googlesyndication.com` -- Google AdSense, the site's ad script.
- `gc.zgo.at` -- GoatCounter, privacy-friendly visit-count analytics (no
  cookies, no personal data collected).

Nothing else is fetched from a third-party origin at runtime -- there are no
CDN-hosted vendor libraries; this project has no dependencies (see "Running
it," above).
