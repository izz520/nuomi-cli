import React, { memo, useCallback, useState } from 'react'
import { ProviderConfig } from '../types/provider.js'
import { Box } from 'ink'
import MessageList, { ChatMessage } from './MessageList.js'
import PromptInput from './PromptInput.js'
import AnthropicClient from '../client/anthorpic.js'
import OpenAIClient from '../client/openai.js'
import { Agent } from '../client/agent.js'
import { MessageManger } from '../messageManger/message.js'
import writeLog from '../utils/writeLog.js'
interface IChat {
    agent: Agent | undefined
    messageManget: MessageManger
    provider: ProviderConfig
    llmClient: AnthropicClient | OpenAIClient | undefined
    changeProvider: (provider: ProviderConfig) => void
}
const Chat = ({ agent, provider, llmClient, messageManget }: IChat) => {
    // writeLog("Chat - Agent", agent)
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const handleSubmit = useCallback(async (message: string) => {
        if (!agent) {
            return console.log("Agent Init Fail,Please Restart Nuomi Cli");
        }
        setMessages([{ role: "user", "content": message }])
        messageManget.addUserMessage(message)
        let isThinking = false;
        let isAnswer = false;
        const loopResult = agent.startLoop()
        for await (const event of loopResult) {
            switch (event.type) {
                case "thinking_text": {
                    setMessages(prev => {
                        const thinkingIndex = prev.findLastIndex(
                            item => item.role === "assistant" && item.phase === "thinking"
                        )

                        if (thinkingIndex === -1) {
                            return [...prev, {
                                role: "assistant",
                                content: event.text,
                                phase: "thinking"
                            }]
                        }

                        return prev.map((item, index) =>
                            index === thinkingIndex
                                ? { ...item, content: item.content + event.text }
                                : item
                        )
                    })
                    break
                }
                case "thinking_complete": {
                    setMessages(prev => {
                        const thinkingIndex = prev.findLastIndex(
                            item => item.role === "assistant" && item.phase === "thinking"
                        )

                        return prev.map((item, index) =>
                            index === thinkingIndex
                                ? { ...item, phase: undefined }
                                : item
                        )
                    })
                    break
                }
            }
        }
    }, [agent, messageManget])
    return (
        <Box flexDirection="column">
            <MessageList messages={messages} />
            <PromptInput onSubmit={handleSubmit} />
        </Box>
    )
}

export default memo(Chat)
