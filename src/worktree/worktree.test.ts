import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  createAgentWorktree,
  inspectWorktree,
  removeAgentWorktree,
} from "./worktree.js";

function createRepository(): { root: string; cleanup: () => void } {
  const container = mkdtempSync(join(tmpdir(), "nuomi-worktree-"));
  const root = join(container, "project");
  mkdirSync(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, "README.md"), "base\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync(
    "git",
    [
      "-c", "user.name=Nuomi Test",
      "-c", "user.email=nuomi@example.invalid",
      "commit", "-qm", "initial",
    ],
    { cwd: root },
  );
  return {
    root,
    cleanup: () => rmSync(container, { recursive: true, force: true }),
  };
}

test("creates a uniquely named managed worktree outside the repository", () => {
  const fixture = createRepository();
  try {
    mkdirSync(join(fixture.root, ".nuomi", "worktrees", "legacy"), {
      recursive: true,
    });
    writeFileSync(join(fixture.root, ".nuomi", "settings.json"), "{}");
    writeFileSync(
      join(fixture.root, ".nuomi", "worktrees", "legacy", "ignored.txt"),
      "ignore",
    );

    const workspace = createAgentWorktree("agent_123", fixture.root);

    assert.equal(
      dirname(workspace.path),
      join(dirname(workspace.gitRoot), ".nuomi-worktrees", "project"),
    );
    assert.equal(workspace.branch, "mewcode/agent_123");
    assert.ok(existsSync(join(workspace.path, ".nuomi", "settings.json")));
    assert.ok(!existsSync(join(workspace.path, ".nuomi", "worktrees")));
    assert.deepEqual(inspectWorktree(
      workspace.path,
      workspace.headCommit,
      workspace.baselineStatus,
    ), {
      dirty: false,
      headCommit: workspace.headCommit,
      hasChanges: false,
    });

    writeFileSync(join(workspace.path, "changed.txt"), "changed\n");
    assert.deepEqual(inspectWorktree(
      workspace.path,
      workspace.headCommit,
      workspace.baselineStatus,
    ), {
      dirty: true,
      headCommit: workspace.headCommit,
      hasChanges: true,
    });

    removeAgentWorktree(
      workspace.path,
      workspace.branch,
      workspace.gitRoot,
    );
    assert.ok(!existsSync(workspace.path));
    assert.throws(() => {
      execFileSync("git", ["show-ref", "--verify", `refs/heads/${workspace.branch}`], {
        cwd: fixture.root,
        stdio: "ignore",
      });
    });
  } finally {
    fixture.cleanup();
  }
});

test("rejects unsafe slugs and unmanaged cleanup targets", () => {
  const fixture = createRepository();
  try {
    assert.throws(
      () => createAgentWorktree("../escape", fixture.root),
      /slug/,
    );
    assert.throws(
      () => removeAgentWorktree(fixture.root, "main", fixture.root),
      /unmanaged/,
    );
  } finally {
    fixture.cleanup();
  }
});
