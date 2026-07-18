export type AssistantMessagePhase = "commentary" | "final_answer" | "unknown";

export interface StreamOptions {
    abortSignal?: AbortSignal;
    runtimeContext?: string;
}

export type ToolCallContext =
    | {
        provider: "anthropic";
        toolUse: {
            type: "tool_use";
            id: string;
            name: string;
            input: unknown;
        };
    };

export type StreamEvent =
    // 普通输出事件 ✅
    | {
        type: "text_delta";
        text: string;
        itemId?: string;
        outputIndex?: number;
        contentIndex?: number;
        phase?: AssistantMessagePhase;
    }
    //思考过程的事件 ✅
    | { type: "thinking_delta"; text: string }
    // 思考完成事件 ✅
    | { type: "thinking_complete"; thinking: string; signature: string }
    // 工具调用开始
    | { type: "tool_call_start"; toolName: string; toolId: string }
    // 累积工具参数 ✅
    | { type: "tool_call_delta"; text: string }
    // 工具调用完成 ✅
    | {
        type: "tool_call_complete";
        toolId: string;
        toolName: string;
        arguments: Record<string, unknown>;
        context?: ToolCallContext;
    }
    // 流式输出结束事件 ✅
    | { type: "stream_end"; stopReason: string; usage: UsageInfo };

export interface UsageInfo {
    inputTokens: number;
    outputTokens: number;
    // Cache token counts from the API usage block. Anthropic reports these
    // directly; OpenAI/compat usually report 0 (or only cache_read via
    // prompt_tokens_details.cached_tokens). They anchor the compact judgment's
    // real-token baseline (input + cache_read + cache_creation + output).
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
}
