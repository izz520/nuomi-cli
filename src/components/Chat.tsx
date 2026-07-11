import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
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
interface IChat {
    llmClient: AnthropicClient | OpenAIClient | undefined
    workDir: string
    changeProvider: (provider: ProviderConfig) => void
}
const Chat = ({ llmClient, workDir }: IChat) => {
    // writeLog("Chat - Agent", agent)
    const [agent, setAgent] = useState<Agent>()
    const messageMangerRuf = useRef(new MessageManger())
    const toolMangerRuf = useRef(new ToolsManger())
    const [messages, setMessages] = useState<ChatMessage[]>([])

    const handleSubmit = useCallback(async (message: string) => {
        if (!agent) {
            return console.log("Agent Init Fail,Please Restart Nuomi Cli");
        }
        setMessages(prve => [...prve, { role: "user", "content": message }])
        messageMangerRuf.current.addUserMessage(message)
        let isThinking = false;
        let isAnswer = false;
        const loopResult = agent.startLoop()
        for await (const event of loopResult) {
            switch (event.type) {
                case "thinking_text": {
                    appendAssistantMessage(event.text, "thinking")
                    break;
                }
                case "stream_text": {
                    appendAssistantMessage(event.text, "final_answer")
                    break
                }
                case "tool_use": {
                    appendAssistantMessage(`${event.toolName} ${JSON.stringify(event.args)}`, "tool_call")
                }
            }
        }
    }, [agent, messages, setMessages])

    const appendAssistantMessage = (content: string, phase: MessagePhase) => {
        setMessages(prev => {
            const lastMessage = prev[prev.length - 1]
            if (lastMessage.phase === phase) {
                lastMessage.content += content
                prev[prev.length - 1] = lastMessage
                return prev
            }

            return [...prev, {
                role: "assistant",
                content: content,
                phase: phase
            }]
        })


    }

    const initAgent = useCallback(() => {
        if (llmClient) {
            const agent = new Agent(llmClient, messageMangerRuf.current, toolMangerRuf.current, workDir)
            setAgent(agent)
        }
    }, [llmClient])

    useEffect(() => {
        initAgent()
    }, [llmClient])
    return (
        <Box flexDirection="column">
            <MessageList messages={messages} />
            <PromptInput onSubmit={handleSubmit} />
        </Box>
    )
}

export default memo(Chat)
