import assert from "node:assert/strict";
import test from "node:test";
import type { SubAgentTaskSnapshot } from "../subAgent/task-manager.js";
import { formatSubAgentProgress } from "./SubAgentStatusList.js";

const task = (
  overrides: Partial<SubAgentTaskSnapshot> = {},
): SubAgentTaskSnapshot => ({
  id: "agent-1",
  label: "explore",
  background: true,
  status: "running",
  turn: 0,
  startedAt: 1,
  ...overrides,
});

test("formats running sub-agent progress for the status list", () => {
  assert.equal(formatSubAgentProgress(task()), "turn 0");
  assert.equal(
    formatSubAgentProgress(task({ turn: 3, lastTool: "Grep" })),
    "turn 3 · Grep",
  );
});

test("formats terminal sub-agent status for the status list", () => {
  assert.equal(
    formatSubAgentProgress(task({ status: "completed" })),
    "completed",
  );
  assert.equal(
    formatSubAgentProgress(task({ status: "failed" })),
    "failed",
  );
});
