import assert from "node:assert/strict";
import test from "node:test";
import { formatMessageForSummary } from "./message-compact.js";
import { createUsageAnchor } from "./usage-anchor.js";

test("usage anchor covers input tokens but not model output", () => {
    const anchor = createUsageAnchor({
        inputTokens: 1_000,
        cacheReadInputTokens: 200,
        cacheCreationInputTokens: 100,
        outputTokens: 500,
    }, 4);

    assert.deepEqual(anchor, {
        baselineTokens: 1_300,
        anchorCount: 4,
    });
});

test("summary serialization preserves tool arguments and results", () => {
    const toolUse = formatMessageForSummary({
        role: "assistant",
        content: "Reading the config",
        toolUses: [{
            toolUseId: "tool-1",
            toolName: "ReadFile",
            arguments: { file_path: "/project/config.ts" },
        }],
    });
    const toolResult = formatMessageForSummary({
        role: "user",
        content: "",
        toolResults: [{
            toolUseId: "tool-1",
            content: "export const enabled = true;",
            isError: false,
        }],
    });

    assert.match(toolUse, /\[tool_use id=tool-1 name=ReadFile\]/);
    assert.match(toolUse, /"file_path": "\/project\/config\.ts"/);
    assert.match(toolResult, /\[tool_result id=tool-1 error=false\]/);
    assert.match(toolResult, /export const enabled = true;/);
});
