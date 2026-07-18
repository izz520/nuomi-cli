import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PermissionChecker } from "./checker.js";

test("permission checks use a specialized tool's resolved path", () => {
  const workDir = mkdtempSync(join(tmpdir(), "nuomi-permission-project-"));
  const outside = mkdtempSync(join(tmpdir(), "nuomi-user-memory-"));
  const target = join(outside, "preferences.md");
  const checker = new PermissionChecker(workDir, "default", (toolName) =>
    toolName === "WriteMemory" ? target : undefined
  );

  const decision = checker.check("WriteMemory", "write", {
    scope: "user",
    path: "preferences.md",
  });

  assert.equal(decision.effect, "ask");
  assert.match(decision.reason, /outside allowed directories/);
});

test("permission checks deny a specialized path that cannot be resolved", () => {
  const workDir = mkdtempSync(join(tmpdir(), "nuomi-permission-project-"));
  const checker = new PermissionChecker(workDir, "default", () => {
    throw new Error("Memory path traversal is not allowed");
  });

  const decision = checker.check("WriteMemory", "write", {
    scope: "user",
    path: "../secret.md",
  });

  assert.equal(decision.effect, "deny");
  assert.match(decision.reason, /Memory path traversal is not allowed/);
});
