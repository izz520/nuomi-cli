import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EditFileTool } from "./edit-file.js";

const createFile = (content: string): string => {
  const directory = mkdtempSync(join(tmpdir(), "nuomi-edit-file-"));
  const filePath = join(directory, "test.md");
  writeFileSync(filePath, content, "utf-8");
  return filePath;
};

test("initializes an empty file with new_string", async () => {
  const filePath = createFile("");
  const result = await new EditFileTool().execute({
    file_path: filePath,
    old_string: "placeholder",
    new_string: "Hello cli",
  }, { workDir: tmpdir() });

  assert.equal(result.isError, false);
  assert.equal(readFileSync(filePath, "utf-8"), "Hello cli");
});

test("still rejects a missing old_string in a non-empty file", async () => {
  const filePath = createFile("Existing content");
  const result = await new EditFileTool().execute({
    file_path: filePath,
    old_string: "missing",
    new_string: "replacement",
  }, { workDir: tmpdir() });

  assert.equal(result.isError, true);
  assert.equal(result.output, "Error: old_string not found in file");
  assert.equal(readFileSync(filePath, "utf-8"), "Existing content");
});
