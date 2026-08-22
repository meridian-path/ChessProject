# Session D scope: repertoire-builder (session-chess)

This file defines what a fourth, independent Claude Code session (Session D, agent name
`session-chess`) is authorized to do when working inside this repository (ChessProject /
repertoire-builder.com), as part of Orchestra's multi-session operating model. Session A
(TheOrchestra) is the primary coordination session; Session B (filetools) and Session C (Brand
& Audience) are already running; Session D owns the repertoire-builder product end to end. All
sessions coordinate through one shared, external state store (homedir-anchored,
machine-global - see TheOrchestra's own `orchestrator/lib/paths.js` and
`docs/PLATFORM_STATE_ARCHITECTURE_EVAL_2026-08-19.md`), not separate companies.

Orchestra's full action policy (`.claude/CLAUDE.md` in TheOrchestra - the AUTONOMOUS/ALWAYS
ESCALATE split and the enforced human gate) applies here unchanged. This file narrows WHERE
Session D may act inside that policy. It does not loosen the policy itself.

Approved 2026-08-22 via `docs/PER_ASSET_SESSION_PROPOSAL_2026-08-22.md` (TheOrchestra repo),
with amendments carried into this file below.

## Territory

This repository only. Session D never reads or writes any other repository's working tree -
not TheOrchestra's own code, not filetools, not lol-practice-system. The one exception is
invoking TheOrchestra's own `orchestrator/lib/cli.js` by absolute path as a client of the
shared state store (see Duties below) - that is using the tool, not touching its repo.

## Permitted - full product lifecycle, from day one

Unlike Session B's original narrower start (page builds only), Session D owns the full
product lifecycle for repertoire-builder from the outset:

- **Builds.** New content/page work, feature builds, and bug fixes against repertoire-builder's
  own GitHub repo, drawn from queue tasks tagged `"asset": "repertoire-builder"` in the shared
  central queue (see `conduct-lite.md` for how to pull them), or identified and queued by this
  session itself.
- **SEO / content-gap work.** What HQ dispatched ad hoc to `growth` before this session existed -
  keyword/content-gap scans, internal-linking passes, sitemap checks - run on this session's own
  judgment of cadence, not waiting for an ad-hoc HQ dispatch each time.
- **Quality maintenance.** Lighthouse regression checks, accessibility passes, broken-link/
  sitemap sweeps - same standing cadence latitude as above.
- **Propose its own content/growth ideas** as queued tasks or decision briefs, same mechanism
  any role already uses.
- The ordinary local dev/QA loop: install deps, run the test suite, run visual-qa, run
  Lighthouse, read/edit/write any file inside this repo.
- Everything TheOrchestra's `.claude/rules/qa.md` self-QA checklist and
  `.claude/rules/design-standards.md` already require of any builder task - both apply here in
  full, unchanged. Read them from TheOrchestra's checkout since this repo has no local copy.

## Forbidden

- **Orchestrator state and protocol.** Never hand-edit any file under `orchestrator/` in
  TheOrchestra's checkout, never edit `orchestrator/config.json`, never touch the external
  state root's files directly. Only ever go through the shared CLI's own verbs (claim,
  heartbeat, checkpoint, complete, usage, add, propose-decision) exactly as any other Orchestra
  agent does.
- **Distribution.** No drafting, posting, publishing, or scheduling anything outbound - that
  stays session-brand's (Session C's) lane, absolutely, gated by
  `.claude/rules/distribution.md` unchanged. A launch or announcement need gets handed to
  session-brand as a queued task, exactly the pattern already validated by F1 Podium-igami's
  launch-packet handoff.
- **Money, accounts, ToS.** Same ALWAYS ESCALATE list as everywhere else in Orchestra - no
  spend, no new accounts or API keys, no agreeing to any terms of service.
- **Other repos.** See Territory above.
- **The canonical-CLI cutover regime.** This session launches and operates under the CURRENT
  proven regime only: absolute-path CLI calls to TheOrchestra's primary checkout, and
  territory-scoped claims. The homedir-anchored canonical-code-root redirect
  (`orchestrator/lib/coderoot.js`'s `code-sync`/re-exec mechanism, per
  `docs/PLATFORM_CODE_DISTRIBUTION_AND_CLAIM_SCOPING_EVAL_2026-08-22.md`) stays INACTIVE for
  this session until Phase 3 of the per-asset-session proposal lands and a separate, explicit
  cutover decision brief is approved - never opt into it early on your own judgment, even if a
  `code-sync`'d canonical root happens to exist on disk at some point.

## Duties

- **Log usage to the central store.** Every task completion logs real spend through the shared
  CLI's `usage`/`complete` path, exactly like any other Orchestra agent - Session D's spend is
  Orchestra's spend, not a separate budget.
- **Heartbeat the central store as a distinct, stable session** - agent name `session-chess`,
  role `chief_of_staff`, kept stable across every run. This is what lets the tier governor
  (`orchestrator/lib/bandwidth.js`) count Session D alongside every other standing session when
  computing real burn headroom.
- **File cross-scope needs to the central queue, never act on them.** If Session D's own work
  surfaces something outside this scope (a distribution idea, a real spend need, a defect in
  another repo, anything on the ALWAYS ESCALATE list), `add` it to the shared queue tagged for
  the right asset/department, or `propose-decision` if it is a real escalation - then leave it
  and move to the next in-scope task. Never widen scope to "just handle it."
- **Never block on the human.** If a specific repertoire-builder task needs a human answer, log
  it as a human-ask (`human-ask-open`) and move to the next claimable repertoire-builder task
  rather than sitting idle - the same standing rule every other session already follows.

## Invoking the shared coordination CLI from this repo

This repo has no local copy of `orchestrator/lib/`. Invoke it by absolute path from
TheOrchestra's checkout:

```
node "C:\Users\dylan\Dev\TheOrchestra\orchestrator\lib\cli.js" <verb> ...
```

The state root it resolves to is machine-global (homedir-anchored, not tied to which repo the
command is run from) - see `paths.js`'s own header comment in that checkout. This works
correctly from any working directory, including this one.
