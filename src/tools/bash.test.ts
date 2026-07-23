import assert from "node:assert/strict";
import test from "node:test";
import { BashTool } from "./bash.js";

test("BashTool does not block the UI event loop while a command is running", async () => {
    const tool = new BashTool();
    const command = tool.execute(
        { command: "sleep 0.08; printf done" },
        { workDir: process.cwd() },
    );
    const first = await Promise.race([
        command.then(() => "command"),
        new Promise<"timer">((resolve) => setTimeout(() => resolve("timer"), 10)),
    ]);

    assert.equal(first, "timer");
    const result = await command;
    assert.match(result.output, /done/);
    assert.equal(result.isError, false);
});

test("BashTool stops an active command when the request is cancelled", async () => {
    const tool = new BashTool();
    const controller = new AbortController();
    const startedAt = Date.now();
    const command = tool.execute(
        { command: "sleep 5" },
        { workDir: process.cwd(), abortSignal: controller.signal },
    );

    setTimeout(() => controller.abort(), 20);
    const result = await command;

    assert.equal(result.isError, true);
    assert.match(result.output, /cancelled/i);
    assert.ok(Date.now() - startedAt < 1_000);
});

test("BashTool reports an ordinary non-zero exit as an error", async () => {
    const tool = new BashTool();
    const result = await tool.execute(
        { command: "exit 3" },
        { workDir: process.cwd() },
    );

    assert.equal(result.isError, true);
    assert.match(result.output, /Exit code 3/);
});
