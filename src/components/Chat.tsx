import React, { memo, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { ProviderConfig } from '../types/provider.js'
import { Box } from 'ink'
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

type MessageAction =
    | { type: "append_user"; content: string }
    | { type: "append_assistant"; content: string; phase: MessagePhase; merge: boolean };

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
    // writeLog("Chat - Agent", agent)
    const [agent, setAgent] = useState<Agent>()
    const messageMangerRuf = useRef(new MessageManger())
    const toolMangerRuf = useRef(new ToolsManger())
    const [messages, dispatchMessages] = useReducer(messagesReducer, [])

    const handleSubmit = useCallback(async (message: string) => {
        if (!agent) {
            return console.log("Agent Init Fail,Please Restart Nuomi Cli");
        }
        dispatchMessages({ type: "append_user", content: message })
        messageMangerRuf.current.addUserMessage(message)
        const loopResult = agent.startLoop()
        for await (const event of loopResult) {
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
    }, [agent])

    const initAgent = useCallback(() => {
        toolMangerRuf.current.register(new ReadFile())
        if (llmClient) {
            const agent = new Agent(llmClient, messageMangerRuf.current, toolMangerRuf.current, workDir)
            setAgent(agent)
        }
    }, [llmClient, workDir])

    useEffect(() => {
        initAgent()
    }, [initAgent])
    return (
        <Box flexDirection="column">
            <MessageList messages={messages} />
            <PromptInput onSubmit={handleSubmit} />
        </Box>
    )
}

export default memo(Chat)
