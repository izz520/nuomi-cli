import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type AnthropicClient from "../client/anthorpic.js";
import { ToolsManger } from "../tools/register.js";
import type { StreamEvent } from "../types/llm.js";
import type { ProviderConfig } from "../types/provider.js";
import type { WorktreeResult } from "../worktree/worktree.js";
import { TeamManager } from "./team.js";
import {
  PersistentTeamAgentSession,
  createTeamAgentSession,
  createTeamAgentSessionFactory,
} from "./team-agent-session.js";

const provider: ProviderConfig = {
  name: "fake",
  protocol: "anthropic",
  base_url: "https://example.invalid",
  model: "fake-model",
  api_key: "unused",
};

const workspace: WorktreeResult = {
  path: "/tmp/fake-team-worktree",
  branch: "nuomi/team-backend",
  headCommit: "a".repeat(40),
  gitRoot: "/tmp/fake-root",
  baselineStatus: "",
};

class FakeClient {
  calls = 0;
  seenMessages: unknown[] = [];
  seenTools: unknown[] = [];

  getSystemPrompt(): string {
    return "system";
  }

  async *sendMessageStream(messages: unknown, tools: unknown): AsyncGenerator<StreamEvent> {
    this.calls++;
    this.seenMessages.push(messages);
    this.seenTools.push(tools);
    yield { type: "text_delta", text: `answer-${this.calls}` };
    yield {
      type: "stream_end",
      stopReason: "end_turn",
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    };
  }
}

test("persistent team session reuses history, client and worktree across runs", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "nuomi-team-session-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manager = new TeamManager(root);
  const team = manager.create("team", "in-process");
  team.addMember("backend");
  const fake = new FakeClient();
  let clientCreations = 0;
  let worktreeCreations = 0;
  let removals = 0;

  const factory = createTeamAgentSessionFactory({
    subAgent: { name: "backend", description: "backend teammate" },
    provider,
    parentToolManager: new ToolsManger(),
    teamManager: manager,
    workDir: root,
    clientFactory: (() => {
      clientCreations++;
      return fake as unknown as AnthropicClient;
    }) as never,
    worktreeFactory: () => {
      worktreeCreations++;
      return workspace;
    },
    worktreeInspector: () => ({
      dirty: false,
      headCommit: workspace.headCommit,
      hasChanges: false,
    }),
    worktreeRemover: () => {
      removals++;
    },
  });
  const session = await factory({ teamName: "team", memberName: "backend" });
  const history = session.messageManager;

  assert.equal(await session.run("remember alpha"), "answer-1");
  await team.sendMessage("lead", "backend", "what was the token?");
  assert.equal(await session.run("continue"), "answer-2");

  assert.equal(clientCreations, 1);
  assert.equal(worktreeCreations, 1);
  assert.equal(fake.calls, 2);
  assert.equal(session.messageManager, history);
  assert.equal(session.worktree?.workDir, workspace.path);
  assert.match(JSON.stringify(fake.seenMessages[1]), /remember alpha/);
  assert.match(JSON.stringify(fake.seenMessages[1]), /Team message from lead/);
  assert.match(JSON.stringify(fake.seenMessages[1]), /what was the token/);
  assert.match(JSON.stringify(fake.seenTools[0]), /SendMessage/);
  assert.deepEqual(team.getMember("backend")?.mailbox.receiveSync(), []);

  await session.stop();
  await session.stop();
  assert.equal(
    (session as PersistentTeamAgentSession).signal.aborted,
    true,
  );
  assert.equal(removals, 1);
  assert.equal(session.worktree?.cleaned, true);
});

test("persistent team session rejects concurrent runs and preserves changed worktrees", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "nuomi-team-session-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manager = new TeamManager(root);
  manager.create("team", "in-process").addMember("backend");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fake = {
    getSystemPrompt: () => "system",
    async *sendMessageStream(): AsyncGenerator<StreamEvent> {
      await gate;
      yield {
        type: "stream_end",
        stopReason: "end_turn",
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      };
    },
  };
  let removals = 0;
  const session = createTeamAgentSession({
    subAgent: { name: "backend", description: "backend teammate" },
    identity: { teamName: "team", memberName: "backend" },
    provider,
    parentToolManager: new ToolsManger(),
    teamManager: manager,
    workDir: root,
    clientFactory: (() => fake as unknown as AnthropicClient) as never,
    worktreeFactory: () => workspace,
    worktreeInspector: () => ({
      dirty: true,
      headCommit: "b".repeat(40),
      hasChanges: true,
    }),
    worktreeRemover: () => {
      removals++;
    },
  });

  const first = session.run("first");
  await assert.rejects(session.run("second"), /already running/);
  release();
  await first;
  await session.stop();
  assert.equal(removals, 0);
  assert.equal(session.worktree?.dirty, true);
  assert.equal(session.worktree?.headCommit, "b".repeat(40));
});
