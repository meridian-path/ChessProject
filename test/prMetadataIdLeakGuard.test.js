'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  isGhPrCreateOrEdit,
  readBodyFileContent,
  findLeakedId,
  evaluateBashCommand,
} = require('../scripts/hooks/pr-metadata-id-leak-guard');

const HOOK_PATH = path.join(__dirname, '..', 'scripts', 'hooks', 'pr-metadata-id-leak-guard.js');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pr-guard-test-'));
}

function runHook(input) {
  try {
    const stdout = execFileSync(process.execPath, [HOOK_PATH], {
      input: JSON.stringify(input),
      encoding: 'utf8',
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

test('isGhPrCreateOrEdit is true for a gh pr create call', () => {
  assert.equal(isGhPrCreateOrEdit('gh pr create --title "x" --body "y"'), true);
});

test('isGhPrCreateOrEdit is true for a gh pr edit call', () => {
  assert.equal(isGhPrCreateOrEdit('gh pr edit 123 --body "y"'), true);
});

test('isGhPrCreateOrEdit is false for an unrelated command', () => {
  assert.equal(isGhPrCreateOrEdit('git commit -m "task-abcd1234-abcdef"'), false);
});

test('isGhPrCreateOrEdit is false for a non-create/edit gh pr subcommand', () => {
  assert.equal(isGhPrCreateOrEdit('gh pr view 123 --json title'), false);
});

test('findLeakedId matches a task-id-shaped string', () => {
  assert.equal(findLeakedId('fixes task-abcd1234-abcdef for real'), 'task-abcd1234-abcdef');
});

test('findLeakedId matches a decision-id-shaped string', () => {
  assert.equal(findLeakedId('per decision-abcd1234-abcdef'), 'decision-abcd1234-abcdef');
});

test('findLeakedId returns null for clean text', () => {
  assert.equal(findLeakedId('adds strategic commentary to the opening pages'), null);
});

test('evaluateBashCommand blocks a gh pr create whose --title leaks a task id', () => {
  const result = evaluateBashCommand('gh pr create --title "fix: task-abcd1234-abcdef cleanup" --body "y"');
  assert.equal(result.block, true);
  assert.match(result.reason, /task-abcd1234-abcdef/);
});

test('evaluateBashCommand blocks a gh pr create whose heredoc --body leaks a decision id', () => {
  const command = [
    'gh pr create --title "fix: real bug" --body "$(cat <<\'EOF\'',
    'Summary',
    '- resolves decision-abcd1234-abcdef',
    'EOF',
    ')"',
  ].join('\n');
  const result = evaluateBashCommand(command);
  assert.equal(result.block, true);
  assert.match(result.reason, /decision-abcd1234-abcdef/);
});

test('evaluateBashCommand allows a clean gh pr create call', () => {
  const result = evaluateBashCommand('gh pr create --title "fix: real bug" --body "no internal ids here"');
  assert.deepEqual(result, { block: false });
});

test('evaluateBashCommand never blocks a non-gh-pr command, even one containing an id-shaped string', () => {
  const result = evaluateBashCommand('git commit -m "notes: task-abcd1234-abcdef"');
  assert.deepEqual(result, { block: false });
});

test('evaluateBashCommand blocks via --body-file when the referenced file leaks an id', () => {
  const dir = mkTmpDir();
  const bodyFile = path.join(dir, 'body.md');
  fs.writeFileSync(bodyFile, 'Real summary.\nCloses task-abcd1234-abcdef.\n', 'utf8');
  const result = evaluateBashCommand(`gh pr create --title "fix: real bug" --body-file ${bodyFile}`, { cwd: dir });
  assert.equal(result.block, true);
  assert.match(result.reason, /task-abcd1234-abcdef/);
});

test('evaluateBashCommand allows a gh pr create using a clean --body-file', () => {
  const dir = mkTmpDir();
  const bodyFile = path.join(dir, 'body.md');
  fs.writeFileSync(bodyFile, 'Real, clean summary with no internal ids.\n', 'utf8');
  const result = evaluateBashCommand(`gh pr create --title "fix: real bug" --body-file ${bodyFile}`, { cwd: dir });
  assert.deepEqual(result, { block: false });
});

test('readBodyFileContent returns null when there is no --body-file flag', () => {
  assert.equal(readBodyFileContent('gh pr create --title "x" --body "y"', process.cwd()), null);
});

test('readBodyFileContent returns null (never throws) for a missing file', () => {
  assert.equal(readBodyFileContent('gh pr create --body-file /no/such/file.md', process.cwd()), null);
});

test('hook end-to-end: PreToolUse Bash gh pr create with a leaked id exits 2 with a stderr reason', () => {
  const result = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    cwd: process.cwd(),
    tool_input: { command: 'gh pr create --title "fix: task-abcd1234-abcdef" --body "y"' },
  });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /task-abcd1234-abcdef/);
});

test('hook end-to-end: PreToolUse Bash gh pr create with clean metadata exits 0', () => {
  const result = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    cwd: process.cwd(),
    tool_input: { command: 'gh pr create --title "fix: real bug" --body "no internal ids"' },
  });
  assert.equal(result.code, 0);
});

test('hook end-to-end: ignores a non-Bash tool call even with a leaked id in its input', () => {
  const result = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    cwd: process.cwd(),
    tool_input: { file_path: 'x.txt', content: 'task-abcd1234-abcdef' },
  });
  assert.equal(result.code, 0);
});

test('hook end-to-end: ignores a non-PreToolUse event', () => {
  const result = runHook({
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    cwd: process.cwd(),
    tool_input: { command: 'gh pr create --title "task-abcd1234-abcdef"' },
  });
  assert.equal(result.code, 0);
});
