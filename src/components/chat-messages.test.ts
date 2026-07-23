import assert from "node:assert/strict";
import test from "node:test";
import { messagesReducer, type MessageAction } from "./Chat.js";
import type { ChatMessage } from "./MessageList/index.js";

const reduce = (messages: ChatMessage[], action: MessageAction): ChatMessage[] =>
    messagesReducer(messages, action);

test("starting tools replaces the streamed progress preamble with one live work item", () => {
    const messages: ChatMessage[] = [
        { role: "user", content: "获取最新的新闻" },
        { role: "assistant", content: "我会先检查数据源。", phase: "final_answer" },
    ];

    const next = reduce(messages, {
        type: "tool_group_started",
        groupId: "group-1",
        title: "Fetch latest news",
        resultLabel: "News fetched",
        concurrent: false,
        tools: [{ toolId: "tool-1", toolName: "Bash", label: "Fetch source" }],
    });

    assert.equal(next.length, 2);
    assert.equal(next[1].phase, "tool_call");
    assert.equal(next[1].content, "Fetch latest news");
});

test("tool progress keeps at most the three most recent steps", () => {
    const failed: ChatMessage[] = [{
        role: "assistant",
        content: "Run commands",
        phase: "tool_call",
        toolGroup: {
            groupId: "group-1",
            title: "Run commands",
            resultLabel: "Commands complete",
            concurrent: false,
            tools: [{
                toolId: "tool-1",
                toolName: "Bash",
                label: "Run script",
                status: "error",
                output: "Python unavailable",
            }],
        },
    }];

    const next = ["group-2", "group-3", "group-4"].reduce(
        (current, groupId) => reduce(current, {
            type: "tool_group_started",
            groupId,
            title: `Step ${groupId}`,
            resultLabel: "Complete",
            concurrent: false,
            tools: [{ toolId: `tool-${groupId}`, toolName: "Bash", label: "Run" }],
        }),
        failed,
    );

    assert.equal(next.length, 3);
    assert.deepEqual(next.map((message) => message.toolGroup?.groupId), [
        "group-2",
        "group-3",
        "group-4",
    ]);
});

test("successful tool work remains as a compact progress step", () => {
    const running = reduce([], {
        type: "tool_group_started",
        groupId: "group-1",
        title: "Fetch latest news",
        resultLabel: "News fetched",
        concurrent: false,
        tools: [{ toolId: "tool-1", toolName: "Bash", label: "Fetch source" }],
    });

    const completed = reduce(running, {
        type: "tool_finished",
        toolId: "tool-1",
        output: "ok",
        isError: false,
        elapsed: 0.2,
    });

    assert.equal(completed.length, 1);
    assert.equal(completed[0].toolGroup?.tools[0].status, "success");
});

test("starting a new user request folds away the previous progress trace", () => {
    const messages: ChatMessage[] = [
        {
            role: "assistant",
            content: "Run commands",
            phase: "tool_call",
            toolGroup: {
                groupId: "group-1",
                title: "Run commands",
                resultLabel: "Commands complete",
                concurrent: false,
                tools: [{
                    toolId: "tool-1",
                    toolName: "Bash",
                    label: "Run script",
                    status: "success",
                }],
            },
        },
        { role: "assistant", content: "Previous answer", phase: "final_answer" },
    ];

    const next = reduce(messages, { type: "append_user", content: "Next question" });

    assert.deepEqual(next, [
        { role: "assistant", content: "Previous answer", phase: "final_answer" },
        { role: "user", content: "Next question" },
    ]);
});

test("completed requests clear any remaining internal tool trace", () => {
    const messages: ChatMessage[] = [
        {
            role: "assistant",
            content: "Run commands",
            phase: "tool_call",
            toolGroup: {
                groupId: "group-1",
                title: "Run commands",
                resultLabel: "Commands complete",
                concurrent: false,
                tools: [{
                    toolId: "tool-1",
                    toolName: "Bash",
                    label: "Run script",
                    status: "error",
                }],
            },
        },
        { role: "assistant", content: "这是最终结果。", phase: "final_answer" },
    ];

    const completed = reduce(messages, { type: "clear_tool_groups" });

    assert.deepEqual(completed, [
        { role: "assistant", content: "这是最终结果。", phase: "final_answer" },
    ]);
});
