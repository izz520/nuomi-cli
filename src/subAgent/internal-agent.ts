import { SubAgent } from "../types/subAgent.js";

export const BUILTIN_AGENTS: SubAgent[] = [
    {
        name: "general-purpose",
        description:
            "General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks.",
    },
    {
        name: "worktree-worker",
        description:
            "Isolated coding agent for implementing changes and running tests without modifying the parent working tree.",
        isolation: "worktree",
    },
    {
        name: "plan",
        description:
            "Software architect agent for designing implementation plans. Returns step-by-step plans, identifies critical files.",
        disallowedTools: ["EditFile", "WriteFile"],
        permissionMode: "plan",
    },
    {
        name: "explore",
        description:
            "Fast read-only search agent for locating code. Use it to find files by pattern, grep for symbols or keywords.",
        disallowedTools: ["EditFile", "WriteFile"],
        permissionMode: "plan",
        model: "fast",
    },
];
