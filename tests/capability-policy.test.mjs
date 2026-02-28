import test from "node:test";
import assert from "node:assert/strict";

import {
  inferTaskType,
  policyCacheKey,
  buildBasePolicy,
  formatPolicyForPrompt,
  formatScoringInstructions,
} from "../lib/capability-policy.mjs";

// --- inferTaskType ---

test("inferTaskType detects feature tasks", () => {
  assert.equal(inferTaskType({ title: "Add new API endpoint for users" }), "feature");
  assert.equal(inferTaskType({ title: "Implement dark mode" }), "feature");
  assert.equal(inferTaskType({ description: "Create a new widget component" }), "feature");
});

test("inferTaskType detects bugfix tasks", () => {
  assert.equal(inferTaskType({ title: "Fix login crash on empty email" }), "bugfix");
  assert.equal(inferTaskType({ title: "Patch regression in payment flow" }), "bugfix");
  assert.equal(inferTaskType({ description: "Bug: sidebar broken on mobile" }), "bugfix");
});

test("inferTaskType detects refactor tasks", () => {
  assert.equal(inferTaskType({ title: "Refactor auth module" }), "refactor");
  assert.equal(inferTaskType({ title: "Clean up legacy helpers" }), "refactor");
});

test("inferTaskType detects docs tasks", () => {
  assert.equal(inferTaskType({ title: "Write documentation for the API" }), "docs");
  assert.equal(inferTaskType({ title: "Improve the README guide" }), "docs");
});

test("inferTaskType detects test tasks", () => {
  assert.equal(inferTaskType({ title: "Write unit tests for the parser" }), "test");
  assert.equal(inferTaskType({ title: "Improve test coverage for auth" }), "test");
});

test("inferTaskType detects config tasks", () => {
  assert.equal(inferTaskType({ title: "Update the CI/CD pipeline" }), "config");
  assert.equal(inferTaskType({ title: "Set up environment configuration for staging" }), "config");
});

test("inferTaskType falls back to general", () => {
  assert.equal(inferTaskType({ title: "Investigate performance metrics" }), "general");
  assert.equal(inferTaskType({}), "general");
  assert.equal(inferTaskType(), "general");
});

// --- policyCacheKey ---

test("policyCacheKey returns a 16-char hex string", () => {
  const key = policyCacheKey("engineering", "feature", ["auth"]);
  assert.equal(key.length, 16);
  assert.match(key, /^[0-9a-f]{16}$/);
});

test("policyCacheKey is stable for same inputs", () => {
  const a = policyCacheKey("engineering", "feature", ["auth", "api"]);
  const b = policyCacheKey("engineering", "feature", ["auth", "api"]);
  assert.equal(a, b);
});

test("policyCacheKey differs for different inputs", () => {
  const a = policyCacheKey("engineering", "feature", ["auth"]);
  const b = policyCacheKey("engineering", "bugfix", ["auth"]);
  const c = policyCacheKey("product", "feature", ["auth"]);
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test("policyCacheKey sorts keywords for stability", () => {
  const a = policyCacheKey("engineering", "feature", ["beta", "alpha"]);
  const b = policyCacheKey("engineering", "feature", ["alpha", "beta"]);
  assert.equal(a, b);
});

// --- buildBasePolicy ---

test("buildBasePolicy returns structured output with non-empty heuristics", () => {
  const policy = buildBasePolicy({
    task: { title: "Add user auth endpoint" },
    domain: "engineering",
    requiredSkills: ["orgx-engineering-agent"],
  });

  assert.equal(policy.domain, "engineering");
  assert.equal(policy.taskType, "feature");
  assert.equal(policy.focusArea, "Add user auth endpoint");
  assert.ok(Array.isArray(policy.heuristics));
  assert.ok(policy.heuristics.length > 0);
  assert.ok(Array.isArray(policy.antiPatterns));
  assert.ok(policy.antiPatterns.length > 0);
  assert.ok(Array.isArray(policy.requiredTools));
  assert.deepEqual(policy.requiredTools, ["orgx-engineering-agent"]);
  assert.equal(policy.cacheKey.length, 16);
  assert.ok(policy.generatedAt);
});

test("buildBasePolicy uses general heuristics for unknown task type", () => {
  const policy = buildBasePolicy({
    task: { title: "Analyze performance metrics" },
    domain: "engineering",
  });

  assert.equal(policy.taskType, "general");
  assert.ok(policy.heuristics.length > 0);
});

// --- formatPolicyForPrompt ---

test("formatPolicyForPrompt renders markdown with all sections", () => {
  const policy = buildBasePolicy({
    task: { title: "Fix login bug" },
    domain: "engineering",
  });

  const md = formatPolicyForPrompt(policy);
  assert.ok(md.includes("## Capability policy"));
  assert.ok(md.includes("Domain: engineering"));
  assert.ok(md.includes("Task type: bugfix"));
  assert.ok(md.includes("Heuristics:"));
  assert.ok(md.includes("Anti-patterns to avoid:"));
  assert.ok(md.includes("Fix login bug"));
});

test("formatPolicyForPrompt returns empty string for null", () => {
  assert.equal(formatPolicyForPrompt(null), "");
  assert.equal(formatPolicyForPrompt(undefined), "");
});

// --- formatScoringInstructions ---

test("formatScoringInstructions includes task_id and initiative_id", () => {
  const result = formatScoringInstructions({
    taskId: "task-123",
    initiativeId: "init-456",
  });

  assert.ok(result.includes("task-123"));
  assert.ok(result.includes("init-456"));
});

test("formatScoringInstructions mentions MCP tool names", () => {
  const result = formatScoringInstructions({
    taskId: "t1",
    initiativeId: "i1",
  });

  assert.ok(result.includes("record_quality_score"));
  assert.ok(result.includes("submit_learning"));
});

test("formatScoringInstructions includes scoring dimensions", () => {
  const result = formatScoringInstructions({
    taskId: "t1",
    initiativeId: "i1",
  });

  assert.ok(result.includes("correctness"));
  assert.ok(result.includes("completeness"));
  assert.ok(result.includes("code_quality"));
  assert.ok(result.includes("plan_adherence"));
});
