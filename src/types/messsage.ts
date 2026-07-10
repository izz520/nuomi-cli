

export interface ToolUseBlock {
    toolUseId: string;
    toolName: string;
    arguments: Record<string, unknown>;
}

export interface ToolResultBlock {
    toolUseId: string;
    content: string;
    isError: boolean;
}

export interface ThinkingBlock {
    thinking: string;
    signature: string;
}
export interface IMessage {
    role: "user" | "assistant" | "system";
    content: string;
    thinkingBlocks?: ThinkingBlock[];
    toolUses?: ToolUseBlock[];
    toolResults?: ToolResultBlock[];
}