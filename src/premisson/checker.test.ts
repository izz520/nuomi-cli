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

test("allow always persists an exact long file path across checker instances", () => {
  const workDir = mkdtempSync(join(tmpdir(), "nuomi-permission-project-"));
  const target = join(
    workDir,
    "a-very-long-directory-name",
    "another-long-directory-name",
    "nested",
    "target-file.ts",
  );
  const args = { file_path: target };

  const firstChecker = new PermissionChecker(workDir, "default");
  assert.equal(firstChecker.check("EditFile", "write", args).effect, "ask");
  firstChecker.allowAlways("EditFile", args);

  const nextChecker = new PermissionChecker(workDir, "default");
  assert.equal(nextChecker.check("EditFile", "write", args).effect, "allow");
});

test("allow always normalizes relative and absolute paths to the same file", () => {
  const workDir = mkdtempSync(join(tmpdir(), "nuomi-permission-project-"));
  const relativePath = join("src", "target.ts");
  const checker = new PermissionChecker(workDir, "default");

  checker.allowAlways("WriteFile", { file_path: relativePath });

  const decision = checker.check("WriteFile", "write", {
    file_path: join(workDir, relativePath),
  });
  assert.equal(decision.effect, "allow");
});

test("allow always applies to an approved path outside the project", () => {
  const workDir = mkdtempSync(join(tmpdir(), "nuomi-permission-project-"));
  const outside = mkdtempSync(join(tmpdir(), "nuomi-permission-outside-"));
  const target = join(outside, "target.ts");
  const args = { file_path: target };
  const checker = new PermissionChecker(workDir, "default");

  assert.equal(checker.check("EditFile", "write", args).effect, "ask");
  checker.allowAlways("EditFile", args);

  assert.equal(checker.check("EditFile", "write", args).effect, "allow");
});

test("persisted rules cannot override sensitive write denials", () => {
  const workDir = mkdtempSync(join(tmpdir(), "nuomi-permission-project-"));
  const args = { file_path: join(workDir, "config.yaml") };
  const checker = new PermissionChecker(workDir, "default");

  checker.allowAlways("WriteFile", args);

  assert.equal(checker.check("WriteFile", "write", args).effect, "deny");
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

test("plan mode denies writes outside the dedicated plan directory", () => {
  const workDir = mkdtempSync(join(tmpdir(), "nuomi-permission-project-"));
  const checker = new PermissionChecker(workDir, "plan");

  const decision = checker.check("WriteFile", "write", {
    file_path: join(workDir, "created-in-plan-mode.txt"),
  });

  assert.equal(decision.effect, "deny");
  assert.equal(decision.reason, "Plan mode is read-only");
});

test("plan mode allows writes only to its dedicated plan directory", () => {
  const workDir = mkdtempSync(join(tmpdir(), "nuomi-permission-project-"));
  const checker = new PermissionChecker(workDir, "plan");

  const decision = checker.check("WriteFile", "write", {
    file_path: join(workDir, ".nuomi", "plans", "current.md"),
  });

  assert.equal(decision.effect, "allow");
  assert.match(decision.reason, /Plan file write allowed/);
});

test("plan mode does not allow a matching plan-directory fragment outside the project", () => {
  const workDir = mkdtempSync(join(tmpdir(), "nuomi-permission-project-"));
  const outside = mkdtempSync(join(tmpdir(), "nuomi-outside-"));
  const checker = new PermissionChecker(workDir, "plan");

  const decision = checker.check("WriteFile", "write", {
    file_path: join(outside, ".nuomi", "plans", "current.md"),
  });

  assert.equal(decision.effect, "deny");
  assert.equal(decision.reason, "Plan mode is read-only");
});

test("plan mode allows read-only commands and denies executable scripts", () => {
  const workDir = mkdtempSync(join(tmpdir(), "nuomi-permission-project-"));
  const checker = new PermissionChecker(workDir, "plan");

  assert.equal(
    checker.check("Bash", "command", { command: "git status" }).effect,
    "allow",
  );
  assert.equal(
    checker.check("Bash", "command", {
      command: "node -e require('node:fs').writeFileSync('created.txt','x')",
    }).effect,
    "deny",
  );
});

test("dangerous commands cannot bypass checks through a safe prefix", () => {
  const workDir = mkdtempSync(join(tmpdir(), "nuomi-permission-project-"));
  const checker = new PermissionChecker(workDir, "default");

  const decision = checker.check("Bash", "command", {
    command: "git branch -D important-work",
  });

  assert.equal(decision.effect, "deny");
  assert.match(decision.reason, /Dangerous command blocked/);
});
