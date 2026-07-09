export type ToolCategory = "read" | "write" | "command";

export interface ToolResult {
    output: string;
    isError: boolean;
}

export interface ToolContext {
    workDir: string;
    abortSignal?: AbortSignal;
}

export interface Tool {
    name: string;
    description: string;
    category: ToolCategory;
    deferred?: boolean;
    system?: boolean;

    schema(): Record<string, unknown>;
    execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}