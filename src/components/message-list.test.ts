import assert from "node:assert/strict";
import test from "node:test";
import { summarizeToolError } from "./MessageList/index.js";

test("error summary skips the echoed Bash command and selects a Python exception", () => {
    const output = [
        '$ python3 ".nuomi/skills/xinwenlianbo/scripts/xinwenlianbo.py"',
        "Traceback (most recent call last):",
        '  File "xinwenlianbo.py", line 19, in <module>',
        "    import requests",
        "ModuleNotFoundError: No module named 'requests'",
        "Exit code 1",
    ].join("\n");

    assert.equal(
        summarizeToolError(output),
        "ModuleNotFoundError: No module named 'requests'",
    );
});

test("error summary selects the concrete missing-file message", () => {
    const output = [
        '$ python3 ".nuomi/skills/xinwenlianbo/xinwenlianbo.py"',
        "python3: can't open file 'xinwenlianbo.py': [Errno 2] No such file or directory",
        "Exit code 2",
    ].join("\n");

    assert.match(summarizeToolError(output), /No such file or directory/);
});

test("error summary falls back to an exit code when no diagnostic was emitted", () => {
    assert.equal(
        summarizeToolError("$ false\nExit code 1"),
        "Exit code 1",
    );
});

test("error summary truncates long diagnostic lines", () => {
    const summary = summarizeToolError(`Error: ${"x".repeat(200)}`, 40);

    assert.equal(summary.length, 41);
    assert.ok(summary.endsWith("…"));
});
