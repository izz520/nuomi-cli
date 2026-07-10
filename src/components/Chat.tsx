import React, { memo, useCallback, useState } from 'react'
import { ProviderConfig } from '../types/provider.js'
import { Box } from 'ink'
import MessageList from './MessageList.js'
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
    writeLog("Chat - Agent", agent)
    const [messages, setMessages] = useState([])
    const handleSubmit = useCallback((message: string) => {
        if (!agent) {
            return console.log("Agent Init Fail,Please Restart Nuomi Cli");
        }
        messageManget.addUserMessage(message)
        agent.start()
    }, [agent, messageManget])
    return (
        <Box>
            <MessageList messages={messages} />
            <PromptInput onSubmit={handleSubmit} />
        </Box>
    )
}

export default memo(Chat)