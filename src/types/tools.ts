export type ToolCategory = "read" | "write" | "command";

export interface ToolResult {
    output: string;
    isError: boolean;
}

export interface ToolContext {
    workDir: string;
    abortSignal?: AbortSignal;
    /**
     * Report observable work performed inside a long-running tool.
     * The parent request uses this heartbeat to distinguish active work from
     * a genuinely stalled tool call.
     */
    onActivity?: () => void;
}

export interface Tool {
    name: string;
    description: string;
    category: ToolCategory;
    deferred?: boolean;
    system?: boolean;

    schema(): Record<string, unknown>;
    execute(args: Record<string, unknown>, ctx?: ToolContext): Promise<ToolResult>;
}
