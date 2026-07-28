import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertValidTeamIdentifier,
  Team,
  TeamManager,
} from "./team.js";

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("waitFor timeout");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function fixture(t: test.TestContext): {
  root: string;
  manager: TeamManager;
} {
  const root = mkdtempSync(join(tmpdir(), "nuomi-team-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, manager: new TeamManager(root) };
}

test("reuses one teammate session across message batches and reports results", async (t) => {
  const { manager } = fixture(t);
  const team = manager.create("feature", "in-process");
  const prompts: string[] = [];
  let factoryCalls = 0;
  let stopCalls = 0;

  const factory = async (identity: { teamName: string; memberName: string }) => {
    factoryCalls++;
    assert.deepEqual(identity, { teamName: "feature", memberName: "backend" });
    return {
      async run(prompt: string): Promise<string> {
        prompts.push(prompt);
        return `answer-${prompts.length}`;
      },
      async stop(): Promise<void> {
        stopCalls++;
      },
    };
  };

  (team.spawnTeammate as any)("backend", "first task", factory);
  await waitFor(() => prompts.length === 1);
  await waitFor(() => team.getMember("backend")?.uiState?.status === "idle");

  const firstNotifications = manager.drainLeads().join("\n");
  assert.match(firstNotifications, /"type":"task_result"/);
  assert.match(firstNotifications, /"status":"completed"/);
  assert.match(firstNotifications, /"result":"answer-1"/);
  assert.match(firstNotifications, /\[idle\]/);

  await team.sendMessage("lead", "backend", "second task");
  await team.sendMessage("reviewer", "backend", "review note");
  await waitFor(() => prompts.length === 2);
  assert.equal(factoryCalls, 1);
  assert.match(prompts[1], /From lead: second task/);
  assert.match(prompts[1], /From reviewer: review note/);

  await team.stopMember("backend");
  assert.equal(stopCalls, 1);
  assert.equal(team.getMember("backend")?.uiState?.status, "stopped");
});

test("shutdown wins over ordinary messages in the same mailbox batch", async (t) => {
  const { manager } = fixture(t);
  const team = manager.create("feature", "in-process");
  const prompts: string[] = [];
  let stopCalls = 0;

  (team.spawnTeammate as any)("backend", "first task", async () => ({
    async run(prompt: string): Promise<string> {
      prompts.push(prompt);
      return "done";
    },
    async stop(): Promise<void> {
      stopCalls++;
    },
  }));
  await waitFor(() => team.getMember("backend")?.uiState?.status === "idle");

  await team.sendMessage("lead", "backend", "must not run");
  await team.sendMessage("lead", "backend", `${Team.SHUTDOWN_PREFIX} now`);
  await waitFor(() => team.getMember("backend")?.active === false);

  assert.deepEqual(prompts, ["first task"]);
  assert.equal(stopCalls, 1);
});

test("stop prevents a late run result from changing stopped state or notifying lead", async (t) => {
  const { manager } = fixture(t);
  const team = manager.create("feature", "in-process");
  let resolveRun!: (value: string) => void;
  let stopCalls = 0;
  const runResult = new Promise<string>((resolve) => {
    resolveRun = resolve;
  });

  (team.spawnTeammate as any)("backend", "long task", async () => ({
    run: () => runResult,
    async stop(): Promise<void> {
      stopCalls++;
    },
  }));
  await waitFor(() => team.getMember("backend")?.uiState?.status === "running");

  await team.stopMember("backend");
  resolveRun("late result");
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(stopCalls, 1);
  assert.equal(team.getMember("backend")?.uiState?.status, "stopped");
  assert.deepEqual(manager.drainLeads(), []);

  await team.stopMember("backend");
  assert.equal(stopCalls, 1);
});

test("deleting a team stops every persistent session", async (t) => {
  const { manager } = fixture(t);
  const team = manager.create("feature", "in-process");
  const stopped: string[] = [];

  for (const name of ["backend", "reviewer"]) {
    (team.spawnTeammate as any)(name, "wait", async () => ({
      run: () => new Promise<string>(() => undefined),
      async stop(): Promise<void> {
        stopped.push(name);
      },
    }));
  }
  await waitFor(() => team.listMembers().every((member) => member.uiState?.status === "running"));

  await manager.delete("feature");
  assert.equal(manager.get("feature"), undefined);
  assert.deepEqual(stopped.sort(), ["backend", "reviewer"]);
});

test("run failures produce one structured failed result and keep failed state", async (t) => {
  const { manager } = fixture(t);
  const team = manager.create("feature", "in-process");
  let stopCalls = 0;

  (team.spawnTeammate as any)("backend", "break", async () => ({
    async run(): Promise<string> {
      throw new Error("model unavailable");
    },
    async stop(): Promise<void> {
      stopCalls++;
    },
  }));
  await waitFor(() => team.getMember("backend")?.uiState?.status === "failed");

  const notification = manager.drainLeads().join("\n");
  assert.match(notification, /"status":"failed"/);
  assert.match(notification, /"error":"model unavailable"/);
  assert.match(notification, /\[idle\] backend \(reason: failed\)/);
  assert.equal(stopCalls, 1);
  assert.deepEqual(manager.drainLeads(), []);
});

test("rejects unsafe, empty, and oversized team/member identifiers", (t) => {
  const { manager } = fixture(t);
  const invalidNames = [
    "",
    "../escape",
    "team/member",
    "team\\member",
    "white space",
    "x".repeat(65),
  ];

  for (const name of invalidNames) {
    assert.throws(
      () => assertValidTeamIdentifier(name, "team"),
      /Invalid team name/,
    );
    assert.throws(
      () => manager.create(name, "in-process"),
      /Invalid team name/,
    );
  }

  const team = manager.create("safe-team_1", "in-process");
  for (const name of invalidNames) {
    assert.throws(() => team.addMember(name), /Invalid member name/);
    assert.throws(
      () => (team.spawnTeammate as any)(name, "task", async () => undefined),
      /Invalid member name/,
    );
  }
  assert.equal(team.listMembers().length, 0);
});

test("duplicate team creation does not replace the existing team", (t) => {
  const { manager } = fixture(t);
  const original = manager.create("feature", "in-process");
  original.addMember("backend");

  assert.throws(
    () => manager.create("feature", "in-process"),
    /Team 'feature' already exists/,
  );
  assert.equal(manager.get("feature"), original);
  assert.equal(manager.get("feature")?.getMember("backend")?.name, "backend");
});
