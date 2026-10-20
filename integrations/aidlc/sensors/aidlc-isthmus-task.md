---
id: isthmus-task
kind: deterministic
command: bun .claude/tools/aidlc-sensor-isthmus-task.ts
default_severity: advisory
description: Preserve recorded Isthmus task evidence without claiming current checkout verification
category: input-evidence
fire_on: gate
input_schema:
  output_path: string
  stage_slug: string
output_schema:
  pass: boolean
  findings_count: number
timeout_seconds: 10
---

# Isthmus task evidence

Reads only `<output-path>.isthmus-task.json`. Missing, stale, unverified,
unknown, malformed, unavailable, timeout and truncated evidence never passes.
Gate enforcement belongs to AI-DLC; this default advisory binding does not block it.
