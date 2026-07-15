import React, { memo, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { MCPServerConfig, ProviderConfig, SandBoxConfig } from '../types/provider.js'
import { Box, Text, useApp, useInput } from 'ink'
import MessageList, { ChatMessage, MessagePhase } from './MessageList/index.js'
import PromptInput from './PromptInput.js'
import AnthropicClient from '../client/anthorpic.js'
import OpenAIClient from '../client/openai.js'
import { Agent } from '../client/agent.js'
import { MessageManger } from '../messageManger/message.js'
import { ToolsManger } from '../tools/register.js'
import { ReadFile } from '../tools/read-file.js'
import { createSandbox, Sandbox } from '../sandbox/index.js'
import { PermissionChecker, PermissionMode } from '../premisson/checker.js'
import { WriteFileTool } from '../tools/write-file.js'
import { EditFileTool } from '../tools/edit-file.js'
import { GlobTool } from '../tools/glob.js'
import { GrepTool } from '../tools/grep.js'
import { BashTool } from '../tools/bash.js'
import { isAbsolute, join, relative } from 'node:path'
import { PermissionAction, PermissionDialog } from './PermissionDialog.js'
import { MCPManager } from '../mcp/manger.js'
import { MCPToolWrapper } from '../mcp/tool-wrapper.js'
import { ToolSearchTool } from '../tools/tool-search.js'
interface IChat {
    llmClient: AnthropicClient | OpenAIClient | undefined
    workDir: string
    changeProvider: (provider: ProviderConfig) => void
    permMode: PermissionMode
    sandboxConfig: SandBoxConfig
    mcpServers: MCPServerConfig[]
}

const FIRST_RESPONSE_TIMEOUT_MS = 60_000
type SystemEvent = "exit"

type MessageAction =
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

// 处理UI侧显示的消息
const messagesReducer = (messages: ChatMessage[], action: MessageAction): ChatMessage[] => {
    switch (action.type) {
        case "append_user":
            return [...messages, { role: "user", content: action.content }];
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
            return [
                ...messages,
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
        case "tool_finished":
            return messages.map((message) => {
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
    }
};

const createToolManager = (): ToolsManger => {
    const manager = new ToolsManger();
    manager.register(new ReadFile());
    manager.register(new WriteFileTool());
    manager.register(new EditFileTool());
    manager.register(new GlobTool());
    manager.register(new GrepTool());
    manager.register(new BashTool());
    manager.register(new ToolSearchTool(manager));
    return manager;
};

const Chat = ({ llmClient, workDir, permMode, sandboxConfig, mcpServers }: IChat) => {
    const { exit } = useApp()
    const isExitingRef = useRef(false)
    const [messages, dispatchMessages] = useReducer(messagesReducer, [])
    const [isWorking, setIsWorking] = useState(false)
    const [workingLabel, setWorkingLabel] = useState("Thinking")
    const [showExitHint, setShowExitHint] = useState(false)
    const abortControllerRef = useRef<AbortController>(null)
    const permissionResolveRef = useRef<((v: "allow" | "deny" | "allowAlways") => void) | null>(null);
    const [permissionRequest, setPermissionRequest] = useState<{
        toolName: string;
        argsSummary: string;
        reason: string;
    } | null>(null);
    // 沙箱相关状态
    const sandboxRef = useRef<Sandbox | null>(createSandbox());
    // 沙盒总开关
    const [sandboxEnabled, setSandboxEnabled] = useState(sandboxConfig.enabled ?? false);
    //沙盒自动允许开关
    const [sandboxAutoAllow, setSandboxAutoAllow] = useState(sandboxConfig.auto_allow ?? false);
    //沙盒总开关引用
    const sandboxEnabledRef = useRef(sandboxConfig.enabled ?? false);
    // 沙盒自动允许开关引用
    const sandboxAutoAllowRef = useRef(sandboxConfig.auto_allow ?? false);
    // 沙盒是否允许联网
    const sandboxNetworkEnabled = sandboxConfig.network_enabled ?? false;

    const [mcpInfo, setMcpInfo] = useState<{ servers: string[]; toolCount: number } | null>(null);
    const messageManagerRef = useRef<MessageManger | null>(null);
    const toolManagerRef = useRef<ToolsManger | null>(null);
    if (messageManagerRef.current === null) {
        messageManagerRef.current = new MessageManger();
    }
    if (toolManagerRef.current === null) {
        toolManagerRef.current = createToolManager();
    }
    const messageManager = messageManagerRef.current;
    const toolManager = toolManagerRef.current;


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
        //创建沙盒和权限
        const checker = new PermissionChecker(workDir, permMode);
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
        console.log("toolManager", toolManager);

        const agent = new Agent({
            client: llmClient,
            messageManger: messageManager,
            toolManger: toolManager,
            workDir: workDir,
            abortSignal: controller.signal,
            permissionCheck: checker,
            // 权限异步等待用户选择后返回结果
            onPermissionRequest: async (toolName, args, decision) => {
                return new Promise<"allow" | "deny" | "allowAlways">((resolve) => {
                    permissionResolveRef.current = resolve;
                    setIsWorking(false)
                    setPermissionRequest({
                        toolName,
                        argsSummary: formatToolArgs(args),
                        reason: decision.reason,
                    });
                });
            },
        })
        dispatchMessages({ type: "append_user", content: message })
        messageManager.addUserMessage(message)

        let hasReceivedResponse = false
        let didTimeout = false
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
                if (!hasReceivedResponse) {
                    hasReceivedResponse = true
                    clearTimeout(timeoutId)
                }

                switch (event.type) {
                    case "thinking_start": {
                        setIsWorking(false)
                        break
                    }
                    case "thinking_text": {
                        setIsWorking(false)
                        dispatchMessages({
                            type: "append_assistant",
                            content: event.text,
                            phase: "thinking",
                            merge: true
                        })
                        break;
                    }
                    case "stream_text": {
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
                        setWorkingLabel("Preparing tools")
                        setIsWorking(true)
                        break
                    }
                    case "tool_group_start": {
                        setWorkingLabel("Running tools")
                        setIsWorking(true)
                        dispatchMessages({
                            type: "tool_group_started",
                            groupId: event.groupId,
                            concurrent: event.concurrent,
                            title: describeToolGroup(event.tools),
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
            if (abortControllerRef.current === controller) {
                abortControllerRef.current = null
                setIsWorking(false)
            }
        }
    }, [llmClient, workDir])

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
        if (names.every((name) => name === "WriteFile" || name === "EditFile")) return "Changes applied";
        if (names.every((name) => name === "Bash")) return "Commands complete";
        return "Tools complete";
    };

    const formatToolArgs = (args: Record<string, unknown>): string => {
        if (args.command) return truncate(String(args.command), 80);
        if (args.file_path) return truncate(String(args.file_path), 80);
        if (args.pattern) return truncate(String(args.pattern), 80);
        return "";
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

            for (const { serverName, text } of result.instructions) {
                messageManager.addSystemReminder(
                    `# MCP Server: ${serverName}\n${text}`
                );
            }
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
            void mcpManager.disconnectAll();
        };
    }, [mcpServers, toolManager, messageManager]);

    return (
        <Box flexDirection="column">
            <MessageList messages={messages} isWorking={isWorking} workingLabel={workingLabel} />
            {permissionRequest && <PermissionDialog toolName={permissionRequest.toolName} argsSummary={permissionRequest.argsSummary} reason={permissionRequest.reason} onComplete={handleSubmitAsk} />}
            <PromptInput isWaiting={!!permissionRequest} onSubmit={handleSubmit} />
            {showExitHint && (
                <Box marginLeft={2}>
                    <Text dimColor>Press Ctrl+C again to exit.</Text>
                </Box>
            )}
        </Box>
    )
}

export default memo(Chat)
