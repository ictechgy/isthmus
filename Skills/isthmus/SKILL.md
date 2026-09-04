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
  > external-retentions.json
cartograph dead --external-retentions external-retentions.json
```

Do not commit generated retention files when they contain local source paths unless the
project has explicitly chosen to version them.
