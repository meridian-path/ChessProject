'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeMoveInput, gradeMove, pickReply, applyRoundResult, advanceDelayMs, ADVANCE_BASE_MS, ADVANCE_MAX_MS } = require('../src/drillLogic');

function makeNode() {
  return {
    answerUci: 'f1c4',
    candidates: [
      { uci: 'f1c4', san: 'Bc4', games: 51300000, playedPct: 52.6, winPct: 54.1, drawPct: 8.0, lossPct: 37.9 },
      { uci: 'b1c3', san: 'Nc3', games: 6200000, playedPct: 6.2, winPct: 49.8, drawPct: 9.0, lossPct: 41.2 },
      { uci: 'd2d3', san: 'd3', games: 1000000, playedPct: 1.0, winPct: 48.0, drawPct: 10.0, lossPct: 42.0 },
    ],
  };
}

test('normalizeMoveInput lowercases and strips whitespace and annotation punctuation', () => {
  assert.equal(normalizeMoveInput('Bc4'), 'bc4');
  assert.equal(normalizeMoveInput('Bc4+'), 'bc4');
  assert.equal(normalizeMoveInput('Bc4#'), 'bc4');
  assert.equal(normalizeMoveInput('Bc4!?'), 'bc4');
  assert.equal(normalizeMoveInput(' f1c4 '), 'f1c4');
  assert.equal(normalizeMoveInput(123), '');
});

test('gradeMove: correct for the answer uci, its san, lowercase san, and san with a trailing annotation', () => {
  const node = makeNode();
  assert.equal(gradeMove({ node, input: 'f1c4' }).verdict, 'correct');
  assert.equal(gradeMove({ node, input: 'Bc4' }).verdict, 'correct');
  assert.equal(gradeMove({ node, input: 'bc4' }).verdict, 'correct');
  assert.equal(gradeMove({ node, input: 'Bc4+' }).verdict, 'correct');
});

test('gradeMove: offmeta for a real but non-answer candidate, by uci and by san', () => {
  const node = makeNode();
  const byUci = gradeMove({ node, input: 'b1c3' });
  assert.equal(byUci.verdict, 'offmeta');
  assert.equal(byUci.played.uci, 'b1c3');

  const bySan = gradeMove({ node, input: 'Nc3' });
  assert.equal(bySan.verdict, 'offmeta');
  assert.equal(bySan.played.uci, 'b1c3');
});

test('gradeMove: unknown with played null for a move matching no candidate', () => {
  const node = makeNode();
  const result = gradeMove({ node, input: 'a1a8' });
  assert.equal(result.verdict, 'unknown');
  assert.equal(result.played, null);
});

test('gradeMove: answer is always candidates[0], including in the unknown case', () => {
  const node = makeNode();
  const correct = gradeMove({ node, input: 'Bc4' });
  const offmeta = gradeMove({ node, input: 'Nc3' });
  const unknown = gradeMove({ node, input: 'a1a8' });
  assert.equal(correct.answer, node.candidates[0]);
  assert.equal(offmeta.answer, node.candidates[0]);
  assert.equal(unknown.answer, node.candidates[0]);
});

test('gradeMove throws on a node with no candidates', () => {
  assert.throws(() => gradeMove({ node: { candidates: [] }, input: 'e2e4' }), /non-empty array/);
});

test('applyRoundResult: 3 clean rounds at level 1 unlocks level 2 and resets the streak', () => {
  let state = { level: 1, cleanStreak: 0 };
  state = applyRoundResult(state, { clean: true });
  assert.deepEqual(state, { level: 1, cleanStreak: 1 });
  state = applyRoundResult(state, { clean: true });
  assert.deepEqual(state, { level: 1, cleanStreak: 2 });
  state = applyRoundResult(state, { clean: true });
  assert.deepEqual(state, { level: 2, cleanStreak: 0 });
});

test('applyRoundResult: a non-clean round resets the streak but never lowers the level', () => {
  const afterMiss = applyRoundResult({ level: 3, cleanStreak: 2 }, { clean: false });
  assert.deepEqual(afterMiss, { level: 3, cleanStreak: 0 });
});

test('applyRoundResult: level never exceeds 4', () => {
  let state = { level: 4, cleanStreak: 2 };
  state = applyRoundResult(state, { clean: true });
  assert.deepEqual(state, { level: 4, cleanStreak: 0 });
});

test('pickReply with an injected constant rand is deterministic and only ever returns a member of replies', () => {
  const replies = [
    { uci: 'f8c5', san: 'Bc5', playedPct: 60 },
    { uci: 'g8f6', san: 'Nf6', playedPct: 30 },
    { uci: 'f7f5', san: 'f5', playedPct: 10 },
  ];

  const first = pickReply(replies, 0);
  const second = pickReply(replies, 0);
  assert.equal(first, second);
  assert.ok(replies.includes(first));

  const last = pickReply(replies, 0.999999);
  assert.ok(replies.includes(last));
  assert.equal(last.uci, 'f7f5');

  // Every deterministic sample point in [0, 1) must resolve to a real member.
  for (let i = 0; i < 20; i += 1) {
    const rand = i / 20;
    const picked = pickReply(replies, rand);
    assert.ok(replies.includes(picked));
  }
});

test('pickReply throws on an empty replies array', () => {
  assert.throws(() => pickReply([], 0.5), /non-empty array/);
});

// UX audit finding: a flat 1200ms auto-advance was too fast to read the
// longer offmeta/unknown feedback messages. advanceDelayMs() scales with
// the real feedback text length instead.
test('advanceDelayMs: a short message resolves near the base delay', () => {
  const delay = advanceDelayMs('e5 - correct.');
  assert.equal(delay, ADVANCE_BASE_MS + 'e5 - correct.'.length * 15);
  assert.ok(delay < 900, `expected a short message to stay fast, got ${delay}ms`);
});

test('advanceDelayMs: a long offmeta/unknown-shaped message gets meaningfully more time than a short one', () => {
  const short = advanceDelayMs('e5 - correct.');
  const long = advanceDelayMs('Nf6 - a real move, but not the band-typical one here. The band-typical move is Bc4.');
  assert.ok(long > short, `expected the longer message (${long}ms) to get more time than the shorter one (${short}ms)`);
  assert.ok(long - short >= 500, `expected a real difference, not a rounding artifact: short=${short}ms long=${long}ms`);
});

test('advanceDelayMs: delay is capped so an arbitrarily long message never blocks the session indefinitely', () => {
  const veryLong = 'x'.repeat(1000);
  assert.equal(advanceDelayMs(veryLong), ADVANCE_MAX_MS);
});

test('advanceDelayMs: empty/missing feedback text falls back to the base delay, never throws or returns NaN', () => {
  assert.equal(advanceDelayMs(''), ADVANCE_BASE_MS);
  assert.equal(advanceDelayMs(undefined), ADVANCE_BASE_MS);
  assert.equal(advanceDelayMs(null), ADVANCE_BASE_MS);
});
