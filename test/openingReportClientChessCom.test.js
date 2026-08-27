'use strict';

// Client-side coverage for the Chess.com platform picker (site-audit item 3,
// 2026-08-26) -- same technique and same scope boundary as
// test/openingReportClientEscaping.test.js (that file's own header comment
// explains why: openingReport.client.js is a browser-only IIFE with no
// module exports, so this stubs just enough of document/window/fetch to let
// the *real*, unmodified module run its normal init() at require()-time).
//
// This file covers the NEW untrusted-input sink (`?platform=`) and the
// platform-aware branches of the existing sinks, at the same "prove the
// client actually uses the validator" level test/leakAnalysis.test.js and
// test/fetchChessCom.test.js can't reach on their own. It deliberately does
// NOT attempt a full happy-path fetch->analyse->render simulation -- neither
// does the existing Lichess suite (bandLookup's own same-origin shard fetch
// would need mocking too, a cost the original feature's own test suite never
// paid either); that correctness is already covered where it actually lives,
// at the pure-function layer (test/leakAnalysis.test.js's 45 passing tests,
// test/fetchChessCom.test.js's 10).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const CLIENT_PATH = path.join(__dirname, '..', 'src', 'browser', 'openingReport.client.js');

function noop() {}

/**
 * Same harness as openingReportClientEscaping.test.js's runClientWith(),
 * extended with a `report-platform` <select> stub and an observable fetch
 * call log (still rejects every call by default -- a happy path is out of
 * this file's scope, per its own header comment -- but records the URL of
 * the first attempted call so a test can assert WHICH platform's endpoint
 * the client tried to reach, without needing the request to succeed).
 */
function runClientWith({ search = '', hash = '', localStorageGet = () => null, initialPlatform = 'lichess' } = {}) {
  const statusEl = { innerHTML: '', querySelector: () => null };
  const resultEl = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
  const usernameInput = { value: '', placeholder: '' };
  const platformSelect = { value: initialPlatform, _listeners: {}, addEventListener: (evt, fn) => { platformSelect._listeners[evt] = fn; } };
  let submitHandler = null;
  const formEl = {
    addEventListener: (evt, handler) => {
      if (evt === 'submit') submitHandler = handler;
    },
  };
  const elementsById = {
    'report-status': statusEl,
    'report-result': resultEl,
    'report-form': formEl,
    'report-username': usernameInput,
    'report-platform': platformSelect,
  };

  global.document = {
    readyState: 'complete',
    getElementById: (id) => (Object.prototype.hasOwnProperty.call(elementsById, id) ? elementsById[id] : null),
    addEventListener: noop,
  };
  global.window = {
    location: { href: `https://example.test/opening-report.html${search}${hash}`, search, hash, pathname: '/opening-report.html', origin: 'https://example.test' },
    history: { replaceState: noop },
    localStorage: { getItem: localStorageGet, setItem: noop },
    addEventListener: noop,
  };
  const fetchCalls = [];
  global.fetch = (url) => {
    fetchCalls.push(String(url));
    return Promise.reject(new Error('this test never lets a fetch actually resolve -- see this file\'s own header comment'));
  };

  // Deliberately NOT deleting global.document/window/fetch in a `finally`
  // here, unlike openingReportClientEscaping.test.js's own harness: several
  // tests below reach renderSuccessScreen(), which (for a 'lichess'-platform
  // report) kicks off renderPlayerHistorySection()'s OWN floating fetch
  // promise -- one that resolves/rejects on a LATER microtask, after this
  // function has already returned. Deleting the globals synchronously here
  // made that later callback crash on a missing `document` (a test-harness
  // artifact, not a real bug -- a real browser's `document` never
  // disappears mid-session). The next runClientWith() call reassigns fresh
  // stubs before use regardless, so leaving these set between tests in this
  // one file is safe.
  delete require.cache[require.resolve(CLIENT_PATH)];
  require(CLIENT_PATH);

  return {
    statusHtml: statusEl.innerHTML,
    resultHtml: resultEl.innerHTML,
    submitHandler,
    usernameInput,
    platformSelect,
    fetchCalls,
  };
}

test('?platform=chesscom&username=<xss> renders as visible escaped text, never as markup, and issues no request', () => {
  const payload = '<img src=x onerror=alert(1)>';
  const { resultHtml, fetchCalls } = runClientWith({ search: `?platform=chesscom&username=${encodeURIComponent(payload)}` });
  assert.doesNotMatch(resultHtml, /<img src=x onerror=alert\(1\)>/);
  assert.match(resultHtml, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(fetchCalls.length, 0);
});

test('a too-short Chess.com username (below the real 3-char floor) is rejected with Chess.com-shaped copy, not Lichess\'s', () => {
  const { resultHtml, fetchCalls } = runClientWith({ search: '?platform=chesscom&username=ab' });
  assert.match(resultHtml, /isn't a Chess\.com-shaped username/);
  assert.equal(fetchCalls.length, 0);
});

test('a valid Chess.com username triggers a real request to the Chess.com archives endpoint, not Lichess\'s', async () => {
  const { fetchCalls } = runClientWith({ search: '?platform=chesscom&username=Hikaru' });
  // init() kicks off runReport() as a floating promise; give it a tick to
  // reach its first fetch call before asserting.
  await new Promise((resolve) => { setTimeout(resolve, 10); });
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0], /^https:\/\/api\.chess\.com\/pub\/player\/Hikaru\/games\/archives$/);
});

test('an unrecognized ?platform= value falls back to "lichess" rather than being trusted or reflected', () => {
  const { resultHtml } = runClientWith({ search: '?platform=stockfish-arena&username=a' });
  // 'a' is below BOTH platforms' length floors, but the message text itself
  // proves which validator/copy path actually ran -- 'lichess', not
  // whatever was in the untrusted param.
  assert.match(resultHtml, /isn't a Lichess-shaped username/);
});

test('platform param absent entirely still behaves exactly as the pre-existing Lichess-only behavior did', () => {
  const { resultHtml } = runClientWith({ search: '?username=a' });
  assert.match(resultHtml, /isn't a Lichess-shaped username/);
});

test('a saved localStorage report with platform:"chesscom" sets the platform select to match on load', () => {
  const report = {
    format: 'leak-report/1',
    generated: new Date().toISOString(),
    band: '1600-1800',
    pool: 'blitz',
    username: 'hikaru',
    platform: 'chesscom',
    gamesFetched: 25,
    gamesUsable: 25,
    gamesInCoverage: 0, // 0 in-coverage games still renders (a genuinely empty leaks/watch state), simplest fixture that avoids needing a full band-data-shaped leak
    leaks: [],
  };
  const { platformSelect, resultHtml } = runClientWith({ localStorageGet: (key) => (key === 'rb.leakReport.v1' ? JSON.stringify(report) : null) });
  assert.equal(platformSelect.value, 'chesscom');
  assert.match(resultHtml, /No leak cleared our statistical floor/);
});

test('a saved localStorage report with no platform field at all (pre-dates this field) defaults the select to "lichess"', () => {
  const report = {
    format: 'leak-report/1',
    generated: new Date().toISOString(),
    band: '1600-1800',
    pool: 'blitz',
    username: 'clubplayer',
    gamesFetched: 25,
    gamesUsable: 25,
    gamesInCoverage: 0,
    leaks: [],
  };
  const { platformSelect } = runClientWith({ localStorageGet: (key) => (key === 'rb.leakReport.v1' ? JSON.stringify(report) : null), initialPlatform: 'chesscom' });
  assert.equal(platformSelect.value, 'lichess');
});
