# isthmus

**Cross-language bridge calls in cross-platform apps, joined into one graph.**
[cartograph](https://github.com/ictechgy/cartograph) (Swift) · kartograph (Kotlin, planned) ·
[dartograph](https://github.com/ictechgy/dartograph) (Dart) each draw their own map; isthmus
joins them into one.

[한국어 문서](README.ko.md)

The name refers to an isthmus — the narrow strip of land that connects two landmasses. On a
map, it is the bridge.

## What it does, and why

Native code in a React Native or Flutter app is called from JS/Dart **by string name**:
`MethodChannel('com.example/camera')`, `NativeModules.CameraModule`. Compiler indexes cannot
see these strings. As a result:

- cartograph reports a Swift handler that Flutter calls as **unused** — a false positive
- per-language analysis alone struggles to catch "Dart calls `invokeMethod('takePhoto')` but
  no Swift handler exists" **before the build** — a runtime crash
- for the same reason, "this channel exists in Swift but nothing in Dart calls it" is a
  cross-boundary fact that is hard to judge from any single per-language tool

isthmus joins the **bridge facts** each language tool exports (channel names, method names,
registration sites, invocation sites) by string key, builds the edges that cross the boundary,
and answers those three questions. It then hands the result **back to cartograph/kartograph as
retention evidence** — "keep Swift `CameraHandler.takePhoto`, because `lib/camera.dart:42`
calls it over channel `com.example/camera`".

## Status

**0.3.0.** Implements the bridge-facts version 1 parser, `check`, `query`, `graph`, `diff`,
the external retention evidence round trip for cartograph, and check baselines that suppress
accepted findings by logical issue identity while preserving their evidence. isthmus enforces
fail-closed behavior for external input, mixed targets, graph size, and the Dart/Swift Phase 0
extraction boundary. Facts that could not be joined are re-counted on the consumer side, and
retention subjects whose evidence cannot be built are refused loudly, so neither disappears
silently. Coverage gaps a receiver reports about itself come back as undecidable, not as
mismatches. Limitations are attributed to the reporting document's target, so gap mitigation
never leaks into other targets' diagnostics. Next: dogfooding it on a real Flutter app, and
React Native support.

The supported producers are cartograph 0.5.3+ and dartograph 0.1.1+. Both were verified on
their real output, and on a Swift USR ↔ Dart invocation evidence round trip over the public
battery plugin.

| Document | Contents |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | What, for whom, how far |
| [`docs/PLAN.md`](docs/PLAN.md) | Step-by-step plan. **cartograph and dartograph have prerequisite work** |
| [`docs/GRAPH-EXCHANGE.md`](docs/GRAPH-EXCHANGE.md) | The bridge-facts format the sister tools export — the contract shared across the sister repositories |
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | Confirmed facts vs. unconfirmed claims |
| [`experiments/phase-0/`](experiments/phase-0/) | Temporary Dart/Swift extractors, pinned JSON, hand-join verification |

Internal documents are maintained in Korean, the maintainer's working language.

## Dependency picture

```
cartograph    ──bridges──┐
kartograph    ──bridges──┼──▶ isthmus ──▶ boundary edges · mismatch reports · retention evidence
dartograph    ──bridges──┤
JS/TS extractor ─bridges─┘
```

isthmus itself is small. The heavy lifting — interpreting each language — falls to the
sister tools.

## Install

Requires Node.js 22.18.0 or later.

Install globally and run it under the CLI name `isthmus`:

```bash
npm install --global isthmus-cli
isthmus --help
```

For a one-off run without installing, name the package explicitly:

```bash
npx isthmus-cli --help
```

Do not use `npx isthmus` — that installs a different package with the same name.

## Usage

isthmus never runs the sister tools itself. You hand it the JSON files they produced:

```bash
isthmus check dart-bridges.json swift-bridges.json
```

List all commands and the installed package version:

```bash
isthmus --help
isthmus --version
```

To make CI fail when bridge errors exist, add `--strict`:

```bash
isthmus check dart-bridges.json swift-bridges.json --strict
```

### Baselines

To accept the current findings as a baseline, write them to a file once and apply that file
from the next run onward:

```bash
isthmus check dart-bridges.json swift-bridges.json --update-baseline isthmus-baseline.json
isthmus check dart-bridges.json swift-bridges.json --strict --baseline isthmus-baseline.json
```

`--update-baseline` does not suppress the run that writes it; it rewrites the whole file — an
isthmus-owned `isthmus-baseline` version 1 document — from the current issues, so resolved
items drop out automatically. `--baseline` suppresses only the issues whose logical identity
(code, target, channel, method) matches an entry, so moving source lines never breaks
suppression and a new channel or method mismatch is never suppressed. Suppressed issues are
not deleted: they keep their facts, evidence, and severity, gain a `suppressed` marker, and
are excluded only from the summary error/warning counts and the `--strict` decision. Entries
that match no issue are counted in `staleBaselineEntries`, so a baseline hiding a future
regression stays visible in the report. An unreadable, non-JSON, or contract-violating
baseline file fails with exit code 2. The two flags cannot be combined in one run, and a value
starting with `-` is rejected (including legitimate file names that start with `-`). `--update-baseline` combined
with `--strict` still writes the file, and the exit code follows that run's unsuppressed
errors. If more than 10,000 entries would be recorded, the command fails with exit code 2
instead of leaving an artifact it cannot consume. Writes go through a temporary file in the
same directory (atomic rename), so an interrupted run cannot corrupt an existing baseline.

### Retention evidence

To return matched Swift handlers to cartograph as retention evidence:

```bash
isthmus retentions \
  dart-bridges.json swift-bridges.json \
  --for cartograph > external-retentions.json

cartograph dead --external-retentions external-retentions.json
```

`retentions` prefers each handler's USR and falls back to its `qualifiedName`. A
`mixed-targets` document cannot have per-fact targets restored in v1, so every consuming
command defers the join with exit code 2; split such a document per target at production time
first.

cartograph retains Swift symbols only, so `--for cartograph` requires at least one
receiver-side Swift document and refuses with exit code 2 instead of emitting an empty
retention document. If a matched Swift handler has callers but no `symbol`, and therefore
cannot become evidence, the command fails with the same code rather than producing a partial
document: a retention file with missing evidence makes live handlers look unused to the
consumer.

Every consuming command requires at least one caller-side (dart) and one receiver-side (swift)
platform document. Given only one side, it refuses with exit code 2 rather than misreading a
one-sided observation as a boundary mismatch. Input failure messages state the cause (read
failure, JSON error, exchange contract violation, project mismatch, missing platform
composition, size limit), the input position, and how to resolve it, and never expose input
bodies or paths.

To verify the whole path from production to consumption on a real public Flutter plugin, run
this from the repository root. The script does a sparse checkout of a pinned `plus_plugins`
commit, confirms the retention evidence for three methods in the battery plugin's original
Dart and Swift sources, and removes the temporary checkout. It needs network access, Git
2.26+, Swift 6, cartograph 0.5.3+, and dartograph 0.1.1+. isthmus is rebuilt from the current
sources automatically; a third argument can point at a separate isthmus JavaScript artifact.

```bash
npm run build
node scripts/verify-public-flutter-plugin.mjs \
  /path/to/cartograph \
  /path/to/dartograph
```

The public plugin verification checks the Swift USRs from the original `addMethodCallDelegate`
implementation and the three original Dart call sites, and verifies that cartograph
`--explain` reads the representative evidence for those symbols. It does not force a
dead-state transition on an already-public plugin handler; that transition and the
`setMethodCallHandler` path are covered separately by the synthetic corpus in
`verify-cartograph-roundtrip.mjs`.

### Query and graph

To see which locations on the other side of the boundary a channel or method connects to:

```bash
isthmus query takePhoto dart-bridges.json swift-bridges.json
```

To emit only the boundary edges as JSON, Graphviz DOT, or Mermaid:

```bash
isthmus graph dart-bridges.json swift-bridges.json
isthmus graph dart-bridges.json swift-bridges.json --format dot
isthmus graph dart-bridges.json swift-bridges.json --format mermaid
```

When the same method exists on several channels, `query` returns candidates instead of picking
one; feed a returned `qualifiedName` back into the same subject position to disambiguate.
`graph` emits matched edges only and preserves the input `limitations` as a JSON field or as
DOT/Mermaid comments. If the Cartesian product of evidence would exceed 100,000 edges, the
command fails with exit code 2 to prevent a memory blowup.

### What check reports

The output is `isthmus-check` version 1 JSON, reporting these facts:

- `unhandled-invocation` (error): an invocation exists but no native handler does
- `unregistered-channel-creation` (error): a caller-side channel creation exists but no
  native registration does
- `registration-without-creation` (warning): a native channel registration exists but no
  caller-side creation does
- `handler-without-invocation` (warning): a native handler exists but no caller-side use does
- `unhandled-invocation-unverified` (warning): the same fact as the first item, but the
  receiver reported that it may have missed handlers, so "absent" and "not seen" cannot be
  distinguished
- `unregistered-channel-creation-unverified` (warning): registration undecidable for the same
  reason

The `-unverified` kinds come from limitations in receiver-side documents. For example, in a
plugin whose Flutter handler is written in Objective-C, cartograph reports
`objective-c-sources:` and may fail to enumerate the handler facts completely. Asserting
"unhandled invocation" as an error there would recreate the very false positive this tool
exists to remove. The facts and evidence are still reported, but `--strict` does not fail.
Gap kinds are distinguished: a channel registration with a non-literal name downgrades channel
diagnostics only, never method diagnostics. The mitigation unit is the diagnostic's target —
facts join per target only, so a gap reported by another target's receiver document never
downgrades the current target's diagnostics, and a gap from a receiver document with no facts
applies to all targets because nothing can be attributed. Caller-side limitations never hide
native code, so they do not affect severity, and unknown limitation wording is never
interpreted as a gap.

Since 0.2.0, isthmus reads the optional v1 `limitationScopes`. `{ limitationIndex, channels }`
is a conservative channel upper bound for that limitation as a whole — never merely a list of
literals that happened to be found. Without scopes, or when a scoped entry coexists with
another unscoped gap, the existing whole-target mitigation stands. An empty channel set or an
invalid index is an input error. Scopes are preserved as `channels` through
check/query/graph/diff. A producer's tool name alone never drives mitigation: `unjoined-*`
counts mitigate only when they carry the consumer-attached `origin: "consumer"`.

The optional fact field `sourceLanguage: "objective-c"` distinguishes ObjC implementations in
`.m`/`.mm` files from the Swift graph. These facts carry no symbol. Their matches stay in
check/query/graph but are excluded from the Swift retention list, and
`omittedObjectiveCHandlers` reports how many were excluded. A matched Swift handler that has
callers but no `symbol` and no `sourceLanguage` marker still fails with exit code 2.
Consumers supporting this extension must ship before producers: old consumers drop scopes
(mitigating broadly) and fail to produce ObjC retentions.

Every issue carries its observed locations as `evidence`. Dynamic names, unresolved receivers
or handler bodies, missing USRs, input generation-time differences, and mixed targets stay in
`limitations` with their provenance. This tool never decides whether code is safe to delete.

isthmus output documents treat added fields and new issue codes within version 1 as compatible
changes; the document version is raised only when an existing field's meaning changes or the
field is removed.

`limitations` holds both producer-reported and isthmus-counted limitations. Each entry states
its provenance and attribution with `platform`, `target`, and `tool`; entries with
`origin: "consumer"` were observed at the join stage. Facts that could not be joined are
re-counted per platform and target, regardless of what producers reported or how many they
reported:

- `unjoined-dynamic-channels`: channel create/register facts with a non-literal name
- `unjoined-dynamic-methods`: invoke/handle facts with a non-literal name
- `unjoined-unattributed-handlers`: handler facts that belong to no known channel

Duplicate facts at the same location are counted once. A handler that is both dynamic and
unattributed is counted as dynamic only.

| Exit code | Meaning |
|---|---|
| `0` | Success. In default mode, issues are reported but do not fail the run |
| `1` | `--strict` found error issues (for `diff`: newly observed errors only). `-unverified` warnings and baseline-suppressed errors do not fail |
| `2` | Tool failure: file read, JSON, exchange contract, project mismatch, missing platform composition, deferred join, size limits (input text, graph edges, baseline entries), baseline file or write errors, retention evidence that cannot be built. stderr distinguishes the cause |
| `64` | Bad command, option, or input count; or `query` `notFound`/`ambiguous` |

For development from a checkout, run `npm ci` first. Development verification runs the type
check and a clean build, enforces 90% product-code coverage, and exercises the real CLI and
package contract checks together:

```bash
npm run verify
```

To verify the external retention round trip with the two real producers, pass cartograph
0.5.3+, the dartograph binary, and a fixture root both tools can analyze. This needs producer
binaries and a compiler index, so it is not part of `npm run verify` or public CI; run it
manually before a release.

```bash
node scripts/verify-cartograph-roundtrip.mjs \
  /path/to/cartograph \
  /path/to/dartograph \
  /path/to/FalsePositiveCorpus
```

To verify that producer-emitted `limitationScopes` reach the consumer and relax diagnostics at
channel granularity, run the self-contained scope dogfood. It synthesizes a minimal Swift
package with a delegated handler registration — a literal channel whose handler body the
scanner cannot inspect, the one shape whose channel upper bound is provable — plus a Dart
caller, and checks that only the scoped channel's unhandled invocation becomes an unverified
warning while an adjacent unhandled invocation and an unregistered channel creation stay
errors. It needs cartograph 0.9.0+, dartograph 0.1.1+, and Swift 6, and performs no network
access.

```bash
node scripts/verify-limitation-scopes.mjs \
  /path/to/cartograph \
  /path/to/dartograph
```

## Comparing before and after a change (0.1.4+)

To compare the Dart and Swift exchange files of one project before and after a change:

```bash
isthmus diff \
  --before before-dart.json before-swift.json \
  --after after-dart.json after-swift.json --strict
```

`isthmus-diff` v1 outputs, as JSON: added and removed logical method connections, newly
observed and no-longer-observed issues, the analysis limitations at both snapshots and their
difference, and producer versions and generation times. Connections include caller and handler
locations. Line moves do not count as connection changes, and renames are never inferred.
Caller/handler replacement under the same logical key, and per-call-site additions or
removals, are outside this comparison.

`--strict` exits 1 only when a newly observed error exists. With only pre-existing errors,
warnings, or limitations, it exits 0, so a success code never means "safe to delete" or "fully
analyzed". `resolvedIssues` likewise means a previous mismatch is no longer observed — check
the limitations to see whether a dynamic transition or an extractor change caused it.
`--strict` is recognized at any argument position and cannot be given more than once.

`diff` currently accepts only Flutter Dart/Swift documents. Both platforms are required at
each point in time, and the two snapshots must agree on `project` and on the per-platform,
per-tool document counts. Build each revision from the same checkout path and keep the JSON.
Do not compare a partial extraction against a full one; use the same analysis settings. Input
files are capped at 256 total, and the text size limits match the rest of the CLI. Mixed
targets or incomparable inputs are refused with exit code 2. `generatedAt` is the fact
extraction time, not an indicator of revision order — the comparison direction comes from the
`--before` and `--after` arguments, so you must point them at the right revisions.

## Coding-agent skill

[`Skills/isthmus/SKILL.md`](Skills/isthmus/SKILL.md) provides a skill that teaches agents to
check other languages' callers with `query` before deleting or renaming a native bridge
handler. Copy it into your agent's project skill directory.

Codex discovers the same text through the `.agents/skills/isthmus` link in this checkout.
Edit only `Skills/isthmus/SKILL.md`; the npm package includes it. Skill content verification
and per-model tuning rationale are in the [agent audit record](docs/AGENT-AUDIT.md).

## License

[MIT](LICENSE). Free forever, including commercial use.
