# ADR-0001: OpenClaw Core to Claude Code Plugin

- Status: Accepted
- Date: 2026-02-16
- Initiative: `9b543d86-ea3e-47b8-8109-7160547f2745`

## Context

The existing OrgX OpenClaw plugin contains:
- OrgX MCP tool surface
- runtime telemetry hooks
- OpenClaw-specific HTTP/dashboard/onboarding behavior

Claude Code plugin architecture differs:
- plugin manifest at `.claude-plugin/plugin.json`
- component directories (`hooks/`, `commands/`, `agents/`, `skills/`)
- plugin-provided MCP servers via manifest or `.mcp.json`

## Decision

Build a dedicated Claude Code plugin repo that:
- keeps OrgX MCP integration via hosted MCP endpoint (`https://mcp.useorgx.com/mcp`)
- ports runtime telemetry hook behavior into `hooks/scripts/post-reporting-event.mjs`
- packages command/agent/skill guidance for OrgX execution discipline
- verifies manifest + hooks shape with repository checks and CI

Do not port OpenClaw-only surfaces (dashboard serving, OpenClaw gateway lifecycle, OpenClaw plugin manifest) into this repo.

## Consequences

Positive:
- native Claude plugin packaging
- clear separation of OpenClaw adapter vs Claude adapter
- simpler install surface for Claude users

Tradeoffs:
- local OpenClaw dashboard pairing UX is not present here
- runtime hook script path resolution may need `ORGX_HOOK_SCRIPT_PATH` override in some environments

## Follow-up

- add Claude CLI E2E harness to validate real session hook execution
- add marketplace metadata/release pipeline
- extract shared core modules into an independent package when parity work begins
