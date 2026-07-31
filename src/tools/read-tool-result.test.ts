import assert from "node:assert/strict";
import {
    existsSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
    cleanupPersistedToolResults,
    getPersistedToolResultPath,
    prepareToolResultForConversation,
    saveToolResultToFile,
    TOOL_OUTPUT_CHUNK_CHARS,
} from "../compact/persisted-tool-output.js";
import { ToolsManger } from "./register.js";
import { filterToolsForAgent } from "./tool-filter.js";
import { ReadToolResult } from "./read-tool-result.js";

const CONVERSATION_OUTPUT_LIMIT = 10000;

function extractChunk(output: string): {
    content: string;
    nextOffset: number | null;
} {
    const contentPrefix = "content:\n";
    const contentStart = output.indexOf(contentPrefix);
    const contentEnd = output.lastIndexOf("\n</persisted-output-chunk>");
    assert.notEqual(contentStart, -1);
    assert.notEqual(contentEnd, -1);

    const nextOffsetMatch = output.match(/^next_offset: (null|\d+)$/m);
    assert.ok(nextOffsetMatch);
    return {
        content: output.slice(contentStart + contentPrefix.length, contentEnd),
        nextOffset: nextOffsetMatch[1] === "null"
            ? null
            : Number(nextOffsetMatch[1]),
    };
}

test("long tool output is persisted before the conversation cap can discard it", () => {
    const workDir = mkdtempSync(join(tmpdir(), "nuomi-tool-output-"));
    try {
        const toolUseId = "../../unsafe/tool-id";
        const original = `${"HEAD".repeat(250)}${"middle".repeat(3834)}${"TAIL".repeat(250)}`;
        const conversationContent = prepareToolResultForConversation(
            workDir,
            toolUseId,
            original,
            CONVERSATION_OUTPUT_LIMIT,
        );

        assert.match(conversationContent, /<persisted-output>/);
        assert.match(conversationContent, /ReadToolResult/);
        assert.match(conversationContent, /开头（前 1000 个字符）/);
        assert.match(conversationContent, /结尾（后 1000 个字符）/);
        assert.match(conversationContent, /HEADHEAD/);
        assert.match(conversationContent, /TAILTAIL/);
        assert.match(conversationContent, /中间省略 \d+ 个字符/);
        assert.ok(conversationContent.length < CONVERSATION_OUTPUT_LIMIT);
        assert.equal(
            readFileSync(getPersistedToolResultPath(workDir, toolUseId), "utf-8"),
            original,
        );
        assert.ok(
            getPersistedToolResultPath(workDir, toolUseId)
                .startsWith(join(workDir, ".nuomi", "tool_results")),
        );
    } finally {
        rmSync(workDir, { recursive: true, force: true });
    }
});

test("ReadToolResult reconstructs a long single-line output without re-truncation", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "nuomi-tool-output-"));
    try {
        const toolUseId = "tool-long-single-line";
        const original = "0123456789".repeat(2501);
        prepareToolResultForConversation(
            workDir,
            toolUseId,
            original,
            CONVERSATION_OUTPUT_LIMIT,
        );

        const tool = new ReadToolResult();
        let offset = 0;
        let reconstructed = "";
        let calls = 0;

        while (true) {
            const result = await tool.execute(
                { tool_use_id: toolUseId, offset },
                { workDir },
            );
            assert.equal(result.isError, false);
            assert.ok(
                result.output.length < CONVERSATION_OUTPUT_LIMIT,
                `chunk output was ${result.output.length} characters`,
            );

            const chunk = extractChunk(result.output);
            reconstructed += chunk.content;
            calls++;
            if (chunk.nextOffset === null) break;
            assert.ok(chunk.nextOffset > offset);
            offset = chunk.nextOffset;
        }

        assert.ok(calls > 1);
        assert.equal(reconstructed, original);
    } finally {
        rmSync(workDir, { recursive: true, force: true });
    }
});

test("ReadToolResult does not split a surrogate pair at a chunk boundary", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "nuomi-tool-output-"));
    try {
        const toolUseId = "tool-unicode";
        const original = `${"x".repeat(TOOL_OUTPUT_CHUNK_CHARS - 1)}😀tail`;
        prepareToolResultForConversation(workDir, toolUseId, original, 1);
        const tool = new ReadToolResult();

        const first = await tool.execute(
            { tool_use_id: toolUseId, offset: 0 },
            { workDir },
        );
        const firstChunk = extractChunk(first.output);
        assert.equal(firstChunk.content, "x".repeat(TOOL_OUTPUT_CHUNK_CHARS - 1));
        assert.equal(firstChunk.nextOffset, TOOL_OUTPUT_CHUNK_CHARS - 1);

        const second = await tool.execute(
            { tool_use_id: toolUseId, offset: firstChunk.nextOffset },
            { workDir },
        );
        const secondChunk = extractChunk(second.output);
        assert.equal(firstChunk.content + secondChunk.content, original);
        assert.equal(secondChunk.nextOffset, null);
    } finally {
        rmSync(workDir, { recursive: true, force: true });
    }
});

test("ReadToolResult remains available through a sub-agent tool whitelist", () => {
    const manager = new ToolsManger();
    manager.register(new ReadToolResult());

    const filtered = filterToolsForAgent(
        manager,
        ["ReadFile"],
        undefined,
        false,
    );
    assert.ok(filtered.get("ReadToolResult"));

    const explicitlyDisabled = filterToolsForAgent(
        manager,
        ["ReadFile"],
        ["ReadToolResult"],
        false,
    );
    assert.equal(explicitlyDisabled.get("ReadToolResult"), undefined);
});

test("tool output cleanup removes expired files then evicts the oldest by size", () => {
    const workDir = mkdtempSync(join(tmpdir(), "nuomi-tool-output-"));
    try {
        const expiredPath = saveToolResultToFile(workDir, "expired", "old");
        const olderPath = saveToolResultToFile(workDir, "older", "123456");
        const newestPath = saveToolResultToFile(workDir, "newest", "abcdef");
        const nowMs = Date.now();
        const setTime = (path: string, ageMs: number) => {
            const time = new Date(nowMs - ageMs);
            utimesSync(path, time, time);
        };
        setTime(expiredPath, 10_000);
        setTime(olderPath, 2_000);
        setTime(newestPath, 1_000);

        const cleanup = cleanupPersistedToolResults(workDir, {
            nowMs,
            ttlMs: 5_000,
            minAgeMs: 0,
            maxBytes: 6,
        });

        assert.equal(cleanup.removedFiles, 2);
        assert.equal(cleanup.remainingBytes, 6);
        assert.equal(existsSync(expiredPath), false);
        assert.equal(existsSync(olderPath), false);
        assert.equal(existsSync(newestPath), true);
    } finally {
        rmSync(workDir, { recursive: true, force: true });
    }
});

test("tool output cleanup never deletes the result currently being persisted", () => {
    const workDir = mkdtempSync(join(tmpdir(), "nuomi-tool-output-"));
    try {
        const protectedPath = saveToolResultToFile(workDir, "protected", "large-result");
        const cleanup = cleanupPersistedToolResults(workDir, {
            ttlMs: 0,
            minAgeMs: 0,
            maxBytes: 0,
            protectedPaths: new Set([protectedPath]),
        });

        assert.equal(cleanup.removedFiles, 0);
        assert.equal(existsSync(protectedPath), true);
        assert.equal(readFileSync(protectedPath, "utf-8"), "large-result");
    } finally {
        rmSync(workDir, { recursive: true, force: true });
    }
});

test("size cleanup preserves recently created results from concurrent agents", () => {
    const workDir = mkdtempSync(join(tmpdir(), "nuomi-tool-output-"));
    try {
        const recentPath = saveToolResultToFile(workDir, "recent", "large-result");
        const cleanup = cleanupPersistedToolResults(workDir, {
            ttlMs: 60_000,
            maxBytes: 0,
            minAgeMs: 60_000,
        });

        assert.equal(cleanup.removedFiles, 0);
        assert.ok(cleanup.remainingBytes > cleanup.removedBytes);
        assert.equal(existsSync(recentPath), true);
    } finally {
        rmSync(workDir, { recursive: true, force: true });
    }
});

test("ReadToolResult explains how to recover an expired cache entry", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "nuomi-tool-output-"));
    try {
        const result = await new ReadToolResult().execute(
            { tool_use_id: "missing" },
            { workDir },
        );
        assert.equal(result.isError, true);
        assert.match(result.output, /expired|cache cleanup/);
        assert.match(result.output, /Re-run the original tool call/);
    } finally {
        rmSync(workDir, { recursive: true, force: true });
    }
});
