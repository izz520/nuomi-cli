import { PermissionMode } from "../premisson/checker.js";

export interface SubAgent {
    name: string;
    description: string;
    tools?: string[];
    disallowedTools?: string[];
    systemPromptOverride?: string;
    maxTurns?: number;
    model?: string;
    permissionMode?: PermissionMode;
    background?: boolean;
    isolation?: "worktree";
    initialPrompt?: string;
    omitMewcodeMd?: boolean;
    skills?: string[];
    memory?: boolean;
    mcpServers?: string[];
}