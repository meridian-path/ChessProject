'use strict';

/**
 * Minimal local-only dev server (Node's built-in http module, no framework).
 * Renders a player page on the fly for whatever username is requested.
 *
 * Usage:
 *   node src/server.js [port]
 *   then visit http://localhost:<port>/player/<username> in a browser
 *
 * Local-only: nothing here binds beyond localhost, and nothing publishes
 * or deploys this anywhere.
 */

const http = require('http');
const { buildPlayerPage } = require('./build');
const { buildRepertoireTree } = require('./buildRepertoire');
const { LichessNotFoundError, LichessRateLimitError } = require('./fetchLichess');
const { ExplorerRateLimitError, ExplorerApiError } = require('./fetchOpeningExplorer');
const { RATING_BANDS } = require('./processRepertoire');
const { escapeHtml, renderRepertoirePage, renderDocumentHead, renderHeader, renderFooter } = require('./render');
const { SITE_NAME } = require('./site');

const DEFAULT_PORT = 8787;

// Nav link targets for the dev server -- matches renderPlayerPage /
// renderRepertoirePage's own default `nav` param, so every page reached via
// `npm run serve` shares one identical header, not just the data pages.
const SERVER_NAV = { player: '/', repertoire: '/repertoire' };

function indexPage() {
  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead(SITE_NAME)}
<body>
<div class="page">
  ${renderHeader(SERVER_NAV, 'player')}
  <main id="main-content">
    <h1 class="page-title">${escapeHtml(SITE_NAME)}</h1>
    <p class="subtitle">Enter a Lichess username to view rating history and recent games.</p>
    <form action="/player" method="get" class="lookup-form">
      <input name="username" placeholder="e.g. DrNykterstein" required>
      <button type="submit">View</button>
    </form>
    <p><a href="/repertoire">Or try the rating-band opening-repertoire explorer &rarr;</a></p>
  </main>
  ${renderFooter('Local dev server - data source: <a href="https://lichess.org/api" rel="noopener noreferrer">lichess.org/api</a>.')}
</div>
</body>
</html>`;
}

function repertoireFormPage() {
  const bandOptions = Object.keys(RATING_BANDS)
    .map((band) => `<option value="${escapeHtml(band)}">${escapeHtml(band)}</option>`)
    .join('');
  return `<!DOCTYPE html>
<html lang="en">
${renderDocumentHead(`Opening repertoire explorer - ${SITE_NAME}`)}
<body>
<div class="page">
  ${renderHeader(SERVER_NAV, 'repertoire')}
  <main id="main-content">
    <h1 class="page-title">Rating-band opening-repertoire explorer</h1>
    <p class="subtitle">Pick a rating band and a color to see the most-played moves at each ply
       for players in that band, with win/draw/loss rates per move.</p>
    <form action="/repertoire" method="get" class="lookup-form">
      <label>Rating band:
        <select name="band">${bandOptions}</select>
      </label>
      <label>Color:
        <select name="color">
          <option value="white">White</option>
          <option value="black">Black</option>
        </select>
      </label>
      <button type="submit">Explore</button>
    </form>
  </main>
  ${renderFooter('Local dev server - data source: <a href="https://lichess.org/api#tag/Opening-Explorer" rel="noopener noreferrer">Lichess Opening Explorer API</a>.')}
</div>
</body>
</html>`;
}

async function requestHandler(req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/' ) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(indexPage());
    return;
  }

  if (url.pathname === '/repertoire') {
    const band = url.searchParams.get('band');
    const color = url.searchParams.get('color');

    if (!band || !color) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(repertoireFormPage());
      return;
    }

    if (!RATING_BANDS[band]) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<p>Unknown rating band: ${escapeHtml(band)}. Valid bands: ${escapeHtml(Object.keys(RATING_BANDS).join(', '))}</p>`);
      return;
    }
    if (color !== 'white' && color !== 'black') {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<p>Color must be "white" or "black", got: ${escapeHtml(color)}</p>`);
      return;
    }

    try {
      const data = await buildRepertoireTree({ ratingBand: band, color });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderRepertoirePage(data));
    } catch (err) {
      if (err instanceof ExplorerRateLimitError) {
        res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<p>Lichess Opening Explorer rate limit hit, try again shortly.</p>');
      } else if (err instanceof ExplorerApiError) {
        res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<p>Opening Explorer API request failed: ${escapeHtml(err.message)}</p>`);
      } else {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<p>Server error: ${escapeHtml(err.message)}</p>`);
      }
    }
    return;
  }

  let username = null;
  if (url.pathname === '/player') {
    username = url.searchParams.get('username');
  } else if (url.pathname.startsWith('/player/')) {
    username = decodeURIComponent(url.pathname.slice('/player/'.length));
  }

  if (!username) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found. Try / or /player/<username>');
    return;
  }

  try {
    const html = await buildPlayerPage(username);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (err) {
    if (err instanceof LichessNotFoundError) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<p>No such Lichess user: ${escapeHtml(username)}</p>`);
    } else if (err instanceof LichessRateLimitError) {
      res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<p>Lichess API rate limit hit, try again shortly.</p>');
    } else {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<p>Server error: ${escapeHtml(err.message)}</p>`);
    }
  }
}

function main() {
  const port = Number(process.argv[2]) || DEFAULT_PORT;
  const server = http.createServer((req, res) => {
    requestHandler(req, res).catch((err) => {
      res.writeHead(500);
      res.end(`Unhandled error: ${err.message}`);
    });
  });
  server.listen(port, 'localhost', () => {
    console.log(`Listening on http://localhost:${port} (local only)`);
  });
}

if (require.main === module) {
  main();
}

module.exports = { requestHandler };
