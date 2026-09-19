# isthmus

**Cross-language bridge calls in cross-platform apps, joined into one graph.**
[cartograph](https://github.com/ictechgy/cartograph) (Swift) · [kartograph](https://github.com/ictechgy/kartograph) (Kotlin) ·
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
and answers those three questions. It then hands the result **back to cartograph as
retention evidence** — "keep Swift `CameraHandler.takePhoto`, because `lib/camera.dart:42`
calls it over channel `com.example/camera`".

## Status

**0.6.0** supports Flutter Dart ↔ Swift/Kotlin change preflight, MethodChannel and
Pigeon/BasicMessageChannel facts, declared runtime scenarios, and content-based capture reuse.
It adds `impact --file`/`--symbol`/`--changes` (with lossless `--compact` JSON and a
gap-aware `--strict` gate), `preflight <context.json>` with `--summary`/`--explain` over
producer impact paths, and `verify-runtime --expectations`. Actual macOS and Android fixture
apps have exercised public plugin APIs. See [preflight](docs/PREFLIGHT.md),
[runtime verification](docs/RUNTIME.md), and
[building from pinned source commits](docs/TOOLCHAIN.md) for setup and measured limits.

The **0.8.0** release uses this compatible producer set:
cartograph **0.20.0**, kartograph **0.11.0**, and dartograph **0.15.0** — see
[compatible versions (Korean)](docs/COMPATIBILITY.md) for install commands, a
fixed end-to-end example, and a CI sketch. MethodChannel joins and the retention
round trip are supported from cartograph 0.5.3+ and dartograph 0.1.1+ — exercised on a
public battery plugin — and the round trip was re-verified on the previous public
set (cartograph 0.15.1, dartograph 0.10.0, isthmus 0.6.0).
React Native module/component facts (`module-import`↔`module-export`,
`component-require`↔`component-export`) join by name inside the `react-native`
target. An optional `mechanism` field keeps the core and Expo resolution paths
apart: Expo `requireNativeModule`-family imports reach core and Expo exports
through the TurboModuleRegistry fallback, while `requireNativeViewManager`
requires a mechanism match, and a name observed only through a different
mechanism is reported as a `*-mechanism-mismatch` warning instead of a missing
counterpart. Imports made through absence-tolerant lookups
(`requireOptionalNativeModule`, `TurboModuleRegistry.get`/`getNullable`) carry
`optional: true`; when every caller of a missing module tolerates absence, the
finding is the `module-import-without-export-optional` warning rather than an
error. `isthmus extract-js` extracts caller-side facts from JS/TS sources
(`NativeModules.*`, `TurboModuleRegistry.get*`,
`requireNativeComponent`/`codegenNativeComponent`,
`requireNativeModule`-family calls, and resolved member calls), and cartograph
and kartograph scan the Expo Modules DSL (`Module`/`definition()`, `Name`,
`Function`, `View`, `@ExpoModule`/`@JS`) and mark those exports
`mechanism: "expo"` — end-to-end RN joins are reproducible within the
token-scan observation scope documented in `GRAPH-EXCHANGE.md`.
EventChannel v2 transport is implemented across the sister repositories, and
`check` now consumes the v2 Bridge/Event documents directly with
transport-specific diagnostics. Retention export targets cartograph (Swift/Objective-C) and kartograph (Kotlin/JVM). Full application coverage and first-time external setup remain
unverified.

Change predictions are measured against a pinned public precision corpus —
`battery_plus`, `shared_preferences_foundation`, `url_launcher_macos`, and the
**LocalSend** app — over 15 file/symbol/version-diff cases. The latest run
recorded **TP 83 / FN 0 / FP 0**, including the first app-level
Dart↔Swift↔Kotlin join ([`experiments/real-corpus/`](experiments/real-corpus/)).
These are static bridge-boundary numbers over stub-compiled Swift and
source-scanned Kotlin; runtime execution and full-app precision are not
measured.

| Document | Contents |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | What, for whom, how far |
| [`docs/PLAN.md`](docs/PLAN.md) | Step-by-step plan. **cartograph and dartograph have prerequisite work** |
| [`docs/GRAPH-EXCHANGE.md`](docs/GRAPH-EXCHANGE.md) | The bridge-facts format the sister tools export — the contract shared across the sister repositories |
| [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) | Compatible public versions, fixed example, and CI setup |
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | Confirmed facts vs. unconfirmed claims |
| [`experiments/real-corpus/`](experiments/real-corpus/) | Pinned public-plugin/app precision corpus (TP/FN/FP counts) |
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

Change preflight is available with `impact --file`, `--symbol`, or `--changes`, plus
lossless `--compact` JSON and a gap-aware `--strict` gate. See
[change preflight](docs/IMPACT.md) for the build command, contract, and current
bridge-only scope.
Android development support uses `selection.kotlin` and a kartograph snapshot. It connects
Kotlin Method/Basic facts to Dart consumers and matches Android observations only to Kotlin
candidates. See [Android capture](docs/PREFLIGHT.md#android-수집) and [toolchain builds](docs/TOOLCHAIN.md).
`verify-runtime --expectations` checks recorded calls
by revision, scenario, platform, and engine instance. See the [runtime contract](docs/RUNTIME.md).
The optional [Flutter recorder](packages/isthmus_runtime/README.md) has been exercised
in real macOS and Android apps, including the Pigeon-generated APIs of
`url_launcher_macos 3.2.2` and `shared_preferences_android 2.4.1`. Transitive producer impact
and snapshot capture are implemented; broader application coverage and first-time setup remain
under validation.

0.6.0 exposes `preflight <context.json> --strict --compact` to compose
producer impact paths across the bridge. A separate capture workflow caches declared
input content and has passed a synthetic source test with real producers. See
[cross-language preflight](docs/PREFLIGHT.md) for the contract, CI setup, and remaining
real-application validation.
`isthmus init [capture.json]` scaffolds that capture config — `--toolchain` fills real
producer commands from a built `toolchain.json` — and `isthmus doctor <capture.json>`
validates the config and checks that the referenced executables resolve on `PATH` or at
the given path, without running them.
To combine that context with recorded execution, pass runtime JSON files and
`--expectations <checks.json>`. Preflight reports revision alignment, native candidates,
and static boundaries missing observations or declared scenarios; existing static gaps remain visible.

Use `preflight <context.json> --summary --strict --compact` for a bounded overview, then
`--explain <exact-producer-symbol-id>` for a complete path to one symbol. Summary defaults
to 20 items per collection (`--limit 1..100`); omitted items still affect review status.
Optional [Basic/Pigeon v2 inputs](docs/BRIDGE-MESSAGES.md) connect literal addresses and
proven prefix candidates. Prefix matches preserve unresolved
suffix and instance wiring. These additions are available in the public producer
versions listed above (`bridges --messages`).
Agent clients can call the same commands over `isthmus serve`, an MCP stdio server
that exposes check, query, graph, diff, impact, preflight, and retentions as tools.
See the [MCP server contract](docs/MCP.md).
To reproduce a verified development combination or audit the toolchain, build the tools
from pinned local Git commits with the
[toolchain build workflow (Korean)](docs/TOOLCHAIN.md). It produces a standalone
Dart executable, a cartograph executable with both impact and message support,
and an isolated installation of the isthmus package.

The isthmus CLI reads JSON produced by the sister tools. The optional capture workflow
runs the preparation and producer commands declared in its configuration:

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

Options may appear before or after the input files in any command (`isthmus graph --format dot
dart-bridges.json swift-bridges.json` works). Because a value that starts with `-` is always
read as the next option, paths or names that begin with `-` go after a `--` separator, which
ends option parsing: `isthmus query -- -unusual-name dart-bridges.json swift-bridges.json`.
`-h`/`--help` shows help from any position, `isthmus help <command>` names a command's usage,
and an unknown command prints the root help.

### React Native caller facts

For a React Native app, `isthmus extract-js` produces the caller-side document
itself — pass JS/TS files or directories, and feed the result to `check`
alongside the Swift and Kotlin documents the sister tools emit:

```bash
isthmus extract-js src/ --project . > js-bridges.json
isthmus check js-bridges.json ios-bridges.json android-bridges.json
```

The output is the same `bridge-facts` version 1 document the sister tools
produce, so every consuming command accepts it unchanged.

### SARIF output

To upload check results to GitHub code scanning (or any SARIF 2.1.0 consumer), ask for SARIF
instead of the isthmus-check JSON:

```bash
isthmus check dart-bridges.json swift-bridges.json --format sarif > isthmus.sarif
```

The default is `--format json`, which keeps the versioned isthmus-check document. SARIF is an
additive, isthmus-owned rendering of the same join: every issue becomes a result with its
`check` issue code as the rule id, the first evidence endpoint as the primary location
(project-relative paths become percent-encoded, repository-relative URIs), remaining
endpoints as related locations, and baseline-suppressed issues carry an `external`
suppression. Results include a
`partialFingerprints` hash of the logical issue identity (code, target, channel, method), so
deduplication survives source line moves exactly like baseline suppression.

### GitLab Code Quality output

To surface check results in GitLab merge request widgets, emit a Code Quality
artifact instead:

```bash
isthmus check dart-bridges.json swift-bridges.json --format codequality > gl-code-quality-report.json
```

Every unsuppressed issue becomes one finding at its first evidence endpoint: `check_name`
is `isthmus:` plus the issue code, `severity` maps errors to `major` and warnings to
`minor`, and `fingerprint` reuses the same logical-issue hash as SARIF, so GitLab merges
findings across runs. The format has no suppression concept, so baseline-accepted issues
are left out rather than resurfaced as new findings — note that when the baseline is
applied on merge request pipelines but not on the default branch, GitLab's comparison
can present those accepted issues as "fixed" by the merge request.

`--strict`, `--baseline`, and `--update-baseline` combine with any format and keep their
documented exit-code behavior.

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

`retentions` uses compiler identities; Swift declarations may fall back to `qualifiedName`. When a method is
invoked from several caller locations, the evidence carries all of them in `callers` (the
representative first `caller` stays for older consumers) and counts any entries beyond the
100-per-retention cap in `callersOmitted` instead of dropping them silently. A
`mixed-targets` document cannot have per-fact targets restored in v1, so every consuming
command defers the join with exit code 2, reporting how many observed facts across how many
documents could not be joined; split such a document per target at production time
first.

In 0.8.0, `--for cartograph` requires a Swift platform document and
`--for kartograph` requires a Kotlin platform document. Kotlin needs an actual JVM node ID;
Objective-C implementations need an actual Clang `c:` USR. Missing identities fail with code 2.
Use cartograph 0.20.0+ for indexed Clang declarations and kartograph 0.11.0+ for external retentions. Kartograph also rejects IDs absent from its graph.

```bash
isthmus retentions dart.json kotlin.json --for kartograph > kotlin-retentions.json
# Add --external-retentions kotlin-retentions.json to your normal kartograph dead arguments.
```

Every consuming command requires at least one caller-side (dart/js) and one receiver-side (swift/kotlin)
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
one; feed a returned `qualifiedName` back into the same subject position to disambiguate. A
`qualifiedName` is `target:` followed by percent-escaped components — `%`, `#`, and `:` are
escaped — so splitting on the first `:` and on `#` and decoding the parts always recovers the
channel and method names. Module and component subjects carry a `module:`/`component:` kind
segment before the name so a channel, a module, and a component that share a name stay
resolvable. A `notFound` or `ambiguous` query exits 64 and prints a one-line
cause on stderr, so a script can tell a bad invocation from a missing name without parsing
stdout.
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

React Native name boundaries follow the same pairing — a `require`/`import` with no
matching `export` is an error, an `export` with no caller is a warning:

- `module-import-without-export` (error) / `-unverified` (warning)
- `module-import-without-export-optional` (warning): every caller used an absence-tolerant
  API, so the app degrades rather than crashes when the export is missing
- `module-export-without-import` (warning)
- `component-require-without-export` (error) / `-unverified` (warning)
- `component-export-without-require` (warning)
- `module-import-mechanism-mismatch`, `module-export-mechanism-mismatch`,
  `component-require-mechanism-mismatch`, `component-export-mechanism-mismatch` (warnings):
  the name exists on the other side but only through an incompatible core/Expo
  resolution path

`check` also consumes BasicMessageChannel and EventChannel bridge-facts v2 documents and
reports transport-specific diagnostics with the same pairing:

- `unhandled-message-send` (error) / `-unverified` (warning): a Dart Basic send has no
  native message handler
- `message-handler-without-send` (warning): a native Basic handler has no Dart send
- `unhandled-stream-listen` (error) / `-unverified` (warning): a Dart Event stream listener
  has no native stream handler
- `stream-handler-without-listen` (warning): a native Event handler has no Dart listener

A dynamic `channelPrefix` route is a candidate, not a verdict — it is carried as the
`dynamic-message-address`/`dynamic-stream-address` consumer limitation and, with no observed
counterpart, additionally as `unmatched-message-boundary`/`unmatched-stream-boundary`; a
dynamic address with no proven prefix is counted as `unresolved-message-addresses`. A literal
boundary whose missing side is covered by a prefix candidate is downgraded the same way
rather than reported as an error. The summary adds `matchedMessages`/`matchedStreams` (literal
matches only) when v2 inputs are present. `query` resolves v2 boundaries as `message`/`stream`
kind subjects, `graph` emits `message`/`stream` edges for literal matches, and `diff` reports
added/removed literal v2 boundaries plus v2 diagnostics. `retentions --for cartograph` keeps
literal v2 Swift handlers with method-less evidence; `impact` still requires v1 inputs and
rejects version 2.

The `summary` carries the issue counts plus observation volume: `observedFacts` is the total
number of facts across all input documents and `observedLimitations` counts the reported
analysis limitations. This keeps a project with no bridges and a run that observed nothing
from producing indistinguishable reports — an `observedFacts` of 0 means the producers saw
nothing to describe.

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

The optional `sourceLanguage: "objective-c"` field identifies implementations in `.m`/`.mm`
files. Their actual Clang USRs can be exported as retentions with cartograph 0.20.0+ and isthmus 0.8.0+.
A matched Objective-C declaration without a Clang USR fails with code 2. The legacy
`omittedObjectiveCHandlers` field remains a limitation in older documents; new exports do not
silently omit these matches. Swift declarations without any symbol also fail.

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

`diff` accepts caller documents (Flutter Dart or React Native JS) plus either Swift or Kotlin
receiver documents. Keep one native language per comparison.
Both sender and receiver documents are required at
each point in time, and the two snapshots must agree on `project`, on the observed set of
bridge targets, and on the per-platform,
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

## RN event boundaries

`extract-js --events` and the sibling tools' `bridges --rn-events` produce a separate v2
transport for core RN global events. `--events` selects an event-only document; run a separate
`extract-js` command without that flag for v1 module/component/method facts. `check`, `query`, `graph`, and `diff` join literal names;
unmatched subscriptions/emissions are warnings. Expo module events and preflight/runtime
comparison are outside this scope. See the [contract and scan scope](docs/BRIDGE-RN-EVENTS.md).
