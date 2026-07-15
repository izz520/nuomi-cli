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
                        setIsWorking(false)
                        break
                    }
                    case "tool_group_start": {
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

    const formatTool = (
        toolName: string,
        args: Record<string, unknown>,
        baseDir: string
    ): string => {
        const filePath = formatPath(args.file_path ?? args.path, baseDir);
        const pattern = truncate(String(args.pattern ?? ""), 72);

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
        let disposed = false;

        void (async () => {
            //获取全部MCP
            const result = await mcpManager.connectAll(mcpServers);
            //是否是已经关闭了，关闭了则断开全部连接
            if (disposed) {
                await mcpManager.disconnectAll();
                return;
            }

            for (const { serverName, tool } of result.tools) {
                const client = mcpManager.getClient(serverName);
                if (!client) continue;

                toolManager.register(
                    new MCPToolWrapper(client, serverName, tool)
                );
            }

            // 如果有错误，则显示出来
            if (result.errors.length > 0) {
                dispatchMessages({
                    type: "append_assistant",
                    content: `MCP errors: ${result.errors
                        .map(({ serverName, error }) => `${serverName}: ${error}`)
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
        })();

        return () => {
            disposed = true;
            void mcpManager.disconnectAll();
        };
    }, [mcpServers, toolManager, messageManager]);

    return (
        <Box flexDirection="column">
            <MessageList messages={messages} isWorking={isWorking} />
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
