import assert from "node:assert/strict";
import test from "node:test";
import { SubAgentTaskManager } from "./task-manager.js";

test("tracks progress and completes a background task", async () => {
  const manager = new SubAgentTaskManager();
  let release!: (value: string) => void;
  const result = new Promise<string>((resolve) => {
    release = resolve;
  });
  const task = manager.createTask({
    label: "explore: inspect files",
    background: true,
    run: async ({ onProgress }) => {
      onProgress({ turn: 2, lastTool: "Grep" });
      return result;
    },
  });

  assert.equal(task.status, "running");
  await Promise.resolve();
  assert.match(manager.get(task.id)?.label ?? "", /explore/);
  assert.equal(manager.get(task.id)?.turn, 2);
  assert.equal(manager.get(task.id)?.lastTool, "Grep");

  release("finished");
  const completed = await manager.wait(task.id);
  assert.equal(completed?.status, "completed");
  assert.equal(completed?.output, "finished");
});

test("stops a task and does not let its runner overwrite cancelled state", async () => {
  const manager = new SubAgentTaskManager();
  let runnerSignal: AbortSignal | undefined;
  const task = manager.createTask({
    label: "long task",
    background: true,
    run: ({ signal }) => new Promise<string>((_resolve, reject) => {
      runnerSignal = signal;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  });
  await Promise.resolve();

  const stopped = manager.stop(task.id);
  assert.equal(stopped?.status, "cancelled");
  assert.equal(runnerSignal?.aborted, true);

  await Promise.resolve();
  assert.equal(manager.get(task.id)?.status, "cancelled");
});

test("a synchronous task follows its parent abort signal", async () => {
  const manager = new SubAgentTaskManager();
  const parent = new AbortController();
  const task = manager.createTask({
    label: "sync task",
    background: false,
    parentSignal: parent.signal,
    run: ({ signal }) => new Promise<string>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  });

  parent.abort();
  const cancelled = await manager.wait(task.id);
  assert.equal(cancelled?.status, "cancelled");
  assert.match(cancelled?.error ?? "", /Parent request cancelled/);
});

test("remove only deletes terminal tasks", async () => {
  const manager = new SubAgentTaskManager();
  let release!: () => void;
  const task = manager.createTask({
    label: "task",
    background: true,
    run: () => new Promise<string>((resolve) => {
      release = () => resolve("done");
    }),
  });
  await Promise.resolve();

  assert.equal(manager.remove(task.id), false);
  release();
  await manager.wait(task.id);
  assert.equal(manager.remove(task.id), true);
  assert.equal(manager.get(task.id), undefined);
});
