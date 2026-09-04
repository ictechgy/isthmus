---
name: isthmus
description: >-
  Use before deleting or renaming native bridge handlers, or when tracing callers across
  Flutter and other cross-platform language boundaries.
---

# isthmus

Native bridge calls are string-keyed, so a language-specific symbol index cannot see the
whole call path. Use isthmus before changing a native handler that Dart, JavaScript, or
another platform may call.

## Before deleting or renaming a bridge handler

Obtain current `bridge-facts` JSON from both sides, then run:

As of isthmus 0.1.1, cartograph produces the Swift facts. The Dart producer is not yet
released; use the repository's Phase 0 extractor only as an interim source.
Do not fabricate a missing facts file or treat an older file as current evidence.

```bash
isthmus query <channel-or-method> <bridge-facts.json> <bridge-facts.json> [more...]
```

Read the entire response:

- `usedBy` is the calling or channel-creation side.
- `dependsOn` is the handler or channel-registration side.
- `limitations` records dynamic names, stale inputs, missing symbols, or joins that were
  deliberately deferred.
- `ambiguous` provides `qualifiedName` candidates. Query the intended candidate rather
  than guessing.

A `found` match is evidence of a cross-language dependency, not permission to delete.
A `notFound` response and exit code 64 do not prove the handler is unused. Check spelling,
input freshness, dynamic-name limitations, and whether every relevant platform produced a
facts file. Regenerate facts after source changes before relying on the answer.

## Feeding the result back to cartograph

For Swift handlers, produce external retention evidence and use the same inputs:

```bash
isthmus retentions <bridge-facts.json> <bridge-facts.json> --for cartograph \
  > external-retentions.json &&
  test -s external-retentions.json &&
  cartograph dead --external-retentions external-retentions.json
```

Only continue when every command exits 0. A failed or empty retentions file is not evidence
that a native handler is unused; remove the incomplete output and regenerate both facts files.

Do not commit generated retention files when they contain local source paths unless the
project has explicitly chosen to version them.
