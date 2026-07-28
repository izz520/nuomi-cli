import assert from "node:assert/strict";
import test from "node:test";
import type { SubAgentTaskSnapshot } from "../subAgent/task-manager.js";
import { formatSubAgentElapsed, formatSubAgentProgress } from "./SubAgentStatusList.js";

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
    "turn 3 · using Grep",
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

test("formats sub-agent elapsed time", () => {
  assert.equal(formatSubAgentElapsed(task({ startedAt: 1000 }), 1250), "250ms");
  assert.equal(
    formatSubAgentElapsed(task({ startedAt: 1000, finishedAt: 3500 }), 9000),
    "2.5s",
  );
});
