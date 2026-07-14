import React, { memo, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { ProviderConfig } from '../types/provider.js'
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
interface IChat {
    llmClient: AnthropicClient | OpenAIClient | undefined
    workDir: string
    changeProvider: (provider: ProviderConfig) => void
    permMode: PermissionMode
}

const FIRST_RESPONSE_TIMEOUT_MS = 60_000
type SystemEvent = "exit"

type MessageAction =
    | { type: "append_user"; content: string }
    | { type: "append_assistant"; content: string; phase: MessagePhase; merge: boolean }

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
    }
};

const Chat = ({ llmClient, workDir, permMode }: IChat) => {
    const { exit } = useApp()
    const isExitingRef = useRef(false)
    const messageMangerRuf = useRef(new MessageManger())
    const toolMangerRuf = useRef(new ToolsManger())
    const [messages, dispatchMessages] = useReducer(messagesReducer, [])
    const [isWorking, setIsWorking] = useState(false)
    const [showExitHint, setShowExitHint] = useState(false)
    const abortControllerRef = useRef<AbortController>(null)


    // 沙箱相关状态
    const sandboxRef = useRef<Sandbox | null>(createSandbox());
    const [sandboxEnabled, setSandboxEnabled] = useState(false);
    const [sandboxAutoAllow, setSandboxAutoAllow] = useState(false);
    const sandboxEnabledRef = useRef(false);
    const sandboxAutoAllowRef = useRef(false);
    const sandboxNetworkEnabled = true;

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
        // 注册工具
        toolMangerRuf.current.register(new ReadFile())
        toolMangerRuf.current.register(new WriteFileTool())
        toolMangerRuf.current.register(new EditFileTool())
        toolMangerRuf.current.register(new GlobTool())
        toolMangerRuf.current.register(new GrepTool())
        //创建接口控制器，用来做取消操作
        const controller = new AbortController();
        abortControllerRef.current = controller;
        //创建沙盒和权限
        const checker = new PermissionChecker(workDir, permMode);
        // 将沙箱状态注入权限检查器
        checker.sandboxEnabled = sandboxEnabledRef.current;
        checker.sandboxAutoAllow = sandboxAutoAllowRef.current;
        const agent = new Agent(llmClient, messageMangerRuf.current, toolMangerRuf.current, workDir, controller.signal)
        dispatchMessages({ type: "append_user", content: message })
        messageMangerRuf.current.addUserMessage(message)

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
                        console.log(JSON.stringify(event.args));

                        dispatchMessages({
                            type: "append_assistant",
                            content: formatTool(event.toolName, event.args),
                            phase: "tool_call",
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

    const formatTool = (toolName: string, toolArg: Record<string, unknown>) => {
        if (toolName === "ReadFile") {
            return `${toolName},${toolArg.file_path || ""}`
        }
        return ""
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

    return (
        <Box flexDirection="column">
            <MessageList messages={messages} isWorking={isWorking} />
            <PromptInput onSubmit={handleSubmit} />
            {showExitHint && (
                <Box marginLeft={2}>
                    <Text dimColor>Press Ctrl+C again to exit.</Text>
                </Box>
            )}
        </Box>
    )
}

export default memo(Chat)
