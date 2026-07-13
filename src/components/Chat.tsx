import React, { memo, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { ProviderConfig } from '../types/provider.js'
import { Box, useApp, useInput } from 'ink'
import MessageList, { ChatMessage, MessagePhase } from './MessageList/index.js'
import PromptInput from './PromptInput.js'
import AnthropicClient from '../client/anthorpic.js'
import OpenAIClient from '../client/openai.js'
import { Agent } from '../client/agent.js'
import { MessageManger } from '../messageManger/message.js'
import writeLog from '../utils/writeLog.js'
import { AgentEvent } from '../types/agent.js'
import { ToolsManger } from '../tools/register.js'
import { ReadFile } from '../tools/read-file.js'
interface IChat {
    llmClient: AnthropicClient | OpenAIClient | undefined
    workDir: string
    changeProvider: (provider: ProviderConfig) => void
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

const Chat = ({ llmClient, workDir }: IChat) => {
    const { exit } = useApp()
    const messageMangerRuf = useRef(new MessageManger())
    const toolMangerRuf = useRef(new ToolsManger())
    const [messages, dispatchMessages] = useReducer(messagesReducer, [])
    const abortControllerRef = useRef<AbortController>(null)
    const isExitingRef = useRef(false)

    const handleSystemEvent = useCallback((event: SystemEvent) => {
        switch (event) {
            case "exit":
                isExitingRef.current = true
                abortControllerRef.current?.abort()
                exit()
                break
        }
    }, [exit])

    useInput((input, key) => {
        if (input === "c" && key.ctrl) {
            handleSystemEvent("exit")
        }
    })

    useEffect(() => {
        const handleSigint = () => handleSystemEvent("exit")
        process.once("SIGINT", handleSigint)

        return () => {
            process.off("SIGINT", handleSigint)
        }
    }, [handleSystemEvent])

    const handleSubmit = useCallback(async (message: string) => {
        if (!llmClient) return dispatchMessages({
            type: "append_assistant",
            phase: "error",
            content: "Provider Clinet is not init!",
            merge: false
        })
        //创建接口控制器，用来做取消操作
        const controller = new AbortController();
        abortControllerRef.current = controller;
        const agent = new Agent(llmClient, messageMangerRuf.current, toolMangerRuf.current, workDir, controller.signal)
        dispatchMessages({ type: "append_user", content: message })
        messageMangerRuf.current.addUserMessage(message)

        let hasReceivedResponse = false
        let didTimeout = false
        const timeoutId = setTimeout(() => {
            if (hasReceivedResponse) return

            didTimeout = true
            controller.abort()
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
                        dispatchMessages({
                            type: "append_assistant",
                            content: event.text,
                            phase: "thinking",
                            merge: true
                        })
                        break;
                    }
                    case "stream_text": {
                        dispatchMessages({
                            type: "append_assistant",
                            content: event.text,
                            phase: "final_answer",
                            merge: true
                        })
                        break
                    }
                    case "tool_use": {
                        dispatchMessages({
                            type: "append_assistant",
                            content: `${event.toolName} ${JSON.stringify(event.args)}`,
                            phase: "tool_call",
                            merge: false
                        })
                        break
                    }
                }
            }
        } catch (error) {
            if (!didTimeout && !isExitingRef.current) {
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
            }
        }
    }, [llmClient, workDir])

    return (
        <Box flexDirection="column">
            <MessageList messages={messages} />
            <PromptInput onSubmit={handleSubmit} />
        </Box>
    )
}

export default memo(Chat)
