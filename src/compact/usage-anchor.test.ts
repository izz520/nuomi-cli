import assert from "node:assert/strict";
import test from "node:test";
import { createUsageAnchor } from "./usage-anchor.js";

test("usage anchor stores history with static request overhead removed", () => {
    const anchor = createUsageAnchor({
        inputTokens: 1_000,
        cacheReadInputTokens: 200,
        cacheCreationInputTokens: 100,
        outputTokens: 500,
    }, 4, 300);

    assert.deepEqual(anchor, { baselineTokens: 1_000, anchorCount: 4 });
});

test("static overhead is clamped when an estimate exceeds provider usage", () => {
    const anchor = createUsageAnchor({
        inputTokens: 10,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        outputTokens: 0,
    }, 1, 20);

    assert.equal(anchor.baselineTokens, 0);
});
