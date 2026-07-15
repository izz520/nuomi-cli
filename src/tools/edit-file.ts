import { readFileSync, writeFileSync } from "node:fs";
import type { Tool, ToolResult, ToolContext } from "../types/tools.js";
import { EditFileDescription } from "./prompt.js";
import { boolArg, strArg } from "./utils.js";

//编辑文件
export class EditFileTool implements Tool {
  name = "EditFile";
  description = EditFileDescription;
  category = "write" as const;

  schema(): Record<string, unknown> {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Absolute path to the file" },
          old_string: { type: "string", description: "Exact string to find and replace" },
          new_string: { type: "string", description: "Replacement string" },
          replace_all: { type: "boolean", description: "Replace all occurrences of old_string (default false)", default: false },
        },
        required: ["file_path", "old_string", "new_string"],
      },
    };
  }

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const filePath = strArg(args, "file_path");
    const oldString = strArg(args, "old_string");
    const newString = strArg(args, "new_string");
    const replaceAll = boolArg(args, "replace_all");

    if (!filePath) return { output: "Error: file_path is required", isError: true };
    if (!oldString) return { output: "Error: old_string is required", isError: true };
    if (oldString === newString) return { output: "Error: old_string and new_string must be different", isError: true };

    // Gate: read-before-edit enforcement
    // if (ctx.fileStateCache) {
    //   const gate = ctx.fileStateCache.check(filePath);
    //   if (!gate.ok) {
    //     return { output: gate.error, isError: true };
    //   }
    // }

    // ctx.fileHistory?.trackEdit(filePath);
    //拿到当前的文件内容
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch (err) {
      return { output: `Error reading file: ${(err as Error).message}`, isError: true };
    }
    // 空文件没有可替换的旧内容，直接用新内容初始化。
    const isEmptyFile = content.length === 0;
    const count = isEmptyFile ? 0 : content.split(oldString).length - 1;
    if (!isEmptyFile && count === 0) {
      //没有出现过，则表示这个内容中不存在需要替换的内容
      return { output: "Error: old_string not found in file", isError: true };
    }
    if (!replaceAll && count > 1) {
      //文件中有多处出现，但是又不是全部替换
      return {
        output: `Error: old_string found ${count} times in file. It must be unique. Add more surrounding context, or set replace_all to true.`,
        isError: true,
      };
    }
    //进行内容替换，并存储在newContent
    const newContent = isEmptyFile
      ? newString
      : replaceAll
        ? content.replaceAll(oldString, newString)
        : content.replace(oldString, newString);
    try {
      //开始把新内容替换进去
      writeFileSync(filePath, newContent, "utf-8");
      // ctx.fileStateCache?.update(filePath, newContent);
      const msg = replaceAll && count > 1
        ? `File edited: ${filePath} (${count} replacements)`
        : `File edited: ${filePath}`;
      return { output: msg, isError: false };
    } catch (err) {
      return { output: `Error writing file: ${(err as Error).message}`, isError: true };
    }
  }
}
