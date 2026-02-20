# OrgX Runtime Reporting

Use this skill when a Claude Code session must report execution state to OrgX.

## Workflow

1. Resolve context IDs from env/args:
- `ORGX_INITIATIVE_ID`
- `ORGX_WORKSTREAM_ID`
- `ORGX_TASK_ID`
- `ORGX_RUN_ID` or `ORGX_CORRELATION_ID`

2. Emit execution activity:
- phase: `intent`, `execution`, `handoff`, `completed`, or `blocked`
- message: concrete, evidence-based

3. If a file/artifact is produced:
- register artifact with summary and path

4. If blocked:
- request a decision with explicit options and impact

5. On completion:
- mark task done using a changeset when task id is known

## Quality Bar

- Never post empty or generic updates.
- Include IDs whenever available.
- Use `source_client=claude-code`.
