import { ReadFileDescription } from "./descriptions.js";

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