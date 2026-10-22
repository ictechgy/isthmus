# Explicit HTTP and database contract changes

`diff --contracts` compares two declaration captures, including changes at the same
HTTP method/path or database relation name. It is separate from `diff --http`
(route matching) and bridge `impact` (always incomplete bridge reachability).

```sh
isthmus diff --contracts --before base.facts.json --after head.facts.json \
  --clients released-client.facts.json --limit 100 --compact
```

CLI and MCP `contract_diff` share this implementation. MCP accepts `before`,
`after`, optional `clients`, `limit` (1–1000, default 100), `compact`, and `strict`.
Input paths are ordinary bridge-facts JSON files, not HTTP surface artifacts or
workspace manifests. Use captures with one project, domain, producer inventory,
dispatch, and source-set scope. Client inputs are held fixed and joined with each
declaration snapshot independently. Removed declarations retain before callers;
renames appear as removal and addition. No edge crosses snapshots.

The result is `isthmus-contract-diff` v1. `changes` retains before/after field
observations and declaration locations/USRs. `reviewCallers.before/after` come from
existing relation/route matching, including ambiguous route candidates. The result
does not run full producer traversal; use those exact IDs with producer impact or
the existing trace context for continuation. It does not claim test failures or
authorize skipping tests. Equal fields and empty changes do not establish safety.

`complete` remains false. Missing contracts, dynamic declarations, producer and
join limitations, capture scope, 2,000 declaration/100,000 field preparation caps,
output limits, and caller omissions remain visible. Each change shows at most 50
callers per snapshot. Exceeding a preparation budget is an error, not partial
success. Input UTF-8 text and normalized document hashes identify the compared
artifacts; source/build alignment remains unknown. Revision labels and timestamps
are not a freshness proof. Recapture both sides after changing source or tools.

`--strict` returns 1 on observed changes or supplied/observed evidence gaps; code 0
only means the operation completed without those observations. Read `complete`,
`scope`, and all limitations even on code 0. Invalid input is 2, usage errors 64.

## Producer extension

`route-contract`, `route-decl`, and `relation-decl` may carry `dataContract`:

```json
{"version":1,"fields":[{"in":"response-body","path":"200/application~1json/email","type":"string","nullable":false,"required":true}],"limitations":[]}
```

Each field has unique `(in,path)`; `in` is `request-body`, `response-body`, `query`,
`header` for HTTP or `column`, `constraint` for SQL. Optional `type`, `nullable`,
and `required` are only explicit observations; absence means unknown. The path is
producer-defined and includes response status/media type where relevant. No
rename, type coercion, covariance, nested schema or runtime behavior is inferred.
Maximum 512 fields, 1,024 UTF-16 units per path/type, 128 limitations of 2,048 units.
Unknown versions, malformed fields and duplicate keys are rejected.

Tsograph's opt-in OpenAPI producer emits bounded primitive field evidence and
lists omitted schemas. Schemagraph emits catalog column type/nullability and
structural constraint fingerprints, with defaults/CHECK bodies and application
compatibility explicitly unassessed. Old producers remain accepted and are shown
as `contract-unavailable`. Existing `diff --http` continues to report its original
`fieldCompatibility: not-assessed`; callers must select this new mode explicitly.

Regression coverage uses compiled producers plus bounded SQLite/OpenAPI changes,
same-route field changes, deletion, rename, unknown contracts, scope mismatch,
output budgets, and CLI/MCP parity. This is not a whole-application accuracy claim.
