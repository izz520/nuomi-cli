import assert from "node:assert/strict";
import test from "node:test";
import { AgentTool, type SubAgentRunRequest } from "./agent-tool.js";
import { ToolsManger } from "./register.js";

test("passes structured run options and the abort signal to the spawn handler", async () => {
  let request: SubAgentRunRequest | undefined;
  const tool = new AgentTool(process.cwd(), new ToolsManger(), async (value) => {
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
  assert.equal(request?.subAgent.name, "explore");
  assert.equal(request?.description, "Inspect files");
  assert.equal(request?.prompt, "Find the implementation");
  assert.equal(request?.background, true);
  assert.equal(request?.modelOverride, "fast");
  assert.equal(request?.abortSignal, controller.signal);
});

test("converts spawn failures into an error tool result", async () => {
  const tool = new AgentTool(process.cwd(), new ToolsManger(), async () => {
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
