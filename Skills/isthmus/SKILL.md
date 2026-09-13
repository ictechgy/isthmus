---
name: isthmus
description: >-
  Inspect file or symbol changes across Flutter Dart-to-Swift bridges, trace callers,
  compare snapshots, or produce cartograph retention evidence. Use before changing
  MethodChannel or Pigeon/Basic handlers and their Dart callers; RN and Kotlin extraction are not supported.
---

# isthmus

Use current bridge facts to answer the requested boundary question. This skill supplies
analysis evidence; it does not authorize source edits, deletion, publishing, or a wider audit.

## Inputs

Use `isthmus-cli` 0.1.4+ (`isthmus` binary), cartograph 0.5.3+ and dartograph 0.1.1+.
Obtain both Dart and Swift bridge-facts JSON with identical project roots and analysis scope.
Swift production requires a built compiler index; use `cartograph bridges --target flutter --format json`.
Do not fabricate missing facts or rewrite project identifiers just to make a join pass.
If inputs are missing, identify the required files and proceed with independent authorized work.

## Choose the requested operation

- Trace transitive cross-language impact when a current producer context is available
  (development source, after 0.5.0):
  `isthmus preflight <context.json> --summary --strict --compact`.
  Add `--revision <expected-capture-revision>` when the workflow supplied that revision.
  Read the whole-report `summary` and `requiresReview`, then bounded collections
  `{total, items, omitted}` for roots, affected symbols, review files and limitations.
  Default display limit is 20; `--limit <1..100>` only applies to summary. Omitted
  entries were analyzed and still affect status. For a requested symbol's complete
  root-to-target path, replace `--summary` with `--explain <exact-key-or-producer-id>`
  from the preview. Exact qualifiedName is also accepted; ambiguous matches return
  candidates with code 64. `result.path` is a full array; each step's relations are
  bounded. Describe those actual steps; do not substitute a similarly named root
  from summary. A path through shared registration may be broader than the requested
  method's execution path. Do not combine summary and explain. Omit both flags only when the full
  report is needed; it includes `affected[].via`, `boundaries` and all evidence.
  Distinguish language use edges
  from bridge evidence; dependency boundaries do not imply changes to every caller
  of an unchanged native handler. Do not repeat queries for evidence already present.
  Use the source-generation workflow to refresh stale context; do not hand-author
  missing producer identities or analyses. The separate `scripts/capture-preflight.mjs`
  workflow executes configured preparation and producer commands, so use the project's
  established configuration and existing authorization. Its fingerprint covers declared
  inputs; inspect that scope before reusing the cache. The `.sources.json` sidecar retains
  original producer reports. Report paths are relative to `project`; verify existence
  before making local links. Code 1 preserves a usable report with gaps; `noChanges`
  only means no modeled source selection. To also verify runtime evidence, use
  `isthmus preflight <context.json> <runtime.json> [more...] --expectations <checks.json> --summary --strict --compact`.
  Read `runtime.aligned` as well as `runtime.verification.status`, `unobservedBoundaries`,
  `uncoveredBoundaries`, and route `staticStatus`. Passing unrelated scenarios or matching
  old expectations/logs cannot verify the current change. Basic/Pigeon static support
  requires optional v2 `context.messages` from both producers; without it Basic is
  unsupported for static matching. `matching: prefix` remains a possible address
  family, with unresolved suffix/instance wiring even after a successful runtime call.
  Address matches remain native candidates. Raw message limitations appear separately
  as `messageLimitations` when message inputs are present.
  For a runtime-only dynamic route, follow `candidateKey` into `runtime.candidates` for
  native source evidence. In summary/explanation, `candidates.items[].handlers` is a
  bounded collection of source locations/symbols; report its `omitted` count. The full
  report uses `handlersOmitted` for its native-candidate display cap.
  `passedChecks` counts expectations, not distinct scenarios. In summary/explanation,
  `runtime.verification.declaredScenarioPlatforms` counts unique declared scenario/platform
  pairs; it is not a count of passing scenarios. Multiple checks can share one scenario.
- Preflight a source change: check `isthmus --help` for `impact` (added after the
  published 0.5.0; currently requires a build of the development source).
  Run `isthmus impact --file <project-relative-path> <dart.json> <swift.json> --strict --compact`;
  for a precise producer symbol use `--symbol <qualifiedName-or-usr>` instead.
  For multiple files, pass `--changes <json>` with
  `{"format":"isthmus-changes","version":1,"files":["lib/camera.dart","ios/Camera.swift"]}`.
  Read `reviewFiles`, `methods` (callers and handlers), `issues`, `selectedFacts`,
  `unmatchedSelectors`, and `relevantLimitations` in one response. Channel wiring
  changes include every observed method on that channel. Compact output loses no evidence.
  Impact already includes both sides; do not repeat a channel query just to retrieve
  the same endpoints. Evidence paths are relative to report `project`, not the CLI
  working directory. Make local file links only after confirming the files exist;
  for non-local snapshots, give the reported relative path and line as evidence.
  `--strict` returns code 1 on related errors, extraction gaps and unobserved selections;
  read its JSON as the preflight result instead of rerunning the same inputs without the flag.
  For deleted code use the pre-change snapshot. `scope: bridge` and `complete: false`
  do not establish complete coverage of language-internal or runtime dependencies.
  When current runtime evidence is available, add `--runtime <runtime.json> --revision <revision>`.
  Inspect `runtime.routes`, failures/gaps and `runtime-observation` reasons. These add
  native handler candidates for dynamically named calls, not proof of a particular
  native symbol executing. Static unresolved facts remain unresolved for untested paths.
  If the installed CLI lacks impact, use `query` on bridge names found in the source
  and report that file-based preflight requires the newer implementation.
- Audit the boundary: `isthmus check <dart.json> <swift.json> [--strict]`.
  Read `summary`, each `issues[].code/severity/evidence`, and `limitations`.
  `-unverified` codes are undecidable findings, not clean results.
  To accept current findings, run once with `--update-baseline <file>`; apply it
  later with `--baseline <file>`. Suppressed issues keep their evidence and only
  leave the summary counts and `--strict` failures; report `staleBaselineEntries`
  as resolved items to prune on the next update.
- Trace callers: `isthmus query <channel-or-method> <dart.json> <swift.json>`.
  Read `usedBy`, `dependsOn`, symbol evidence, and `limitations`.
  `ambiguous` returns qualified-name candidates; disambiguate from context or ask when necessary.
- Review a change: `isthmus diff --before <old-dart.json> <old-swift.json> --after <new-dart.json> <new-swift.json> --strict`.
  Inspect added/removed logical methods, introduced/resolved issues, both sets of limitations,
  and producer versions/timestamps. Revisions come from the caller's before/after choice.
  Same-key endpoint changes and rename inference are outside this comparison.
- Verify recorded runtime calls (development source, after 0.5.0):
  `isthmus verify-runtime --expectations <checks.json> <runtime.json> [more...] --strict --compact`.
  Expectations must be specified independently of the observed log. Check `status`,
  `summary`, unsuccessful `checks`, `failures`, and stale/incomplete `runs`.
  `passed` covers only declared scenarios; missing, stale, dropped or pending evidence
  cannot establish coverage. `evidenceOmitted` is display truncation; `droppedEvents`
  means collection loss. Do not fabricate logs when the runtime recorder is unavailable.
  Expected negative scenarios can declare `allowedOutcomes` explicitly; omitted means
  success only. Preserve expected and unexpected failure counts. Pending calls, stale
  runs, and missing observations cannot be allowed outcomes.
- Supply Swift retention evidence, when requested:
  `isthmus retentions <dart.json> <swift.json> --for cartograph`.
  Save stdout to a new private temporary file, check successful output, then pass its path to
  `cartograph dead --external-retentions <path>`. Clean up only artifacts created for this run.

## Interpret and finish

Code 0 means the command ran successfully, not that code is safe to delete.
Code 1 from check/diff/impact/preflight/verify-runtime strict is a finding or evidence gap to report;
query code 64 with
`notFound`/`ambiguous` is a usable answer, while usage errors require corrected arguments.
Code 2 indicates unreadable, invalid, or deferred inputs: explain the cause category and next step.
Empty results, `resolvedIssues`, and missing callers can reflect dynamic names or incomplete coverage.
Regenerate after source changes. Report the requested finding, relevant locations/symbols and limits.
Respect existing user authorization; ask only when missing information changes the action.
Do not commit generated facts/retentions with private project information.
