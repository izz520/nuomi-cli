import { existsSync } from "node:fs";
import {
    getPersistedToolResultPath,
    readPersistedToolResultChunk,
    TOOL_OUTPUT_CHUNK_CHARS,
} from "../compact/persisted-tool-output.js";
import { Tool, ToolCategory, ToolContext, ToolResult } from "../types/tools.js";
import { intArg } from "./utils.js";

export class ReadToolResult implements Tool {
    name = "ReadToolResult";
    system = true;
    description = `Read a losslessly persisted tool result in character-based chunks.

Use the tool_use_id from a <persisted-output> message. Start with offset 0, then
repeat with the returned next_offset until next_offset is null. This works for
large outputs even when the entire output is a single long line.`;
    category = "read" as ToolCategory;

    schema(): Record<string, unknown> {
        return {
            name: this.name,
            description: this.description,
            input_schema: {
                type: "object",
                properties: {
                    tool_use_id: {
                        type: "string",
                        description: "tool_use_id shown in the <persisted-output> message",
                    },
                    offset: {
                        type: "integer",
                        description: "0-based character offset; use next_offset from the previous chunk",
                        default: 0,
                    },
                    limit: {
                        type: "integer",
                        description: `Characters to return; capped at ${TOOL_OUTPUT_CHUNK_CHARS}`,
                        default: TOOL_OUTPUT_CHUNK_CHARS,
                    },
                },
                required: ["tool_use_id"],
            },
        };
    }

    async execute(args: Record<string, unknown>, ctx?: ToolContext): Promise<ToolResult> {
        const toolUseId = typeof args["tool_use_id"] === "string"
            ? args["tool_use_id"]
            : "";
        if (!toolUseId) {
            return { output: "Error: tool_use_id is required", isError: true };
        }
        if (!ctx?.workDir) {
            return { output: "Error: workDir is unavailable", isError: true };
        }

        const path = getPersistedToolResultPath(ctx.workDir, toolUseId);
        if (!existsSync(path)) {
            return {
                output: `Error: persisted output is unavailable for tool_use_id: ${toolUseId}. `
                    + "It may have expired or been removed by cache cleanup. "
                    + "Re-run the original tool call to regenerate it.",
                isError: true,
            };
        }

        const offset = intArg(args, "offset", 0);
        const limit = intArg(args, "limit", TOOL_OUTPUT_CHUNK_CHARS);
        if (offset < 0) {
            return { output: "Error: offset must be non-negative", isError: true };
        }
        if (limit < 1) {
            return { output: "Error: limit must be at least 1", isError: true };
        }

        try {
            const chunk = readPersistedToolResultChunk(
                ctx.workDir,
                toolUseId,
                offset,
                limit,
            );
            const nextOffset = chunk.nextOffset === null ? "null" : String(chunk.nextOffset);
            const remainingChars = chunk.totalChars - chunk.endOffset;
            return {
                output: `<persisted-output-chunk>
range: [${chunk.offset}, ${chunk.endOffset})
total_chars: ${chunk.totalChars}
remaining_chars: ${remainingChars}
next_offset: ${nextOffset}
is_complete: ${chunk.nextOffset === null}
content:
${chunk.content}
</persisted-output-chunk>`,
                isError: false,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { output: `Error reading persisted tool result: ${message}`, isError: true };
        }
    }
}
