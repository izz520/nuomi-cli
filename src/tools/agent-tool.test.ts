import assert from "node:assert/strict";
import test from "node:test";
import { AgentTool, type SubAgentRunRequest } from "./agent-tool.js";
import { MessageManager } from "../messageManager/message.js";

test("passes structured run options and the abort signal to the spawn handler", async () => {
  let request: SubAgentRunRequest | undefined;
  const tool = new AgentTool(process.cwd(), async (value) => {
    request = value;
    return "done";
  });
  const controller = new AbortController();

  const result = await tool.execute({
    description: "Inspect files",
    prompt: "Find the implementation",
    subagent_type: "explore",
    run_in_background: true,
    model: "fast",
  }, {
    workDir: process.cwd(),
    abortSignal: controller.signal,
  });

  assert.deepEqual(result, { output: "done", isError: false });
  assert.equal(request?.contextMode, "fresh");
  assert.equal(request?.contextMode === "fresh" ? request.subAgent.name : undefined, "explore");
  assert.equal(request?.description, "Inspect files");
  assert.equal(request?.prompt, "Find the implementation");
  assert.equal(request?.background, true);
  assert.equal(request?.modelOverride, "fast");
  assert.equal(request?.abortSignal, controller.signal);
});

test("converts spawn failures into an error tool result", async () => {
  const tool = new AgentTool(process.cwd(), async () => {
    throw new Error("child failed");
  });

  const result = await tool.execute({
    description: "Fail",
    prompt: "Fail now",
    subagent_type: "general-purpose",
  }, { workDir: process.cwd() });

  assert.equal(result.isError, true);
  assert.match(result.output, /Agent error: child failed/);
});

test("exposes context mode separately from configured agent types", () => {
  const tool = new AgentTool(process.cwd(), async () => "done");
  const schema = tool.schema() as {
    input_schema: {
      properties: {
        context_mode: { enum: string[]; default: string };
        subagent_type: { enum: string[] };
      };
    };
  };

  assert.deepEqual(schema.input_schema.properties.context_mode.enum, ["fresh", "fork"]);
  assert.equal(schema.input_schema.properties.context_mode.default, "fresh");
  assert.ok(schema.input_schema.properties.subagent_type.enum.includes("explore"));
  assert.ok(!schema.input_schema.properties.subagent_type.enum.includes("fork"));
});

test("requires a configured agent type in explicit fresh mode", async () => {
  const tool = new AgentTool(process.cwd(), async () => "done");

  const result = await tool.execute({
    description: "Inspect files",
    prompt: "Find the implementation",
    context_mode: "fresh",
  });

  assert.equal(result.isError, true);
  assert.match(result.output, /subagent_type is required/);
});

test("requires subagent_type in explicit fork mode", async () => {
  const tool = new AgentTool(process.cwd(), async () => "done");

  const result = await tool.execute({
    description: "Continue the analysis",
    prompt: "Use the current conversation",
    context_mode: "fork",
  });

  assert.equal(result.isError, true);
  assert.match(result.output, /subagent_type is required/);
});

test("defaults to fresh mode when subagent_type is provided", async () => {
  let request: SubAgentRunRequest | undefined;
  const tool = new AgentTool(process.cwd(), async (value) => {
    request = value;
    return "done";
  });

  const result = await tool.execute({
    description: "Inspect files",
    prompt: "Find the implementation",
    subagent_type: "explore",
  });

  assert.equal(result.isError, false);
  assert.equal(request?.contextMode, "fresh");
  assert.equal(request?.contextMode === "fresh" ? request.subAgent.name : undefined, "explore");
});

test("routes fork mode through the unified start handler with parent messages", async () => {
  const parentMessages = new MessageManager();
  parentMessages.addUserMessage("Parent context");
  parentMessages.addToolUseMessage("", "tool-1", "Agent", {
    context_mode: "fork",
  });
  let request: SubAgentRunRequest | undefined;
  const tool = new AgentTool(process.cwd(), async (value) => {
    request = value;
    return "fork-result";
  }, parentMessages);

  const result = await tool.execute({
    description: "Continue analysis",
    prompt: "Inspect the current issue",
    context_mode: "fork",
    subagent_type: "explore",
  });

  assert.deepEqual(result, { output: "fork-result", isError: false });
  assert.equal(request?.contextMode, "fork");
  assert.equal(request?.subAgent.name, "explore");
  assert.equal(
    request?.contextMode === "fork"
      ? request.parentMessages[0]?.content
      : undefined,
    "Parent context",
  );
  assert.equal(
    request?.contextMode === "fork"
      ? request.parentMessages.length
      : undefined,
    1,
  );
  assert.match(request?.prompt ?? "", /<fork_boilerplate>/);
});
