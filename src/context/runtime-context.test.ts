import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MemoryManager } from "../memory/manager.js";
import { MessageManager } from "../messageManager/message.js";
import { buildAnthropicRequestMessages } from "../client/anthorpic.js";
import { buildOpenAIRequestInput } from "../client/openai.js";
import { RuntimeContextManager } from "./runtime-context.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "nuomi-runtime-context-"));
  const workDir = join(root, "project");
  const userDir = join(root, "user-memory");
  const projectDir = join(workDir, ".nuomi", "memory");
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(userDir, { recursive: true });
  const memory = new MemoryManager(workDir, { userDir, projectDir });
  return { root, workDir, userDir, projectDir, memory };
}

test("buildMessage combines instructions, both entrypoints, date, and MCP context", () => {
  const { workDir, userDir, projectDir, memory } = fixture();
  writeFileSync(join(workDir, "AGENTS.md"), "project-rule");
  writeFileSync(join(userDir, "MEMORY.md"), "user-memory");
  writeFileSync(join(projectDir, "MEMORY.md"), "project-memory");
  const runtime = new RuntimeContextManager(workDir, memory, { now: () => new Date("2026-07-17T00:00:00Z") });
  runtime.setMcpRuntimeContext(["server guidance"]);

  const message = runtime.buildMessage();
  assert.match(message, /project-rule/);
  assert.match(message, /user-memory/);
  assert.match(message, /project-memory/);
  assert.match(message, /2026-07-17/);
  assert.match(message, /server guidance/);
});

test("load reuses cached object until a fingerprint changes or invalidate is called", () => {
  const { workDir, projectDir, memory } = fixture();
  const memoryPath = join(projectDir, "MEMORY.md");
  writeFileSync(memoryPath, "first");
  const runtime = new RuntimeContextManager(workDir, memory);
  const first = runtime.load();
  assert.equal(runtime.load(), first);

  writeFileSync(memoryPath, "second-longer");
  const second = runtime.load();
  assert.notEqual(second, first);
  assert.equal(second.projectMemoryEntrypoint, "second-longer");

  runtime.invalidate();
  assert.notEqual(runtime.load(), second);
});

test("changing an included instruction invalidates the stat-only cache", () => {
  const { workDir, memory } = fixture();
  const includePath = join(workDir, "shared-rules.md");
  writeFileSync(includePath, "included-first");
  writeFileSync(join(workDir, "AGENTS.md"), "@./shared-rules.md");
  const runtime = new RuntimeContextManager(workDir, memory);

  const first = runtime.load();
  assert.match(first.instructions, /included-first/);
  assert.equal(runtime.load(), first);

  writeFileSync(includePath, "included-second-longer");
  const second = runtime.load();
  assert.notEqual(second, first);
  assert.match(second.instructions, /included-second-longer/);
});

test("provider request assembly adds ephemeral runtime context without changing history", () => {
  const messages = new MessageManager();
  messages.addUserMessage("first user message");
  messages.addAssistantMessage("assistant reply");
  const before = messages.getMessages();

  const anthropic = buildAnthropicRequestMessages(messages.getMessages(), "runtime context");
  const openai = buildOpenAIRequestInput("system prompt", messages.getMessages(), "runtime context");

  assert.deepEqual(messages.getMessages(), before);
  assert.equal(anthropic.length, 2);
  assert.equal(anthropic[0].role, "user");
  assert.deepEqual(anthropic[0].content, [
    { type: "text", text: "runtime context" },
    { type: "text", text: "first user message" },
  ]);
  assert.equal(anthropic[1].role, "assistant");
  assert.deepEqual(openai.slice(0, 3), [
    { role: "system", content: "system prompt" },
    { role: "user", content: "runtime context" },
    { role: "user", content: "first user message" },
  ]);
});
