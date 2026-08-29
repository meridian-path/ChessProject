'use strict';

/**
 * Claude Code PreToolUse hook: blocks a `gh pr create`/`gh pr edit` Bash call
 * whose title or body would leak an internal task-/decision-id-shaped string
 * onto this repo's public remote. This workspace previously had no such
 * hook at all, so a real, measured fraction of past PRs shipped a leaked id
 * (the fleet-wide PR-metadata gate only guards the internal orchestrator's
 * own create-pr CLI verb, never a per-asset workspace's own direct
 * `gh pr create` calls).
 *
 * Reuses SOURCE_HYGIENE_ID_PATTERNS from scripts/verifyAggregates.js -- this
 * repo's own existing task-/decision-id regex, already relied on by check 8
 * (source-side hygiene scan) -- rather than a third, independent redefinition
 * of the same two patterns.
 *
 * Scope is deliberately id-shape only, not the full HYGIENE_PATTERNS list
 * check 7 uses: a bare role-name/doc-filename match would false-positive
 * constantly on this repo's own legitimate commit-message area-tag
 * convention (e.g. "growth: ...", "platform: ...") and on ordinary chess
 * prose that happens to share a word with an internal role name -- see
 * check 7's own CLEARED-item precedent for why that broader list is a
 * scan-and-triage tool, not a hard PR-blocking gate.
 *
 * Scans the WHOLE Bash command string (not just a parsed --title/--body
 * flag value) so a heredoc-embedded body (`--body "$(cat <<'EOF' ... EOF)"`,
 * this repo's own standard PR-body convention) is caught too, since the
 * heredoc's literal text sits directly in the command string -- a stricter
 * flag-value-only parse would miss it. --body-file <path> is the one case
 * where the real content is NOT in the command string; that path's file
 * contents are read and scanned separately.
 *
 * Claude Code hook contract: reads one JSON object from stdin
 * ({hook_event_name, tool_name, tool_input, cwd, ...}); exit code 2 blocks
 * the tool call and feeds stderr back to the model as the block reason;
 * exit code 0 allows it.
 */

const fs = require('fs');
const path = require('path');
const { SOURCE_HYGIENE_ID_PATTERNS } = require('../verifyAggregates');

const GH_PR_CREATE_EDIT_RE = /\bgh\s+pr\s+(?:create|edit)\b/;
const BODY_FILE_RE = /--body-file[=\s]+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+)/;

function stripQuotes(value) {
  if (!value) return value;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

/** True if this Bash command is a `gh pr create`/`gh pr edit` invocation. */
function isGhPrCreateOrEdit(command) {
  return typeof command === 'string' && GH_PR_CREATE_EDIT_RE.test(command);
}

/**
 * Resolves a --body-file <path> reference (if present) against `cwd` and
 * returns its contents, or null if there's no such flag or the file can't
 * be read (never throws -- a missing/unreadable file is gh's own problem to
 * report, not this guard's).
 */
function readBodyFileContent(command, cwd) {
  const m = BODY_FILE_RE.exec(command);
  if (!m) return null;
  const filePath = stripQuotes(m[1]);
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(cwd || process.cwd(), filePath);
  try {
    return fs.readFileSync(resolved, 'utf8');
  } catch {
    return null;
  }
}

/** @returns {string|null} the first matched leaked id, or null if clean. */
function findLeakedId(text) {
  for (const re of SOURCE_HYGIENE_ID_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

/**
 * Full evaluation of one Bash tool call. Returns {block: false} to allow it,
 * or {block: true, reason} to block it.
 */
function evaluateBashCommand(command, { cwd } = {}) {
  if (!isGhPrCreateOrEdit(command)) return { block: false };

  const bodyFileContent = readBodyFileContent(command, cwd);
  const leaked = findLeakedId(command) || (bodyFileContent && findLeakedId(bodyFileContent));
  if (!leaked) return { block: false };

  return {
    block: true,
    reason:
      `pr-metadata-id-leak-guard: this "gh pr create"/"gh pr edit" call would publish the ` +
      `internal identifier "${leaked}" in a PR title/body on this repo's public remote. ` +
      `Remove the internal task-/decision-id reference (rephrase in plain language) before ` +
      `opening or editing the PR.`,
  };
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    raw += chunk;
  });
  process.stdin.on('end', () => {
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      process.exit(0); // malformed input -- never block on our own parse failure
    }

    if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Bash') {
      process.exit(0);
    }

    const command = input.tool_input && input.tool_input.command;
    const result = evaluateBashCommand(command, { cwd: input.cwd });
    if (result.block) {
      process.stderr.write(`${result.reason}\n`);
      process.exit(2);
    }
    process.exit(0);
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  GH_PR_CREATE_EDIT_RE,
  BODY_FILE_RE,
  isGhPrCreateOrEdit,
  readBodyFileContent,
  findLeakedId,
  evaluateBashCommand,
};
