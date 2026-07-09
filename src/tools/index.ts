import { executeReadFile } from "./ReadFile.js";

export const executeToolCall = async (
    toolName: string,
    args: Record<string, unknown>
): Promise<string> => {
    switch (toolName) {
        case "ReadFile":
            return executeReadFile(args);
        default:
            throw new Error(`Unknown tool: ${toolName}`);
    }
};
