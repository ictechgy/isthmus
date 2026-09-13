---
name: isthmus
description: >-
  Inspect file or symbol changes across Flutter Dart-to-Swift bridges, trace callers,
  compare snapshots, or produce cartograph retention evidence. Use before changing
  MethodChannel handlers or their Dart callers; RN and Kotlin extraction are not supported.
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

- Preflight a source change: check `isthmus --help` for `impact` (added after the
  published 0.5.0; currently requires a build of the development source).
  Run `isthmus impact --file <project-relative-path> <dart.json> <swift.json> --compact`;
  for a precise producer symbol use `--symbol <qualifiedName-or-usr>` instead.
  For multiple files, pass `--changes <json>` with
  `{"format":"isthmus-changes","version":1,"files":["lib/camera.dart","ios/Camera.swift"]}`.
  Read `reviewFiles`, `methods` (callers and handlers), `issues`, `selectedFacts`,
  `unmatchedSelectors`, and `relevantLimitations` in one response. Channel wiring
  changes include every observed method on that channel. Compact output loses no evidence.
  `--strict` fails on related errors, extraction gaps and unobserved selections.
  For deleted code use the pre-change snapshot. `scope: bridge` and `complete: false`
  mean this does not yet cover transitive language-internal or runtime dependencies.
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
- Supply Swift retention evidence, when requested:
  `isthmus retentions <dart.json> <swift.json> --for cartograph`.
  Save stdout to a new private temporary file, check successful output, then pass its path to
  `cartograph dead --external-retentions <path>`. Clean up only artifacts created for this run.

## Interpret and finish

Code 0 means the command ran successfully, not that code is safe to delete.
Code 1 from check/diff strict is a finding to report; query code 64 with
`notFound`/`ambiguous` is a usable answer, while usage errors require corrected arguments.
Code 2 indicates unreadable, invalid, or deferred inputs: explain the cause category and next step.
Empty results, `resolvedIssues`, and missing callers can reflect dynamic names or incomplete coverage.
Regenerate after source changes. Report the requested finding, relevant locations/symbols and limits.
Respect existing user authorization; ask only when missing information changes the action.
Do not commit generated facts/retentions with private project information.
