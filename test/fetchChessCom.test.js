'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  fetchArchives,
  fetchArchiveGames,
  ChessComNotFoundError,
  ChessComRateLimitError,
  ChessComApiError,
} = require('../src/fetchChessCom');

// All tests below use a hand-built fake fetch -- no live network calls are
// made anywhere in this file. Fixture shapes match a real, live-verified
// response (see this file's own module header comment for the exact curl
// command and date).
function fakeResponse({ status = 200, statusText = 'OK', json = null, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: { get: (name) => headers[name.toLowerCase()] || null },
    json: async () => json,
  };
}

test('fetchArchives resolves with the archives array on success', async () => {
  const fetchImpl = async () => fakeResponse({
    status: 200,
    json: { archives: ['https://api.chess.com/pub/player/hikaru/games/2026/07', 'https://api.chess.com/pub/player/hikaru/games/2026/08'] },
  });
  const archives = await fetchArchives('hikaru', { fetchImpl });
  assert.deepEqual(archives, ['https://api.chess.com/pub/player/hikaru/games/2026/07', 'https://api.chess.com/pub/player/hikaru/games/2026/08']);
});

test('fetchArchives returns an empty array rather than throwing when the response has no archives field', async () => {
  const fetchImpl = async () => fakeResponse({ status: 200, json: {} });
  const archives = await fetchArchives('nobody-yet', { fetchImpl });
  assert.deepEqual(archives, []);
});

test('fetchArchives throws ChessComNotFoundError on 404 (real, verified live: {"code":0,"message":"User \\"x\\" not found."})', async () => {
  const fetchImpl = async () => fakeResponse({ status: 404, statusText: 'Not Found' });
  await assert.rejects(() => fetchArchives('this-user-should-not-exist-zzz999xyz', { fetchImpl }), ChessComNotFoundError);
});

test('fetchArchives throws ChessComRateLimitError on 429, carrying retry-after', async () => {
  const fetchImpl = async () => fakeResponse({ status: 429, statusText: 'Too Many Requests', headers: { 'retry-after': '10' } });
  await assert.rejects(async () => {
    try {
      await fetchArchives('anyone', { fetchImpl });
    } catch (err) {
      assert.ok(err instanceof ChessComRateLimitError);
      assert.equal(err.retryAfter, '10');
      throw err;
    }
  }, ChessComRateLimitError);
});

test('fetchArchives throws ChessComApiError on other non-ok statuses', async () => {
  const fetchImpl = async () => fakeResponse({ status: 500, statusText: 'Internal Server Error' });
  await assert.rejects(() => fetchArchives('anyone', { fetchImpl }), ChessComApiError);
});

test('fetchArchives requests the real archives URL, username-encoded', async () => {
  let capturedUrl = null;
  const fetchImpl = async (url) => {
    capturedUrl = url;
    return fakeResponse({ status: 200, json: { archives: [] } });
  };
  await fetchArchives('Some User', { fetchImpl });
  assert.equal(capturedUrl, 'https://api.chess.com/pub/player/Some%20User/games/archives');
});

// -- fetchArchiveGames --------------------------------------------------------
// Fixture game shape matches a real fetched game (hikaru, month 2026-08,
// verified live before this module was written) -- see fetchChessCom.js's
// own header comment.

function realGameFixture(overrides = {}) {
  return {
    url: 'https://www.chess.com/game/live/172385979790',
    pgn: '[Event "Live Chess"]\n[White "Hikaru"]\n[Black "only_strong_moves"]\n[Result "1-0"]\n\n1. d4 d5 2. Nf3 Nf6 1-0\n',
    time_control: '180',
    end_time: 1785598371,
    rated: true,
    time_class: 'blitz',
    rules: 'chess',
    white: { rating: 3466, result: 'win', username: 'Hikaru', uuid: 'x' },
    black: { rating: 2884, result: 'resigned', username: 'only_strong_moves', uuid: 'y' },
    ...overrides,
  };
}

test('fetchArchiveGames resolves with the games array on success', async () => {
  const game = realGameFixture();
  const fetchImpl = async () => fakeResponse({ status: 200, json: { games: [game] } });
  const games = await fetchArchiveGames('https://api.chess.com/pub/player/hikaru/games/2026/08', { fetchImpl });
  assert.equal(games.length, 1);
  assert.equal(games[0].white.username, 'Hikaru');
  assert.equal(games[0].time_class, 'blitz');
});

test('fetchArchiveGames returns an empty array rather than throwing when the response has no games field', async () => {
  const fetchImpl = async () => fakeResponse({ status: 200, json: {} });
  const games = await fetchArchiveGames('https://api.chess.com/pub/player/x/games/2020/01', { fetchImpl });
  assert.deepEqual(games, []);
});

test('fetchArchiveGames fetches the archive URL verbatim (never rebuilds it from parts)', async () => {
  let capturedUrl = null;
  const fetchImpl = async (url) => {
    capturedUrl = url;
    return fakeResponse({ status: 200, json: { games: [] } });
  };
  const archiveUrl = 'https://api.chess.com/pub/player/hikaru/games/2026/08';
  await fetchArchiveGames(archiveUrl, { fetchImpl });
  assert.equal(capturedUrl, archiveUrl);
});

test('fetchArchiveGames throws ChessComApiError on a non-ok status', async () => {
  const fetchImpl = async () => fakeResponse({ status: 500, statusText: 'Internal Server Error' });
  await assert.rejects(() => fetchArchiveGames('https://api.chess.com/pub/player/x/games/2020/01', { fetchImpl }), ChessComApiError);
});
