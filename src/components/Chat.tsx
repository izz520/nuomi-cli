import React, { memo, useCallback, useState } from 'react'
import { ProviderConfig } from '../types/provider.js'
import { Box } from 'ink'
import MessageList from './MessageList.js'
import PromptInput from './PromptInput.js'
import AnthropicClient from '../client/anthorpic.js'
import OpenAIClient from '../client/openai.js'
interface IChat {
    provider: ProviderConfig
    llmClient: AnthropicClient | OpenAIClient | undefined
    changeProvider: (provider: ProviderConfig) => void
}
const Chat = ({ provider, llmClient }: IChat) => {
    const [messages, setMessages] = useState([])
    const handleSubmit = useCallback(() => {
        //首先，创建一个自定义消息

        llmClient?.sendMessageStream
    }, [])
    return (
        <Box>
            <MessageList messages={messages} />
            <PromptInput onSubmit={handleSubmit} />
        </Box>
    )
}

export default memo(Chat)