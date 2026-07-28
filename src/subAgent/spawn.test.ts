import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type AnthropicClient from "../client/anthorpic.js";
import type { StreamEvent, StreamOptions } from "../types/llm.js";
import type { ProviderConfig } from "../types/provider.js";
import type { Tool } from "../types/tools.js";
import { ToolsManger } from "../tools/register.js";
import {
  SubAgentRunError,
  buildSubAgentSystemPrompt,
  startSubAgent,
} from "./spawn.js";

const provider: ProviderConfig = {
  name: "test",
  protocol: "anthropic",
  base_url: "https://example.invalid",
  model: "parent-model",
  api_key: "test",
};

const usage = {
  inputTokens: 1,
  outputTokens: 1,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

class FakeClient {
  calls = 0;
  seenSignal?: AbortSignal;
  seenMessages?: unknown;
  seenTools?: unknown;

  constructor(
    private readonly events: () => AsyncGenerator<StreamEvent>,
    private readonly systemPrompt = "fake-system",
  ) { }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  async *sendMessageStream(
    messages: unknown,
    tools: unknown,
    options: StreamOptions = {},
  ): AsyncGenerator<StreamEvent> {
    this.calls++;
    this.seenMessages = messages;
    this.seenTools = tools;
    this.seenSignal = options.abortSignal;
    yield* this.events();
  }
}

const asClientFactory = (
  fake: FakeClient,
  capture?: (options: Record<string, unknown>) => void,
) => ((options: Record<string, unknown>) => {
  capture?.(options);
  return fake as unknown as AnthropicClient;
}) as never;

test("builds a role prompt and honors an explicit system prompt override", () => {
  const rolePrompt = buildSubAgentSystemPrompt({
    name: "reviewer",
    description: "Reviews code",
    initialPrompt: "Focus on correctness.",
  }, process.cwd(), "test-model");

  assert.match(rolePrompt, /# Sub-agent role\nFocus on correctness\./);
  assert.match(rolePrompt, /test-model/);

  assert.equal(buildSubAgentSystemPrompt({
    name: "reviewer",
    description: "Reviews code",
    initialPrompt: "Ignored role",
    systemPromptOverride: "Custom system prompt",
  }, process.cwd(), "test-model"), "Custom system prompt");
});

test("uses a dedicated client and returns the sub-agent output", async () => {
  const controller = new AbortController();
  const fake = new FakeClient(async function* () {
    yield { type: "text_delta", text: "child-result" };
    yield { type: "stream_end", stopReason: "end_turn", usage };
  });
  let clientOptions: Record<string, unknown> | undefined;

  const result = await startSubAgent({
    subAgent: {
      name: "general-purpose",
      description: "test",
      initialPrompt: "Child role",
    },
    prompt: "Do the task",
    parentToolManager: new ToolsManger(),
    parentProvider: provider,
    workDir: process.cwd(),
    abortSignal: controller.signal,
    clientFactory: asClientFactory(fake, (options) => {
      clientOptions = options;
    }),
  });

  assert.equal(result, "child-result");
  assert.equal(clientOptions?.model, "parent-model");
  assert.match(String(clientOptions?.systemPrompt), /Child role/);
  assert.equal(fake.seenSignal, controller.signal);
});

test("fork mode copies parent messages and still removes the Agent tool", async () => {
  const fake = new FakeClient(async function* () {
    yield { type: "text_delta", text: "fork-result" };
    yield { type: "stream_end", stopReason: "end_turn", usage };
  });
  const tools = new ToolsManger();
  for (const name of ["Agent", "ReadFile"]) {
    tools.register({
      name,
      description: name,
      category: "read",
      schema: () => ({
        name,
        description: name,
        input_schema: { type: "object", properties: {} },
      }),
      execute: async () => ({ output: "ok", isError: false }),
    });
  }

  const result = await startSubAgent({
    contextMode: "fork",
    parentMessages: [{ role: "user", content: "Parent context" }],
    subAgent: {
      name: "explore",
      description: "Explore with inherited context",
      tools: ["*"],
    },
    prompt: "Continue the task",
    parentToolManager: tools,
    parentProvider: provider,
    workDir: process.cwd(),
    clientFactory: asClientFactory(fake),
  });

  assert.equal(result, "fork-result");
  assert.match(JSON.stringify(fake.seenMessages), /Parent context/);
  assert.match(JSON.stringify(fake.seenMessages), /Continue the task/);
  assert.doesNotMatch(JSON.stringify(fake.seenTools), /Agent/);
  assert.match(JSON.stringify(fake.seenTools), /ReadFile/);
});

test("enforces maxTurns and reports it as a sub-agent error", async () => {
  const fake = new FakeClient(async function* () {
    yield {
      type: "tool_call_complete",
      toolId: "tool-1",
      toolName: "Noop",
      arguments: {},
    };
    yield { type: "stream_end", stopReason: "tool_use", usage };
  });
  const tools = new ToolsManger();
  const noop: Tool = {
    name: "Noop",
    description: "No operation",
    category: "read",
    schema: () => ({
      name: "Noop",
      description: "No operation",
      input_schema: { type: "object", properties: {} },
    }),
    execute: async () => ({ output: "ok", isError: false }),
  };
  tools.register(noop);

  await assert.rejects(startSubAgent({
    subAgent: {
      name: "limited",
      description: "test",
      maxTurns: 1,
    },
    prompt: "Keep using tools",
    parentToolManager: tools,
    parentProvider: provider,
    workDir: process.cwd(),
    clientFactory: asClientFactory(fake),
  }), (error: unknown) => {
    assert.ok(error instanceof SubAgentRunError);
    assert.match(error.message, /exceeded maxTurns: 1/);
    return true;
  });
  assert.equal(fake.calls, 1);
});

test("does not start a sub-agent when already aborted", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  const fake = new FakeClient(async function* () {
    yield { type: "stream_end", stopReason: "end_turn", usage };
  });

  await assert.rejects(startSubAgent({
    subAgent: { name: "test", description: "test" },
    prompt: "Do the task",
    parentToolManager: new ToolsManger(),
    parentProvider: provider,
    workDir: process.cwd(),
    abortSignal: controller.signal,
    clientFactory: asClientFactory(fake),
  }), /cancelled/);
  assert.equal(fake.calls, 0);
});

test("runs an isolated sub-agent in a worktree and cleans up an unchanged run", async () => {
  const container = mkdtempSync(join(tmpdir(), "nuomi-isolated-agent-"));
  const root = join(container, "project");
  mkdirSync(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, "README.md"), "base\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync(
    "git",
    [
      "-c", "user.name=Nuomi Test",
      "-c", "user.email=nuomi@example.invalid",
      "commit", "-qm", "initial",
    ],
    { cwd: root },
  );

  try {
    const fake = new FakeClient(async function* () {
      yield { type: "text_delta", text: "isolated-result" };
      yield { type: "stream_end", stopReason: "end_turn", usage };
    });
    const result = await startSubAgent({
      subAgent: {
        name: "editor",
        description: "Edits in isolation",
        isolation: "worktree",
      },
      prompt: "Inspect the project",
      parentToolManager: new ToolsManger(),
      parentProvider: provider,
      workDir: root,
      worktreeSlug: "editor_test",
      clientFactory: asClientFactory(fake),
    });

    assert.equal(result, "isolated-result");
    assert.match(JSON.stringify(fake.seenMessages), /git worktree/);
    assert.ok(!existsSync(
      join(container, ".nuomi-worktrees", "project", "editor_test"),
    ));
    assert.throws(() => {
      execFileSync("git", ["show-ref", "--verify", "refs/heads/mewcode/editor_test"], {
        cwd: root,
        stdio: "ignore",
      });
    });
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});

test("preserves an isolated worktree and reports metadata when the agent edits files", async () => {
  const container = mkdtempSync(join(tmpdir(), "nuomi-isolated-edit-"));
  const root = join(container, "project");
  mkdirSync(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, "README.md"), "base\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync(
    "git",
    [
      "-c", "user.name=Nuomi Test",
      "-c", "user.email=nuomi@example.invalid",
      "commit", "-qm", "initial",
    ],
    { cwd: root },
  );

  try {
    let call = 0;
    const fake = new FakeClient(async function* () {
      if (call++ === 0) {
        yield {
          type: "tool_call_complete",
          toolId: "tool-1",
          toolName: "CreateFile",
          arguments: {},
        };
        yield { type: "stream_end", stopReason: "tool_use", usage };
        return;
      }
      yield { type: "text_delta", text: "edited-result" };
      yield { type: "stream_end", stopReason: "end_turn", usage };
    });
    const tools = new ToolsManger();
    tools.register({
      name: "CreateFile",
      description: "Create a test file",
      category: "write",
      schema: () => ({
        name: "CreateFile",
        description: "Create a test file",
        input_schema: { type: "object", properties: {} },
      }),
      execute: async (_args, ctx) => {
        writeFileSync(join(ctx!.workDir, "agent-change.txt"), "changed\n");
        return { output: "created", isError: false };
      },
    });

    const result = await startSubAgent({
      subAgent: {
        name: "editor",
        description: "Edits in isolation",
        isolation: "worktree",
      },
      prompt: "Edit the project",
      parentToolManager: tools,
      parentProvider: provider,
      workDir: root,
      worktreeSlug: "editor_changed",
      clientFactory: asClientFactory(fake),
    });

    const workspacePath = join(
      container,
      ".nuomi-worktrees",
      "project",
      "editor_changed",
    );
    assert.match(result, /edited-result/);
    assert.match(result, /nuomi\/editor_changed/);
    assert.match(result, /"dirty": true/);
    assert.ok(existsSync(join(workspacePath, "agent-change.txt")));
    assert.ok(!existsSync(join(root, "agent-change.txt")));
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});
