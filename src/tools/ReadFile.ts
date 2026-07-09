import { ReadFileDescription } from "./descriptions.js";
import { readFile, stat } from "node:fs/promises";

export const readFileTool = {
    name: "ReadFile",
    description: ReadFileDescription,
    input_schema: {
        type: "object" as const,
        properties: {
            file_path: { type: "string", description: "Absolute path to the file" },
            offset: { type: "integer", description: "Line number to start from (0-based)", default: 0 },
            limit: { type: "integer", description: "Max lines to read", default: 2000 },
        },
        required: ["file_path"],
    }
}

export interface ReadFileInput {
    file_path: string;
    offset?: number;
    limit?: number;
}

const isReadFileInput = (input: Record<string, unknown>): input is Record<string, unknown> & ReadFileInput =>
    typeof input.file_path === "string" && input.file_path.length > 0;

export const executeReadFile = async (input: Record<string, unknown>): Promise<string> => {
    if (!isReadFileInput(input)) {
        throw new Error("ReadFile requires a non-empty file_path string.");
    }

    const fileStats = await stat(input.file_path);

    if (!fileStats.isFile()) {
        throw new Error(`ReadFile expected a file path, got: ${input.file_path}`);
    }

    const offset = typeof input.offset === "number" && Number.isInteger(input.offset)
        ? Math.max(0, input.offset)
        : 0;
    const limit = typeof input.limit === "number" && Number.isInteger(input.limit)
        ? Math.max(1, input.limit)
        : 2000;

    const content = await readFile(input.file_path, "utf8");
    const lines = content.split(/\r?\n/);
    const selectedLines = lines.slice(offset, offset + limit);

    if (selectedLines.length === 0) {
        return `[ReadFile] ${input.file_path}\nNo lines found at offset ${offset}.`;
    }

    const lastLine = offset + selectedLines.length - 1;
    const numberedContent = selectedLines
        .map((line, index) => `${offset + index + 1}: ${line}`)
        .join("\n");

    return `[ReadFile] ${input.file_path} (${offset + 1}-${lastLine + 1})\n${numberedContent}`;
};
