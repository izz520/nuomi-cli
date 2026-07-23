import React, { memo, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { MCPServerConfig, ProviderConfig, SandBoxConfig } from '../types/provider.js'
import { Box, Text, useApp, useInput } from 'ink'
import MessageList, { ChatMessage, MessagePhase } from './MessageList/index.js'
import PromptInput from './PromptInput.js'
import AnthropicClient from '../client/anthorpic.js'
import OpenAIClient from '../client/openai.js'
import { Agent } from '../client/agent.js'
import { MessageManager } from '../messageManager/message.js'
import { ToolsManger } from '../tools/register.js'
import { createSandbox, Sandbox } from '../sandbox/index.js'
import { PermissionChecker, PermissionMode } from '../premisson/checker.js'
import { BashTool } from '../tools/bash.js'
import { isAbsolute, join, relative } from 'node:path'
import { PermissionAction, PermissionDialog } from './PermissionDialog.js'
import { MCPManager } from '../mcp/manger.js'
import { MCPToolWrapper } from '../mcp/tool-wrapper.js'
import { ToolResultCompactStateManger } from '../compact/state.js'
import { RecoveryManager } from '../compact/recovery.js'
import { RuntimeContextManager } from '../context/runtime-context.js'
import { MemoryManager, MemoryScope } from '../memory/manager.js'
import { SendMessageHistory } from '../history/send-message.js'
import { CommandManager, createCommandManager, parse as parseCommand } from '../commands/commands.js'
import { nextPermissionMode, PERMISSION_MODE_ORDER } from '../premisson/modes.js'
interface IChat {
    llmClient: AnthropicClient | OpenAIClient | undefined
    workDir: string
    changeProvider: (provider: ProviderConfig) => void
    sandboxConfig: SandBoxConfig
    mcpServers: MCPServerConfig[]
    contextWindow: number | undefined
    messageManager: MessageManager
    toolManager: ToolsManger
    recoveryManager: RecoveryManager
    toolResultCompactManger: ToolResultCompactStateManger
    runtimeContextManager: RuntimeContextManager
    memoryManager: MemoryManager
    selectedProvider: ProviderConfig
    commandManager: CommandManager
}

const FIRST_RESPONSE_TIMEOUT_MS = 60_000
const NO_PROGRESS_TIMEOUT_MS = 120_000
type SystemEvent = "exit"

const MEMORY_TOOL_NAMES = new Set(["ReadMemory", "WriteMemory", "EditMemory"]);

const isMemoryTool = (toolName: string): boolean => MEMORY_TOOL_NAMES.has(toolName);

const memoryScope = (args: Record<string, unknown>): MemoryScope => {
    if (args.scope === "user" || args.scope === "project") return args.scope;
    throw new Error("Invalid memory scope");
};

export type MessageAction =
    | { type: "append_user"; content: string }
    | { type: "append_assistant"; content: string; phase: MessagePhase; merge: boolean }
    | {
        type: "tool_group_started";
        groupId: string;
        title: string;
        resultLabel: string;
        concurrent: boolean;
        tools: Array<{ toolId: string; toolName: string; label: string }>;
    }
    | { type: "tool_finished"; toolId: string; output: string; isError: boolean; elapsed: number }
    | { type: "clear_tool_groups" }
    | { type: "append_system"; content: string }
    | { type: "clear_message"; }

// 处理UI侧显示的消息
export const messagesReducer = (messages: ChatMessage[], action: MessageAction): ChatMessage[] => {
    switch (action.type) {
        case "append_user":
            // Keep the latest request's compact trace until the next request
            // starts, then fold it away to avoid transcript growth.
            return [
                ...messages.filter((message) => message.phase !== "tool_call"),
                { role: "user", content: action.content }
            ];
        case "append_assistant": {
            const lastMessage = messages.at(-1);
            if (
                action.merge
                && lastMessage?.role === "assistant"
                && lastMessage.phase === action.phase
            ) {
                return [
                    ...messages.slice(0, -1),
                    {
                        ...lastMessage,
                        content: lastMessage.content + action.content
                    }
                ];
            }

            return [
                ...messages,
                {
                    role: "assistant",
                    content: action.content,
                    phase: action.phase
                }
            ];
        }
        case "tool_group_started":
            // Text emitted before a tool call is a progress preamble, not part of
            // the final answer. Keep only one live work item in the transcript.
            while (
                messages.at(-1)?.role === "assistant"
                && (
                    messages.at(-1)?.phase === "thinking"
                    || messages.at(-1)?.phase === "final_answer"
                )
            ) {
                messages = messages.slice(0, -1);
            }

            return [
                ...messages.filter((message) => message.phase !== "tool_call"),
                ...messages.filter((message) => message.phase === "tool_call").slice(-2),
                {
                    role: "assistant",
                    content: action.title,
                    phase: "tool_call",
                    toolGroup: {
                        groupId: action.groupId,
                        title: action.title,
                        resultLabel: action.resultLabel,
                        concurrent: action.concurrent,
                        tools: action.tools.map((tool) => ({
                            ...tool,
                            status: "running" as const,
                        })),
                    },
                },
            ];
        case "tool_finished": {
            const updatedMessages = messages.map((message) => {
                const group = message.toolGroup;
                if (!group?.tools.some((tool) => tool.toolId === action.toolId)) return message;

                const denied = action.isError && /^Permission denied/i.test(action.output);
                const tools = group.tools.map((tool) => tool.toolId === action.toolId
                    ? {
                        ...tool,
                        status: denied ? "denied" as const : action.isError ? "error" as const : "success" as const,
                        output: action.output,
                        elapsed: action.elapsed,
                    }
                    : tool
                );
                return {
                    ...message,
                    toolGroup: {
                        ...group,
                        tools,
                    },
                };
            });
            return updatedMessages;
        }
        case "clear_tool_groups":
            return messages.filter((message) => message.phase !== "tool_call");
        case "append_system": {
            return [
                ...messages,
                {
                    role: "system",
                    content: action.content,
                }
            ];
        }
        case "clear_message": {
            return []
        }
    }
};



const Chat = ({ llmClient, workDir, sandboxConfig, mcpServers, contextWindow, toolManager, messageManager, toolResultCompactManger, recoveryManager, runtimeContextManager, memoryManager, selectedProvider, commandManager }: IChat) => {
    // console.log("🚀 ~ Chat ~ instructions:", instructions)
    // console.log("🚀 ~ Chat ~ memReminder:", memReminder)
    const { exit } = useApp()
    const isExitingRef = useRef(false)
    const [messages, dispatchMessages] = useReducer(messagesReducer, [])
    const [isWorking, setIsWorking] = useState(false)
    const [workingLabel, setWorkingLabel] = useState("Thinking")
    const [showExitHint, setShowExitHint] = useState(false)
    const [inputTokens, setInputTokens] = useState(0);
    const [outputTokens, setOutputTokens] = useState(0);
    const [permMode, setPermMode] = useState<PermissionMode>("default")
    const permModeRef = useRef<PermissionMode>("default")
    const changePermissionMode = useCallback((nextMode: PermissionMode) => {
        permModeRef.current = nextMode
        setPermMode(nextMode)
    }, [])
    const cyclePermissionMode = useCallback(() => {
        changePermissionMode(nextPermissionMode(permModeRef.current))
    }, [changePermissionMode])
    // const cmdManagerRef = useRef(createCommandManager());
    const abortControllerRef = useRef<AbortController>(null)
    const permissionResolveRef = useRef<((v: "allow" | "deny" | "allowAlways") => void) | null>(null);
    const [permissionRequest, setPermissionRequest] = useState<{
        toolName: string;
        argsSummary: string;
        reason: string;
    } | null>(null);
    // 用户发送的历史记录
    const sendMessageHistory = useRef<SendMessageHistory>(null)
    if (sendMessageHistory.current === null) {
        sendMessageHistory.current = new SendMessageHistory()
    }
    // 沙箱相关状态
    const sandboxRef = useRef<Sandbox | null>(createSandbox());
    //沙盒总开关引用
    const sandboxEnabledRef = useRef(sandboxConfig.enabled ?? false);
    // 沙盒自动允许开关引用
    const sandboxAutoAllowRef = useRef(sandboxConfig.auto_allow ?? false);
    // 沙盒是否允许联网
    const sandboxNetworkEnabled = sandboxConfig.network_enabled ?? false;

    const [mcpInfo, setMcpInfo] = useState<{ servers: string[]; toolCount: number } | null>(null);

    const handleSystemEvent = useCallback((event: SystemEvent) => {
        switch (event) {
            case "exit": {
                const activeController = abortControllerRef.current
                if (activeController && !activeController.signal.aborted) {
                    activeController.abort()
                    setIsWorking(false)
                    setShowExitHint(true)
                    return
                }

                isExitingRef.current = true
                exit()
                break
            }
        }
    }, [exit])

    const handleSubmit = useCallback(async (message: string) => {
        // console.log("🚀 ~ Chat ~ message:", message)
        dispatchMessages({ type: "append_user", content: message })
        sendMessageHistory.current?.sendMessage(message)
        const result = await handleSlashCommand(message)
        if (result) return
        if (!llmClient) return dispatchMessages({
            type: "append_assistant",
            phase: "error",
            content: "Provider Clinet is not init!",
            merge: false
        })
        setIsWorking(true)
        setWorkingLabel("Thinking")
        setShowExitHint(false)
        //创建接口控制器，用来做取消操作
        const controller = new AbortController();
        abortControllerRef.current = controller;
        let didTimeout = false
        let inactivityTimeoutId: ReturnType<typeof setTimeout> | undefined
        const clearInactivityTimeout = () => {
            if (inactivityTimeoutId) clearTimeout(inactivityTimeoutId)
            inactivityTimeoutId = undefined
        }
        const armInactivityTimeout = () => {
            clearInactivityTimeout()
            inactivityTimeoutId = setTimeout(() => {
                didTimeout = true
                controller.abort()
                setIsWorking(false)
                dispatchMessages({
                    type: "append_assistant",
                    phase: "error",
                    content: "No progress for 120 seconds. Request stopped; please retry.",
                    merge: false
                })
            }, NO_PROGRESS_TIMEOUT_MS)
        }
        //创建沙盒和权限
        const checker = new PermissionChecker(workDir, permModeRef.current, (toolName, args) => {
            if (!isMemoryTool(toolName)) return undefined;
            return memoryManager.resolvePath(memoryScope(args), String(args.path ?? ""));
        });
        checker.addAllowedRoot(memoryManager.getRoot("user"));
        // 将沙箱状态注入权限检查器
        checker.sandboxEnabled = sandboxEnabledRef.current;
        checker.sandboxAutoAllow = sandboxAutoAllowRef.current;
        // 将沙箱注入 BashTool
        const bashTool = toolManager.get("Bash") as BashTool | undefined;
        if (bashTool && sandboxEnabledRef.current) {
            bashTool.sandbox = sandboxRef.current;
            bashTool.sandboxConfig = {
                allowWrite: [workDir, "/tmp"],
                denyWrite: [
                    join(workDir, "config.yaml"),
                    join(workDir, ".nuomi", "permissions.local.yaml"),
                    join(workDir, ".nuomi", "skills"),
                ],
                networkEnabled: sandboxNetworkEnabled,
            };
        } else if (bashTool) {
            bashTool.sandbox = null;
        }
        // console.log("toolManager", toolManager);

        const agent = new Agent({
            client: llmClient,
            messageManager: messageManager,
            toolManger: toolManager,
            toolResultCompactManger: toolResultCompactManger,
            workDir: workDir,
            abortSignal: controller.signal,
            permissionCheck: checker,
            contextWindow: contextWindow,
            recoveryManager: recoveryManager,
            runtimeContextManager,
            // 权限异步等待用户选择后返回结果
            onPermissionRequest: async (toolName, args, decision) => {
                clearInactivityTimeout()
                const response = await new Promise<"allow" | "deny" | "allowAlways">((resolve) => {
                    permissionResolveRef.current = resolve;
                    setIsWorking(false)
                    setPermissionRequest({
                        toolName,
                        argsSummary: formatToolArgs(toolName, args),
                        reason: decision.reason,
                    });
                });
                armInactivityTimeout()
                return response
            },
        })
        // dispatchMessages({ type: "append_user", content: message })
        messageManager.addUserMessage(message)

        let hasReceivedResponse = false
        const timeoutId = setTimeout(() => {
            if (hasReceivedResponse) return

            didTimeout = true
            controller.abort()
            setIsWorking(false)
            dispatchMessages({
                type: "append_assistant",
                phase: "error",
                content: "Request Timeout!",
                merge: false
            })
        }, FIRST_RESPONSE_TIMEOUT_MS)

        try {
            const loopResult = agent.startLoop()
            for await (const event of loopResult) {
                armInactivityTimeout()
                if (!hasReceivedResponse) {
                    hasReceivedResponse = true
                    clearTimeout(timeoutId)
                }

                switch (event.type) {
                    case "thinking_start": {
                        setWorkingLabel("Thinking")
                        break
                    }
                    case "thinking_text": {
                        // Keep internal reasoning out of the transcript. The
                        // uninterrupted status line already communicates work.
                        setWorkingLabel("Thinking")
                        break;
                    }
                    case "stream_text": {
                        // Once visible answer text is streaming, the answer itself
                        // is the progress indicator. If tools are requested later,
                        // tool_group_start turns the loading row back on.
                        setIsWorking(false)
                        dispatchMessages({
                            type: "append_assistant",
                            content: event.text,
                            phase: "final_answer",
                            merge: true
                        })
                        break
                    }
                    case "tool_use": {
                        // The provider may keep streaming for a while after a tool call
                        // is complete. Wait for tool_group_start before showing tool work.
                        break
                    }
                    case "tool_group_start": {
                        const groupLabel = describeToolGroup(event.tools)
                        setWorkingLabel(groupLabel)
                        setIsWorking(true)
                        dispatchMessages({
                            type: "tool_group_started",
                            groupId: event.groupId,
                            concurrent: event.concurrent,
                            title: groupLabel,
                            resultLabel: describeToolGroupResult(event.tools),
                            tools: event.tools.map((tool) => ({
                                toolId: tool.toolId,
                                toolName: tool.toolName,
                                label: formatTool(tool.toolName, tool.args, workDir),
                            })),
                        })
                        break
                    }
                    case "tool_result": {
                        dispatchMessages({
                            type: "tool_finished",
                            toolId: event.toolId,
                            output: event.output,
                            isError: event.isError,
                            elapsed: event.elapsed,
                        })
                        break
                    }
                    case "turn_complete": {
                        setWorkingLabel("Thinking")
                        setIsWorking(true)
                        break
                    }
                    case "loop_complete": {
                        setIsWorking(false)
                        break
                    }
                    case "usage":
                        setInputTokens((prev) => prev + event.usage.inputTokens);
                        setOutputTokens((prev) => prev + event.usage.outputTokens);
                        break;
                    case "error": {
                        setIsWorking(false)
                        dispatchMessages({
                            type: "append_assistant",
                            phase: "error",
                            content: event.error.message,
                            merge: false
                        })
                        break
                    }
                }
            }
        } catch (error) {
            if (!didTimeout && !controller.signal.aborted && !isExitingRef.current) {
                dispatchMessages({
                    type: "append_assistant",
                    phase: "error",
                    content: error instanceof Error ? error.message : "Requset Fail",
                    merge: false
                })
            }
        } finally {
            clearTimeout(timeoutId)
            clearInactivityTimeout()
            if (abortControllerRef.current === controller) {
                abortControllerRef.current = null
                setIsWorking(false)
            }
        }
    }, [llmClient, workDir])

    const handleSlashCommand = async (text: string): Promise<boolean> => {
        let parsed = parseCommand(text);
        if (!parsed) return false;

        // /mcp — show MCP server status
        if (parsed.name === "mcp") {
            if (!mcpInfo || mcpInfo.servers.length === 0) {
                dispatchMessages({
                    type: "append_system",
                    content: "No MCP servers connected.",
                })
            } else {
                const lines = [
                    `MCP servers (${mcpInfo.servers.length}):`,
                    ...mcpInfo.servers.map((s) => `  · ${s}`),
                    `Tools: ${mcpInfo.toolCount} total`,
                ];
                dispatchMessages({
                    type: "append_system",
                    content: lines.join("\n"),
                })
            }
            // usageTrackerRef.current.record("mcp");
            return true;
        }

        // `/skill <name> [args]` shorthand: rewrite to `/<name> [args]` so it
        // goes through the normal command registry path (skills are wired there).
        // Exception: `/skill reload` routes to the /skills handler instead.
        if (parsed.name === "skill" && parsed.args.trim()) {
            const parts = parsed.args.trim().split(/\s+/);
            if (parts[0] === "reload") {
                parsed = { name: "skills", args: "reload" };
            } else {
                parsed = { name: parts[0], args: parts.slice(1).join(" ") };
            }
        }

        const cmd = commandManager.find(parsed.name);
        // if (cmd) usageTrackerRef.current.record(cmd.name);
        if (!cmd) {
            dispatchMessages({
                type: "append_system",
                content: `Unknown command: /${parsed.name}`,
            })
            return true;
        }

        // Rich status/memory commands need live app state, so handle them here.
        if (cmd.name === "status") {
            const sbStatus = sandboxEnabledRef.current
                ? (sandboxAutoAllowRef.current ? "ON (auto-allow)" : "ON (manual)")
                : "OFF";
            const lines = [
                `Mode:      ${permMode}`,
                `Model:     ${selectedProvider.model}`,
                `Provider:  ${selectedProvider.name} (${selectedProvider.protocol})`,
                `Tokens:    ${inputTokens} in / ${outputTokens} out`,
                `Tools:     ${toolManager.listTools().length}`,
                `Sandbox:   ${sbStatus}`,
                // `Memories:  ${new MemoryManager(workDir).getMemories().length}`,
                // `Skills:    ${skillCatalogRef.current?.list().length ?? 0}`,
                `MCP:       ${mcpInfo?.servers.length ?? 0} server(s), ${mcpInfo?.toolCount ?? 0} tool(s)`,
                // `Session:   ${sessionStorage.current}`,
                `Directory: ${workDir}`,
            ];
            dispatchMessages({
                type: "append_system",
                content: lines.join("\n"),
            })
            // setMessages((prev) => [...prev, { role: "system", content: lines.join("\n") }]);
            return true;
        }
        if (cmd.name === "permission") {
            const parts = parsed.args.trim().split(/\s+/);
            const modes = PERMISSION_MODE_ORDER;
            if (parts[0] === "mode" && parts[1]) {
                if (modes.includes(parts[1] as PermissionMode)) {
                    const nextMode = parts[1] as PermissionMode;
                    changePermissionMode(nextMode);
                    dispatchMessages({
                        type: "append_system",
                        content: `Permission mode → ${parts[1]}`,
                    })
                } else {
                    dispatchMessages({
                        type: "append_system",
                        content: `Unknown mode '${parts[1]}'. Valid: ${modes.join(", ")}`,
                    })
                }
            } else {
                dispatchMessages({
                    type: "append_system",
                    content:
                        `Permission mode: ${permMode}\n` +
                        "Change with shift+tab, or /permission mode <default|acceptEdits|plan|bypassPermissions>",
                })
            }
            return true;
        }

        if (cmd.type === "local_ui") {
            const action = cmd.handler({ workDir, args: parsed.args });
            switch (action) {
                case "clear":
                    dispatchMessages({
                        type: "clear_message",
                    })
                    // setMessages([]);
                    // committedIndexRef.current = 0;
                    messageManager.clear()
                    break;
                case "quit":
                    exit();
                    break;
                case "plan": {
                    // setPrePlanMode(permMode);
                    changePermissionMode("plan");
                    // const planPath = getOrCreatePlanPath(workDir);
                    dispatchMessages({
                        type: "append_system",
                        content: `Entered plan mode (read-only). Plan file: ${""}\n` +
                            "Investigate and design your approach. The agent will call ExitPlanMode when the plan is ready.",
                    })
                    // 重入检测：如果本次会话曾退出过 Plan Mode 且 plan 文件已存在，注入重入提示
                    // if (hasExitedPlanModeRef.current && planExists(workDir)) {
                    //     const reentryMsg = buildPlanModeReentryReminder(planPath, true);
                    //     if (reentryMsg) {
                    //         convRef.current.addSystemReminder(reentryMsg);
                    //         setMessages((prev) => [
                    //             ...prev,
                    //             { role: "system", content: reentryMsg },
                    //         ]);
                    //     }
                    //     hasExitedPlanModeRef.current = false;
                    // }
                    break;
                }
                // case "do": {
                //     setPermMode("default");
                //     // 标记本次会话已退出过 Plan Mode，后续重入时可注入提示
                //     hasExitedPlanModeRef.current = true;
                //     const planContent = loadPlan(workDir);
                //     const exitPlanPath = getOrCreatePlanPath(workDir);
                //     convRef.current.addSystemReminder(buildPlanModeExitReminder(exitPlanPath, !!planContent));
                //     if (planContent && planContent.trim()) {
                //         // Feed the approved plan back to the agent and execute it.
                //         convRef.current.addUserMessage(
                //             "The plan below has been approved. Exit plan mode and carry it out now.\n\n" +
                //             "# Approved Plan\n" +
                //             planContent
                //         );
                //         resetPlanPath();
                //         setMessages((prev) => [...prev, { role: "system", content: "✓ Plan approved — executing." }]);
                //         runAgentLoop("default");
                //     } else {
                //         setMessages((prev) => [...prev, { role: "system", content: "Exited plan mode." }]);
                //     }
                //     break;
                // }
                // case "compact":
                //     if (clientRef.current) {
                //         setMessages((prev) => [...prev, { role: "system", content: "Compacting conversation..." }]);
                //         forceCompact(
                //             convRef.current,
                //             clientRef.current,
                //             recoveryStateRef.current,
                //             registryRef.current.listTools().map((t) => t.name)
                //         ).then((result) => {
                //             // Persist the boundary so the compacted state survives /resume.
                //             if (result.boundary) {
                //                 sessionMod.saveCompactBoundary(workDir, sessionIdRef.current, result.boundary);
                //             }
                //             setMessages((prev) => [...prev, { role: "system", content: `Compact: ${result.message}` }]);
                //         }).catch((err) => {
                //             setMessages((prev) => [...prev, { role: "system", content: `Compact failed: ${(err as Error).message}` }]);
                //         });
                //     }
                //     break;
                // case "resume": {
                //     const arg = parsed.args.trim();
                //     if (!arg) {
                //         const sessions = sessionMod.listSessions(workDir);
                //         if (sessions.length === 0) {
                //             setMessages((prev) => [...prev, { role: "system", content: "No sessions found." }]);
                //         } else {
                //             const list = sessions
                //                 .slice(0, 10)
                //                 .map((s) => `  ${s.id} (${s.messageCount} msgs) — ${s.firstMessage}`)
                //                 .join("\n");
                //             setMessages((prev) => [
                //                 ...prev,
                //                 { role: "system", content: `Sessions (use /resume <id> to restore):\n${list}` },
                //             ]);
                //         }
                //         break;
                //     }

                //     const saved = sessionMod.loadSession(workDir, arg);
                //     if (saved.length === 0) {
                //         setMessages((prev) => [...prev, { role: "system", content: `Session "${arg}" not found or empty.` }]);
                //         break;
                //     }

                //     // Rebuild the conversation (with long-term memory re-injected) and the
                //     // visible transcript from the saved messages, then continue under the
                //     // resumed session id. rebuildFromSession honors compaction: if the
                //     // session contains a compact_boundary it replays the compacted state
                //     // (summary + inlined keep + post-boundary appends) instead of the full
                //     // pre-boundary history; with no boundary it replays everything.
                //     const conv = new ConversationManager();
                //     conv.injectLongTermMemory(
                //         loadInstructions(workDir),
                //         new MemoryManager(workDir).buildSystemReminder()
                //     );
                //     const restored = sessionMod.rebuildFromSession(saved);
                //     for (const m of restored) {
                //         if (m.role === "user") conv.addUserMessage(m.content);
                //         else conv.addAssistantMessage(m.content);
                //     }
                //     convRef.current = conv;
                //     sessionIdRef.current = arg;
                //     // Reload the task list for the resumed session.
                //     taskListRef.current.useStore(new TaskStore(workDir, arg));
                //     const resumedMessages: ChatMessage[] = [
                //         ...restored,
                //         { role: "system", content: `⟲ Resumed session ${arg} (${restored.length} messages).` },
                //     ];
                //     committedIndexRef.current = resumedMessages.length;
                //     setMessages(resumedMessages);
                //     break;
                // }
                // case "skills": {
                //     const catalog = skillCatalogRef.current;
                //     if (!catalog) {
                //         setMessages((prev) => [...prev, { role: "system", content: "Skills: no catalog loaded." }]);
                //     } else if (parsed.args.trim() === "reload") {
                //         // /skills reload — 手动热加载
                //         catalog.reload();
                //         wireSkillsToRegistry(catalog, cmdRegistryRef.current, skillHostRef.current);
                //         if (clientRef.current) {
                //             const env = detectEnvironment(workDir);
                //             env.model = selectedProvider.model;
                //             const section = buildSkillSection(catalog, workDir);
                //             clientRef.current.setSystemPrompt(buildSystemPrompt(env, { skillSection: section }));
                //         }
                //         const count = catalog.list().length;
                //         setMessages((prev) => [...prev, { role: "system", content: `Skills reloaded. ${count} skill(s) available.` }]);
                //     } else {
                //         const skills = catalog.list();
                //         if (skills.length === 0) {
                //             setMessages((prev) => [...prev, { role: "system", content: "No skills found in .mewcode/skills/." }]);
                //         } else {
                //             const list = skills.map((s) => `  /${s.name} — ${s.description}`).join("\n");
                //             setMessages((prev) => [...prev, { role: "system", content: `Available skills:\n${list}\n\nType /skills reload to hot-reload skills from disk.` }]);
                //         }
                //     }
                //     break;
                // }
                // case "worktree": {
                //     try {
                //         const { execSync } = await import("node:child_process");
                //         const output = execSync("git worktree list", { cwd: workDir, encoding: "utf-8" });
                //         setMessages((prev) => [...prev, { role: "system", content: `Worktree list:\n${output}` }]);
                //     } catch {
                //         setMessages((prev) => [...prev, { role: "system", content: "Not a git repository or git worktree not available." }]);
                //     }
                //     break;
                // }
                // case "rewind": {
                //     const fh = fileHistoryRef.current;
                //     if (!fh || !fh.hasSnapshots()) {
                //         setMessages((prev) => [...prev, { role: "system", content: "No checkpoints to rewind to." }]);
                //     } else {
                //         setRewindSnapshots(fh.getSnapshots());
                //         setRewindDialogActive(true);
                //     }
                //     break;
                // }
                // case "sandbox": {
                //     const arg = parsed.args.trim();
                //     const sbAvailable = sandboxRef.current?.available() ?? false;
                //     if (arg === "1" || arg === "on") {
                //         // 模式 1：沙箱 + 自动放行
                //         setSandboxEnabled(true);
                //         setSandboxAutoAllow(true);
                //         sandboxEnabledRef.current = true;
                //         sandboxAutoAllowRef.current = true;
                //         setMessages((prev) => [...prev, {
                //             role: "system",
                //             content: `Sandbox: ON + auto-allow${sbAvailable ? "" : " (sandbox tool not found, wrapping disabled)"}`,
                //         }]);
                //     } else if (arg === "2" || arg === "manual") {
                //         // 模式 2：沙箱 + 常规权限
                //         setSandboxEnabled(true);
                //         setSandboxAutoAllow(false);
                //         sandboxEnabledRef.current = true;
                //         sandboxAutoAllowRef.current = false;
                //         setMessages((prev) => [...prev, {
                //             role: "system",
                //             content: `Sandbox: ON + manual permissions${sbAvailable ? "" : " (sandbox tool not found, wrapping disabled)"}`,
                //         }]);
                //     } else if (arg === "3" || arg === "off") {
                //         // 模式 3：关闭沙箱
                //         setSandboxEnabled(false);
                //         setSandboxAutoAllow(false);
                //         sandboxEnabledRef.current = false;
                //         sandboxAutoAllowRef.current = false;
                //         setMessages((prev) => [...prev, {
                //             role: "system",
                //             content: "Sandbox: OFF",
                //         }]);
                //     } else {
                //         // 显示当前状态和三种模式
                //         const status = sandboxEnabled
                //             ? (sandboxAutoAllow ? "ON + auto-allow" : "ON + manual")
                //             : "OFF";
                //         const lines = [
                //             `Sandbox status: ${status}`,
                //             `Platform tool: ${sbAvailable ? "available" : "not found"}`,
                //             "",
                //             "Usage: /sandbox <mode>",
                //             "  1 (on)     — 开启沙箱 + 自动放行（推荐）",
                //             "  2 (manual) — 开启沙箱 + 常规权限确认",
                //             "  3 (off)    — 关闭沙箱",
                //         ];
                //         setMessages((prev) => [...prev, { role: "system", content: lines.join("\n") }]);
                //     }
                //     break;
                // }
            }
            return true;
        }


        return false;
    };

    const handlePromptSubmit = async (message: string): Promise<void> => {
        if (await handleSlashCommand(message)) return;
        await handleSubmit(message);
    };

    const truncate = (s: string, max: number): string =>
        s.length > max ? s.slice(0, max) + "…" : s;

    const formatPath = (value: unknown, baseDir: string): string => {
        if (typeof value !== "string" || !value) return ".";
        if (!isAbsolute(value)) return value;
        return relative(baseDir, value) || ".";
    };

    const parseMcpToolName = (toolName: string): { server: string; tool: string } | null => {
        const match = toolName.match(/^mcp__(.+?)__(.+)$/);
        return match ? { server: match[1], tool: match[2] } : null;
    };

    const humanizeIdentifier = (value: string): string =>
        value
            .replace(/[-_]+/g, " ")
            .replace(/\b\w/g, (letter) => letter.toUpperCase());

    const formatMcpServer = (server: string): string =>
        server.toLowerCase() === "context7" ? "Context7" : humanizeIdentifier(server);

    const formatMcpTool = (
        server: string,
        tool: string,
        args: Record<string, unknown>
    ): string => {
        const serverLabel = formatMcpServer(server);

        if (tool === "resolve-library-id") {
            const libraryName = String(args.libraryName ?? args.library_name ?? "").trim();
            return libraryName
                ? `Resolve library: ${truncate(libraryName, 72)}`
                : `Resolve library with ${serverLabel}`;
        }

        if (tool === "query-docs") {
            const libraryId = String(args.libraryId ?? args.library_id ?? "").trim();
            return libraryId
                ? `Search docs: ${truncate(libraryId, 72)}`
                : `Search documentation with ${serverLabel}`;
        }

        return humanizeIdentifier(tool);
    };

    const formatTool = (
        toolName: string,
        args: Record<string, unknown>,
        baseDir: string
    ): string => {
        const filePath = formatPath(args.file_path ?? args.path, baseDir);
        const pattern = truncate(String(args.pattern ?? ""), 72);
        const mcpTool = parseMcpToolName(toolName);

        if (mcpTool) {
            return formatMcpTool(mcpTool.server, mcpTool.tool, args);
        }

        switch (toolName) {
            case "ReadFile":
                return `Read ${filePath}`;
            case "WriteFile":
                return `Write ${filePath}`;
            case "EditFile":
                return `Edit ${filePath}`;
            case "ReadMemory":
                return `Read ${formatMemoryTarget(args)}`;
            case "WriteMemory":
            case "EditMemory":
                return `Write ${formatMemoryTarget(args)}`;
            case "Glob":
                return `Glob  ${pattern || "*"}${filePath === "." ? "" : ` in ${filePath}`}`;
            case "Grep": {
                const scope = args.include ? String(args.include) : filePath;
                return `Grep  "${pattern}" in ${scope}`;
            }
            case "Bash":
                return `$ ${truncate(String(args.command ?? ""), 96)}`;
            case "ToolSearch": {
                const query = String(args.query ?? "").trim();
                if (!query) return "Discover MCP tools";
                if (query.startsWith("select:")) {
                    return `Load MCP tools: ${truncate(query.slice(7), 72)}`;
                }
                return `Find MCP tools: ${truncate(query, 72)}`;
            }
            default:
                return toolName;
        }
    };

    const isMetadataSearch = (tools: Array<{ args: Record<string, unknown> }>): boolean => {
        const content = tools
            .flatMap((tool) => Object.values(tool.args))
            .map(String)
            .join(" ")
            .toLowerCase();
        return /package\.json|pyproject\.toml|cargo\.toml|go\.mod|version/.test(content);
    };

    //工具分组的描述
    const describeToolGroup = (
        tools: Array<{ toolName: string; args: Record<string, unknown> }>
    ): string => {
        const names = tools.map((tool) => tool.toolName);
        const mcpTools = names.map(parseMcpToolName);
        const parsedMcpTools = mcpTools.filter((tool): tool is NonNullable<typeof tool> => tool !== null);

        if (names.every((name) => name === "ToolSearch")) return "Discover MCP tools";
        if (parsedMcpTools.length > 0 && parsedMcpTools.length === mcpTools.length) {
            const servers = new Set(parsedMcpTools.map((tool) => tool.server));
            if (servers.size === 1) {
                return `Use ${formatMcpServer(parsedMcpTools[0].server)}`;
            }
            return "Use MCP tools";
        }

        if (names.every((name) => name === "Glob" || name === "Grep")) {
            return isMetadataSearch(tools) ? "Search project metadata" : "Search project files";
        }
        if (names.every((name) => name === "ReadFile")) return "Read project files";
        if (names.every((name) => name === "ReadMemory")) return "Reading memory";
        if (names.every((name) => name === "WriteMemory" || name === "EditMemory")) return "Writing memory";
        if (names.every((name) => name === "WriteFile" || name === "EditFile")) {
            return "Modify project files";
        }
        if (names.every((name) => name === "Bash")) return "Run commands";
        return "Inspect project";
    };

    const describeToolGroupResult = (
        tools: Array<{ toolName: string; args: Record<string, unknown> }>
    ): string => {
        const names = tools.map((tool) => tool.toolName);
        const mcpTools = names.map(parseMcpToolName);
        const parsedMcpTools = mcpTools.filter((tool): tool is NonNullable<typeof tool> => tool !== null);

        if (names.every((name) => name === "ToolSearch")) return "MCP tool discovery complete";
        if (parsedMcpTools.length > 0 && parsedMcpTools.length === mcpTools.length) {
            const servers = new Set(parsedMcpTools.map((tool) => tool.server));
            if (servers.size === 1) {
                return `${formatMcpServer(parsedMcpTools[0].server)} call complete`;
            }
            return "MCP calls complete";
        }

        if (names.every((name) => name === "Glob" || name === "Grep")) return "Search complete";
        if (names.every((name) => name === "ReadFile")) return "Files read";
        if (names.every((name) => name === "ReadMemory")) return "Memory read";
        if (names.every((name) => name === "WriteMemory" || name === "EditMemory")) return "Memory updated";
        if (names.every((name) => name === "WriteFile" || name === "EditFile")) return "Changes applied";
        if (names.every((name) => name === "Bash")) return "Commands complete";
        return "Tools complete";
    };

    const formatToolArgs = (toolName: string, args: Record<string, unknown>): string => {
        if (isMemoryTool(toolName)) return truncate(formatMemoryTarget(args), 120);
        if (args.command) return truncate(String(args.command), 80);
        if (args.file_path) return truncate(String(args.file_path), 80);
        if (args.pattern) return truncate(String(args.pattern), 80);
        return "";
    };

    const formatMemoryTarget = (args: Record<string, unknown>): string => {
        try {
            const scope = memoryScope(args);
            const label = scope === "user" ? "User memory" : "Project memory";
            return `${label} · ${memoryManager.formatDisplayPath(scope, String(args.path ?? ""))}`;
        } catch {
            return `Memory · invalid path (${String(args.path ?? "") || "missing"})`;
        }
    };

    const handleSubmitAsk = (action: PermissionAction) => {
        const resolvePermission = permissionResolveRef.current
        permissionResolveRef.current = null
        setPermissionRequest(null)
        setWorkingLabel("Running tools")
        setIsWorking(true)
        resolvePermission?.(action)
    }

    useInput((input, key) => {
        if (key.tab && key.shift && !permissionRequest) {
            cyclePermissionMode()
            return
        }
        if (input === "c" && key.ctrl) {
            handleSystemEvent("exit")
        }
    })

    useEffect(() => {
        const handleSigint = () => handleSystemEvent("exit")
        process.on("SIGINT", handleSigint)

        return () => {
            process.off("SIGINT", handleSigint)
        }
    }, [handleSystemEvent])

    // 创建MCP
    useEffect(() => {
        const mcpManager = new MCPManager();
        const registeredToolNames: string[] = [];
        let disposed = false;

        setMcpInfo(null);

        const initialize = async () => {
            const result = await mcpManager.connectAll(mcpServers);

            // effect 已清理，不再注册工具或修改状态
            if (disposed) {
                await mcpManager.disconnectAll();
                return;
            }

            for (const { serverName, tool } of result.tools) {
                const client = mcpManager.getClient(serverName);
                if (!client) continue;

                const wrapper = new MCPToolWrapper(
                    client,
                    serverName,
                    tool
                );

                toolManager.register(wrapper);
                registeredToolNames.push(wrapper.name);
            }

            if (result.errors.length > 0) {
                dispatchMessages({
                    type: "append_assistant",
                    content: `MCP errors: ${result.errors
                        .map(
                            ({ serverName, error }) =>
                                `${serverName}: ${error}`
                        )
                        .join("; ")}`,
                    phase: "error",
                    merge: false,
                });
            }

            if (result.servers.length > 0) {
                setMcpInfo({
                    servers: result.servers,
                    toolCount: result.tools.length,
                });
            }

            runtimeContextManager.setMcpRuntimeContext(
                result.instructions.map(({ serverName, text }) => `# MCP Server: ${serverName}\n${text}`),
            );
        };

        void initialize().catch((error: unknown) => {
            if (disposed) return;

            dispatchMessages({
                type: "append_assistant",
                content: `MCP initialization failed: ${error instanceof Error
                    ? error.message
                    : String(error)
                    }`,
                phase: "error",
                merge: false,
            });

            void mcpManager.disconnectAll();
        });

        return () => {
            disposed = true;

            // 删除引用旧 MCP client 的工具
            for (const name of registeredToolNames) {
                toolManager.unregister(name);
            }

            setMcpInfo(null);
            runtimeContextManager.setMcpRuntimeContext("");
            void mcpManager.disconnectAll();
        };
    }, [mcpServers, toolManager, runtimeContextManager]);

    return (
        <Box flexDirection="column">
            <MessageList messages={messages} isWorking={isWorking} workingLabel={workingLabel} />
            {permissionRequest && <PermissionDialog toolName={permissionRequest.toolName} argsSummary={permissionRequest.argsSummary} reason={permissionRequest.reason} onComplete={handleSubmitAsk} />}
            <PromptInput
                commands={commandManager.listCommands()}
                isWaiting={!!permissionRequest}
                history={sendMessageHistory.current.getAllMessage()}
                permissionMode={permMode}
                onSubmit={(message) => void handlePromptSubmit(message)}
            />
            {showExitHint && (
                <Box marginLeft={2}>
                    <Text dimColor>Press Ctrl+C again to exit.</Text>
                </Box>
            )}
        </Box>
    )
}

export default memo(Chat)
