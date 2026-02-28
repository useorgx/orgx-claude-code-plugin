import { createHash } from "node:crypto";

const TASK_TYPE_HEURISTICS = {
  feature: {
    heuristics: [
      "Implement incrementally; verify each layer before the next",
      "Write or update tests alongside implementation",
      "Follow existing code conventions in the target directory",
    ],
    antiPatterns: [
      "Don't refactor unrelated code in the same changeset",
      "Don't add dependencies without justification",
    ],
  },
  bugfix: {
    heuristics: [
      "Reproduce the bug first with a failing test",
      "Fix the root cause, not the symptom",
      "Verify fix doesn't regress adjacent behavior",
    ],
    antiPatterns: [
      "Don't apply broad workarounds that mask the real issue",
      "Don't skip regression testing",
    ],
  },
  refactor: {
    heuristics: [
      "Ensure full test coverage before restructuring",
      "Make behavior-preserving changes in small, reviewable steps",
      "Run the full test suite after each structural change",
    ],
    antiPatterns: [
      "Don't change behavior and structure simultaneously",
      "Don't leave dead code or unused imports behind",
    ],
  },
  docs: {
    heuristics: [
      "Keep documentation close to the code it describes",
      "Use concrete examples over abstract descriptions",
      "Verify all code snippets compile or run correctly",
    ],
    antiPatterns: [
      "Don't duplicate information already in code comments",
      "Don't document implementation details that change frequently",
    ],
  },
  test: {
    heuristics: [
      "Test behavior and outcomes, not implementation details",
      "Cover edge cases and error paths explicitly",
      "Keep test setup minimal and readable",
    ],
    antiPatterns: [
      "Don't write tests that are tightly coupled to internal structure",
      "Don't ignore flaky test signals",
    ],
  },
  config: {
    heuristics: [
      "Validate configuration changes against a schema or type check",
      "Document the purpose of each configuration value",
      "Test with both default and overridden values",
    ],
    antiPatterns: [
      "Don't hardcode environment-specific values",
      "Don't remove configuration options without a migration path",
    ],
  },
  general: {
    heuristics: [
      "Read existing code before modifying it",
      "Keep changes focused on the stated objective",
      "Run validation or tests before declaring done",
    ],
    antiPatterns: [
      "Don't make changes outside the stated scope",
      "Don't skip verification steps",
    ],
  },
};

// Order matters: more specific types are checked before the broad "feature" type
// so that "Add unit tests" matches test, not feature.
const TASK_TYPE_KEYWORDS = [
  ["bugfix", /\b(bug|fix|patch|hotfix|regression|broken|crash|error|issue|defect)\b/i],
  ["refactor", /\b(refactor|restructure|reorganize|clean\s*up|modernize|simplify|extract|decouple)\b/i],
  ["docs", /\b(doc|documentation|readme|guide|tutorial|jsdoc|typedoc|comment)\b/i],
  ["test", /\b(tests?|spec|coverage|assertion|mock|stub|e2e|integration\s+tests?|unit\s+tests?)\b/i],
  ["config", /\b(config|configuration|env|environment|ci\/cd|pipeline|deploy|infra|terraform|yaml|toml)\b/i],
  ["feature", /\b(feature|implement|add|create|build|introduce|new\s+endpoint|new\s+api)\b/i],
];

export function inferTaskType(task = {}) {
  const text = [task.title, task.description, task.labels]
    .flat()
    .filter((v) => typeof v === "string")
    .join(" ");

  if (!text.trim()) return "general";

  for (const [taskType, pattern] of TASK_TYPE_KEYWORDS) {
    if (pattern.test(text)) return taskType;
  }

  return "general";
}

export function policyCacheKey(domain, taskType, keywords = []) {
  const input = [
    String(domain ?? "").toLowerCase(),
    String(taskType ?? "").toLowerCase(),
    ...(Array.isArray(keywords) ? keywords : [])
      .map((k) => String(k).toLowerCase().trim())
      .filter(Boolean)
      .sort(),
  ].join("|");

  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function buildBasePolicy({ task = {}, domain = "engineering", requiredSkills = [] }) {
  const taskType = inferTaskType(task);
  const table = TASK_TYPE_HEURISTICS[taskType] ?? TASK_TYPE_HEURISTICS.general;

  const keywords = [task.title, task.workstream_name, task.milestone_title]
    .filter((v) => typeof v === "string" && v.trim())
    .flatMap((v) => v.toLowerCase().split(/\s+/))
    .filter((w) => w.length > 3)
    .slice(0, 5);

  return {
    domain,
    taskType,
    focusArea: task.title ?? null,
    heuristics: [...table.heuristics],
    antiPatterns: [...table.antiPatterns],
    requiredTools: [...requiredSkills],
    cacheKey: policyCacheKey(domain, taskType, keywords),
    generatedAt: new Date().toISOString(),
  };
}

export function formatPolicyForPrompt(policy) {
  if (!policy) return "";

  const sections = [
    "",
    "## Capability policy",
    "",
    `Domain: ${policy.domain ?? "engineering"}`,
    `Task type: ${policy.taskType ?? "general"}`,
  ];

  if (policy.focusArea) {
    sections.push(`Focus: ${policy.focusArea}`);
  }

  if (Array.isArray(policy.heuristics) && policy.heuristics.length > 0) {
    sections.push("", "Heuristics:");
    for (const h of policy.heuristics) {
      sections.push(`- ${h}`);
    }
  }

  if (Array.isArray(policy.antiPatterns) && policy.antiPatterns.length > 0) {
    sections.push("", "Anti-patterns to avoid:");
    for (const ap of policy.antiPatterns) {
      sections.push(`- ${ap}`);
    }
  }

  return sections.join("\n");
}

export function formatScoringInstructions({ taskId, initiativeId }) {
  return [
    "",
    "## Completion reporting (REQUIRED before finishing)",
    "",
    "After completing your work, you MUST call these OrgX MCP tools:",
    "",
    "1. **record_quality_score** — Self-assess your output:",
    `   - task_id: "${taskId}"`,
    `   - initiative_id: "${initiativeId}"`,
    "   - Score 1-5 on: correctness, completeness, code_quality, plan_adherence",
    "",
    "2. **submit_learning** — Record what you learned:",
    `   - task_id: "${taskId}"`,
    `   - initiative_id: "${initiativeId}"`,
    "   - summary: What you did and how it went",
    "   - recommendation: What should be done similarly/differently next time",
    "   - If you encountered a failure pattern, include it as anti_pattern",
    "",
    "These calls close the feedback loop. Do not skip them.",
  ].join("\n");
}
