---
description: Session D's lightweight conduct pass, scoped to repertoire-builder only. Re-orients from this repo's own rolling plan and the shared demand-mined/asset-tagged task list, then builds.
---

Wear the `builder` hat for this session, inside the boundaries in `SESSION_SCOPE.md` at this
repo's root - read it in full before anything else if this is the first run this session.

1. **Re-orient.** Read `SESSION_SCOPE.md` (territory/permitted/forbidden/duties) and
   `ROLLING_PLAN.md` in this repo. If `ROLLING_PLAN.md` doesn't exist yet, create it from the
   skeleton at the bottom of this file - it is this repo's own equivalent of TheOrchestra's
   `docs/ROLLING_PLAN.md`, scoped to repertoire-builder only.
2. **Heartbeat as a distinct, stable session** - not a bare task agent:
   ```
   node "C:\Users\dylan\Dev\TheOrchestra\orchestrator\lib\cli.js" heartbeat session-chess --role chief_of_staff
   ```
   `session-chess` is the fixed agent name for this session - keep it stable across every run so
   the tier governor recognizes it as one ongoing session, not a new one each pass.

   **Re-issue this same heartbeat command at every natural mid-build checkpoint**, not just
   once here - before/after any step likely to take more than a few minutes (a test run, a
   build, a visual-QA/Lighthouse pass, a live-API fetch, anything that runs a while).
   `chief_of_staff`'s reap threshold is 5 minutes; a single build step running longer than that
   with no intervening heartbeat gets this session's real in-progress work incorrectly flagged
   `stale_for_review`/phantom-stall by the reaper - harmless (the claim survives), but it costs
   real investigation time to confirm nothing is actually stuck, every single time it fires.
3. **Pull this session's task list**, filtered to this repo's own scope:
   ```
   node "C:\Users\dylan\Dev\TheOrchestra\orchestrator\lib\cli.js" frontier --role builder --full
   ```
   then keep only entries whose `"asset"` field is `"repertoire-builder"`. Also run a bare
   `frontier --full` scan (no `--role` filter) at least once per pass - a repertoire-builder
   task can land with `assigned_role: null` and get missed by a role-filtered pull alone (this
   has happened to other sessions before).
4. **Claim and build** the next one, using `session-chess` as your claim agent name:
   ```
   node "C:\Users\dylan\Dev\TheOrchestra\orchestrator\lib\cli.js" claim <taskId> --agent session-chess
   ```
   Build it per that task's own description. TheOrchestra's `.claude/rules/qa.md` self-QA
   checklist and `.claude/rules/design-standards.md` apply in full - read them from
   TheOrchestra's checkout since this repo has no local copy. Always work in a dedicated
   `git worktree add` off this repo, never a direct edit in this shared checkout - other
   sessions/agents may touch it too.
5. **Complete/checkpoint through the same shared CLI**, same as any other Orchestra builder
   task - `complete`/`checkpoint-with-full-result`, with the four mandatory `--digest-*`
   fields. `push-branch`/PR conventions for this repo are unchanged by any of this.

   **If your branch's PR conflicts because another branch merged first (or you just want the
   fetch -> rebase -> test -> push cycle done for you), use TheOrchestra's own merge-queue tool
   instead of resolving it by hand:**
   ```
   node "C:\Users\dylan\Dev\TheOrchestra\orchestrator\lib\cli.js" merge-queue-add --repo <your dedicated worktree path> --branch <your-branch> --base master --test-command "npm test" --agent session-chess
   node "C:\Users\dylan\Dev\TheOrchestra\orchestrator\lib\cli.js" merge-queue-run --agent session-chess
   ```
   Point `--repo` at your OWN dedicated worktree, same rule as step 4 above - never the shared
   checkout. The queue fetches the latest `master`, rebases your branch onto it, re-runs your
   `--test-command`, and force-with-lease-pushes the result - it never merges or opens a PR for
   you (this repo's PRs stay human-merged, unchanged). Check
   `node "C:\Users\dylan\Dev\TheOrchestra\orchestrator\lib\cli.js" merge-queue-status` afterward
   for the outcome (`ready_for_human_merge`/`rebase_failed`/`test_failed`/etc. - a failure just
   means the branch is left rebased-but-unpushed for you to fix and re-run, nothing is lost).
   Validated end to end against a sibling product repo's own real `npm test` command
   (2026-08-23, tested against lol-practice-system) - no code changes were
   needed for external-repo adoption; the tool's own external-repo path runs directly against
   whatever `--repo` you give it, guarded by the same claim-check `push-branch` already uses
   (blocked if some other agent has a live claim on this repo, keyed by directory basename
   against the task's own `asset`/`footprint`).
6. **If you hit anything outside `SESSION_SCOPE.md`'s Permitted list** - money, accounts,
   distribution, another repo, orchestrator state itself, or the canonical-CLI cutover - stop
   that thread, file it per `SESSION_SCOPE.md`'s Duties (`add`/`propose-decision` to the shared
   queue), and move to the next claimable repertoire-builder task. Never block on the human and
   never widen scope to "just handle it."
7. **Update this repo's own `ROLLING_PLAN.md`** with a short handoff note before ending the
   session - same convention as TheOrchestra's own `/conduct`.
8. **Loop back**, same as `/conduct`: once dispatched work in this pass completes, re-enter
   from step 1 rather than stopping after one task, while real claimable repertoire-builder
   work remains in the shared queue.

## `ROLLING_PLAN.md` skeleton (create if missing)

```markdown
# repertoire-builder rolling plan (Session D)

Session D's own living state, scoped to this repo only. Full protocol: `SESSION_SCOPE.md` in
this repo's root; shared queue/decision mechanics:
`C:\Users\dylan\Dev\TheOrchestra\.claude\rules\protocol.md`.

## Session state
_As of <timestamp>:_ (fill in at every session close - what shipped, what's in flight, next
claimable task)

## Standing notes
- Heartbeat/claim agent name: `session-chess`
- Central state root: resolved automatically by the shared CLI (homedir-anchored,
  machine-global) - no local setup needed.
```
