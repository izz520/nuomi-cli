import assert from "node:assert/strict";
import test from "node:test";
import type AnthropicClient from "../client/anthorpic.js";
import type { StreamEvent, StreamOptions } from "../types/llm.js";
import type { ProviderConfig } from "../types/provider.js";
import type { Tool } from "../types/tools.js";
import { ToolsManger } from "../tools/register.js";
import {
  SubAgentRunError,
  buildSubAgentSystemPrompt,
  spawnSubAgent,
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

  constructor(
    private readonly events: () => AsyncGenerator<StreamEvent>,
    private readonly systemPrompt = "fake-system",
  ) {}

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  async *sendMessageStream(
    _messages: unknown,
    _tools: unknown,
    options: StreamOptions = {},
  ): AsyncGenerator<StreamEvent> {
    this.calls++;
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

  const result = await spawnSubAgent({
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

  await assert.rejects(spawnSubAgent({
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

  await assert.rejects(spawnSubAgent({
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
