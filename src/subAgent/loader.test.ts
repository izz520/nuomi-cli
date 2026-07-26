import assert from "node:assert/strict";
import test from "node:test";
import { parseAgentDefinition } from "./loader.js";

test("parses supported custom sub-agent fields", () => {
  const definition = parseAgentDefinition(`---
name: reviewer
description: Reviews changes
tools:
  - ReadFile
disallowed_tools:
  - WriteFile
system_prompt: Be precise.
max_turns: 7
model: standard
permission_mode: plan
background: false
isolation: worktree
omit_mewcode_md: true
skills:
  - code-review
memory: false
mcp_servers:
  - docs
---
Review the requested files.`);

  assert.deepEqual(definition, {
    name: "reviewer",
    description: "Reviews changes",
    tools: ["ReadFile"],
    disallowedTools: ["WriteFile"],
    systemPromptOverride: "Be precise.",
    maxTurns: 7,
    model: "standard",
    permissionMode: "plan",
    background: false,
    isolation: "worktree",
    initialPrompt: "Review the requested files.",
    omitMewcodeMd: true,
    skills: ["code-review"],
    memory: false,
    mcpServers: ["docs"],
  });
});

test("rejects invalid max_turns and permission_mode values", () => {
  assert.equal(parseAgentDefinition(`---
name: broken
max_turns: 0
---`), null);

  assert.equal(parseAgentDefinition(`---
name: broken
permission_mode: unrestricted
---`), null);
});
