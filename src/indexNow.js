'use strict';

/**
 * IndexNow (https://www.indexnow.org/documentation) key-file plumbing. No
 * account/API key request is needed -- a site self-issues a key, proves
 * ownership by hosting `<key>.txt` at its own root (containing just the
 * key), then any push to the IndexNow API is accepted for that host. One
 * submission fans out to every participating engine (Bing, Yandex, Naver,
 * Seznam, Yep) -- see scripts/indexNowPing.js for the actual submission.
 *
 * The key is not a secret (it's served publicly at <key>.txt by design, the
 * same trust model as a Google Search Console HTML-file verification token)
 * -- committing it in source is correct, not a leak.
 */

const { SITE_ORIGIN } = require('./site');

const INDEXNOW_KEY = '7eec7f4128ac0116dbb4e58daf2d5189';

function indexNowKeyFileName() {
  return `${INDEXNOW_KEY}.txt`;
}

function indexNowKeyFileContent() {
  return `${INDEXNOW_KEY}\n`;
}

function indexNowHost() {
  return SITE_ORIGIN.replace(/^https?:\/\//, '');
}

module.exports = {
  INDEXNOW_KEY,
  indexNowKeyFileName,
  indexNowKeyFileContent,
  indexNowHost,
};
