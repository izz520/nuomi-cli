import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MemoryManager } from "./manager.js";

function fixture(): { root: string; manager: MemoryManager; userDir: string; projectDir: string } {
  const root = mkdtempSync(join(tmpdir(), "nuomi-memory-manager-"));
  const userDir = join(root, "user-memory");
  const projectDir = join(root, "project", ".nuomi", "memory");
  mkdirSync(userDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  return {
    root,
    userDir,
    projectDir,
    manager: new MemoryManager(join(root, "project"), { userDir, projectDir }),
  };
}

test("loadEntrypoint reads only user and project MEMORY.md and truncates to 200 lines", () => {
  const { manager, userDir, projectDir } = fixture();
  writeFileSync(join(userDir, "MEMORY.md"), Array.from({ length: 250 }, (_, i) => `user-${i}`).join("\n"));
  writeFileSync(join(projectDir, "MEMORY.md"), "project-entry");
  writeFileSync(join(projectDir, "topic.md"), "must-not-be-loaded");

  const result = manager.loadEntrypoint();
  assert.equal(result.user.split("\n").length, 200);
  assert.match(result.user, /user-199$/);
  assert.equal(result.project, "project-entry");
  assert.doesNotMatch(JSON.stringify(result), /must-not-be-loaded/);
});

test("loadEntrypoint truncates at a UTF-8 safe 25KB boundary", () => {
  const { manager, projectDir } = fixture();
  writeFileSync(join(projectDir, "MEMORY.md"), "你".repeat(10_000));
  const result = manager.loadEntrypoint();
  assert.ok(Buffer.byteLength(result.project, "utf8") <= 25_000);
  assert.doesNotMatch(result.project, /�/);
});

test("resolvePath rejects traversal, absolute paths, non-markdown files, and symlinks", () => {
  const { manager, root, projectDir } = fixture();
  assert.throws(() => manager.resolvePath("project", "../outside.md"));
  assert.throws(() => manager.resolvePath("project", join(root, "absolute.md")));
  assert.throws(() => manager.resolvePath("project", "notes.txt"));

  const outside = join(root, "outside");
  mkdirSync(outside);
  symlinkSync(outside, join(projectDir, "linked"));
  assert.throws(() => manager.resolvePath("project", "linked/notes.md"), /symbolic link/i);
});

test("loadEntrypoint does not follow an index symlink outside memory", () => {
  const { manager, root, projectDir } = fixture();
  const outside = join(root, "outside-memory.md");
  writeFileSync(outside, "must-not-be-loaded");
  symlinkSync(outside, join(projectDir, "MEMORY.md"));

  assert.equal(manager.loadEntrypoint().project, "");
});
