import assert from "node:assert/strict";
import test from "node:test";
import { SubAgentTaskManager } from "../subAgent/task-manager.js";
import { TaskOutputTool, TaskStopTool } from "./subagent-task-tools.js";

test("TaskOutput returns and clears a completed result", async () => {
  const manager = new SubAgentTaskManager();
  const task = manager.createTask({
    label: "background task",
    background: true,
    run: async () => "task result",
  });
  await manager.wait(task.id);

  const result = await new TaskOutputTool(manager).execute({
    task_id: task.id,
  });

  assert.equal(result.isError, false);
  assert.match(result.output, /task result/);
  assert.equal(manager.get(task.id), undefined);
});

test("TaskOutput can report a running task without clearing it", async () => {
  const manager = new SubAgentTaskManager();
  let release!: () => void;
  const task = manager.createTask({
    label: "background task",
    background: true,
    run: () => new Promise<string>((resolve) => {
      release = () => resolve("done");
    }),
  });
  await Promise.resolve();

  const result = await new TaskOutputTool(manager).execute({
    task_id: task.id,
  });

  assert.equal(result.isError, false);
  assert.match(result.output, /still running/);
  assert.equal(manager.get(task.id)?.status, "running");
  release();
  await manager.wait(task.id);
});

test("TaskOutput block waits for completion", async () => {
  const manager = new SubAgentTaskManager();
  const task = manager.createTask({
    label: "background task",
    background: true,
    run: async () => "done",
  });

  const result = await new TaskOutputTool(manager).execute({
    task_id: task.id,
    block: true,
    timeout: 1,
    clear: false,
  });

  assert.equal(result.isError, false);
  assert.match(result.output, /completed/);
  assert.equal(manager.get(task.id)?.status, "completed");
});

test("TaskStop cancels a running task", async () => {
  const manager = new SubAgentTaskManager();
  const task = manager.createTask({
    label: "background task",
    background: true,
    run: ({ signal }) => new Promise<string>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  });
  await Promise.resolve();

  const result = await new TaskStopTool(manager).execute({
    task_id: task.id,
  });

  assert.equal(result.isError, false);
  assert.match(result.output, /stopped/);
  assert.equal(manager.get(task.id)?.status, "cancelled");
});
