import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TeamManager } from "./team.js";
import { SendMessageTool } from "./tools.js";

function fixture(t: test.TestContext): {
  manager: TeamManager;
  teamName: string;
} {
  const root = mkdtempSync(join(tmpdir(), "nuomi-team-tools-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manager = new TeamManager(root);
  const teamName = "feature";
  const team = manager.create(teamName, "in-process");
  team.addMember("backend");
  team.addMember("reviewer");
  return { manager, teamName };
}

test("unbound SendMessage sends as lead and rejects unknown recipients", async (t) => {
  const { manager, teamName } = fixture(t);
  const tool = new SendMessageTool(manager);

  const sent = await tool.execute({
    team: teamName,
    to: "backend",
    message: "review API",
    from: "reviewer",
  });
  assert.equal(sent.isError, false);
  const messages = manager.get(teamName)?.getMember("backend")?.mailbox.receiveSync() ?? [];
  assert.equal(messages.length, 1);
  assert.equal(messages[0].from, "lead");
  assert.equal(messages[0].text, "review API");
  assert.ok(!Number.isNaN(Date.parse(messages[0].timestamp)));

  const missing = await tool.execute({
    team: teamName,
    to: "missing",
    message: "hello",
  });
  assert.equal(missing.isError, true);
});

test("identity-bound SendMessage routes member to member without allowing impersonation", async (t) => {
  const { manager, teamName } = fixture(t);
  const tool = new (SendMessageTool as any)(manager, {
    teamName,
    memberName: "backend",
  }) as SendMessageTool;

  const result = await tool.execute({
    team: "some-other-team",
    from: "lead",
    to: "reviewer",
    message: "please review",
  });

  assert.equal(result.isError, false);
  const messages = manager.get(teamName)?.getMember("reviewer")?.mailbox.receiveSync() ?? [];
  assert.equal(messages.length, 1);
  assert.equal(messages[0].from, "backend");
  assert.equal(messages[0].text, "please review");
});

test("identity-bound SendMessage routes member to lead", async (t) => {
  const { manager, teamName } = fixture(t);
  const tool = new (SendMessageTool as any)(manager, {
    teamName,
    memberName: "backend",
  }) as SendMessageTool;

  const result = await tool.execute({
    to: "lead",
    message: "API done",
  });
  assert.equal(result.isError, false);

  const notifications = manager.drainLeads();
  assert.equal(notifications.length, 1);
  assert.match(notifications[0], /team="feature"/);
  assert.match(notifications[0], /from=backend: API done/);
  assert.deepEqual(manager.drainLeads(), []);
});

test("TeamCreate rejects unsafe names without creating filesystem-backed teams", async (t) => {
  const { manager } = fixture(t);
  const { TeamCreateTool } = await import("./tools.js");

  for (const name of ["", "../escape", "a/b", "x".repeat(65)]) {
    const execution = new TeamCreateTool(manager).execute({ name });
    if (name === "") {
      assert.equal((await execution).isError, true);
    } else {
      await assert.rejects(execution, /Invalid team name/);
    }
  }
  assert.equal(manager.list().length, 1);
});
