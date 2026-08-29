'use strict';

/**
 * Pure grading and progression logic for the opening drill (beta pilot).
 * No DOM, no I/O, no network -- everything here takes plain data in and
 * returns plain data out, same convention as process.js and
 * processRepertoire.js. This is also bundled straight into the browser (see
 * buildStatic.js's browser-bundle helper), which is why it has to stay pure
 * and keep the trailing module.exports block below intact.
 *
 * Every move in a drill's baked tree (see buildDrill.js) comes from the
 * Lichess Opening Explorer and is legal by construction. This module never
 * validates a move's legality -- it only ever matches a played move against
 * a known-good set of candidates for the current position.
 */

/**
 * Normalizes free-text move input for comparison: lowercased, with
 * whitespace and check/annotation punctuation (+ # ! ?) stripped. Works the
 * same whether the input is UCI ("f1c4") or SAN ("Bc4+!").
 *
 * @param {string} str
 * @returns {string}
 */
function normalizeMoveInput(str) {
  if (typeof str !== 'string') return '';
  return str.toLowerCase().replace(/[\s+#!?]/g, '');
}

/**
 * Grades one user move against a drill userNode.
 *
 * @param {object} opts
 * @param {{candidates: object[], answerUci: string}} opts.node
 * @param {string} opts.input raw move text (UCI or SAN, any case)
 * @returns {{verdict: 'correct'|'offmeta'|'unknown', played: object|null, answer: object}}
 */
function gradeMove({ node, input }) {
  if (!node || !Array.isArray(node.candidates) || node.candidates.length === 0) {
    throw new Error('gradeMove: node.candidates must be a non-empty array');
  }
  const answer = node.candidates[0];
  const normalizedInput = normalizeMoveInput(input);

  let played = null;
  for (const candidate of node.candidates) {
    if (normalizedInput === normalizeMoveInput(candidate.uci) || normalizedInput === normalizeMoveInput(candidate.san)) {
      played = candidate;
      break;
    }
  }

  let verdict;
  if (!played) {
    verdict = 'unknown';
  } else if (played.uci === node.answerUci) {
    verdict = 'correct';
  } else {
    verdict = 'offmeta';
  }

  return { verdict, played, answer };
}

/**
 * Picks one reply from an oppNode's replies list, weighted by playedPct
 * (falling back to equal weight for any reply with no usable playedPct).
 * `rand` is injected (a number in [0, 1)) instead of read from Math.random
 * internally, so callers can get deterministic output for tests.
 *
 * @param {object[]} replies
 * @param {number} [rand]
 * @returns {object} one member of `replies`
 */
function pickReply(replies, rand = Math.random()) {
  if (!Array.isArray(replies) || replies.length === 0) {
    throw new Error('pickReply: replies must be a non-empty array');
  }
  const weights = replies.map((reply) => (typeof reply.playedPct === 'number' && reply.playedPct > 0 ? reply.playedPct : 1));
  const total = weights.reduce((sum, w) => sum + w, 0);

  let threshold = rand * total;
  for (let i = 0; i < replies.length; i += 1) {
    threshold -= weights[i];
    if (threshold < 0) {
      return replies[i];
    }
  }
  return replies[replies.length - 1];
}

/**
 * Applies the outcome of one drill round to the user's saved progress.
 * Three clean rounds in a row at the current level unlock the next level
 * (capped at 4); anything else resets the clean streak but never demotes --
 * this is a beta practice pilot, not a ranked ladder.
 *
 * @param {{level:number, cleanStreak:number}} state
 * @param {{clean:boolean}} outcome
 * @returns {{level:number, cleanStreak:number}}
 */
function applyRoundResult(state, { clean }) {
  const level = state && typeof state.level === 'number' ? state.level : 1;
  const cleanStreak = state && typeof state.cleanStreak === 'number' ? state.cleanStreak : 0;

  if (!clean) {
    return { level, cleanStreak: 0 };
  }

  const nextStreak = cleanStreak + 1;
  if (nextStreak >= 3) {
    return { level: Math.min(level + 1, 4), cleanStreak: 0 };
  }
  return { level, cleanStreak: nextStreak };
}

// UX audit finding: the drill session's post-attempt feedback message used
// to auto-advance to the next card after a flat 1200ms regardless of
// length -- fine for "e5 - correct.", too fast to actually read the longer
// offmeta/unknown messages (two SAN moves plus a percentage). Scales with
// the real rendered message length instead, so a short "correct" stays
// snappy and a long explanation gets real time to read.
const ADVANCE_BASE_MS = 600;
const ADVANCE_MS_PER_CHAR = 15;
const ADVANCE_MAX_MS = 2600;

/**
 * @param {string} feedbackText the exact text shown in the feedback panel
 * @returns {number} milliseconds to wait before auto-advancing to the next card
 */
function advanceDelayMs(feedbackText) {
  const length = typeof feedbackText === 'string' ? feedbackText.length : 0;
  return Math.min(ADVANCE_MAX_MS, ADVANCE_BASE_MS + length * ADVANCE_MS_PER_CHAR);
}

module.exports = {
  normalizeMoveInput,
  gradeMove,
  pickReply,
  applyRoundResult,
  advanceDelayMs,
  ADVANCE_BASE_MS,
  ADVANCE_MS_PER_CHAR,
  ADVANCE_MAX_MS,
};
