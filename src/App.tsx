import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, useApp } from "ink";
import PromptInput from "./components/PromptInput.js";
import PlatformHeader from "./components/PlatformHeader.js";
import createClient from "./client/create.js";
import AnthropicClient from "./client/anthorpic.js";
import OpenAIClient from "./client/openai.js";
import { loadConfig } from "./config.js";
import MessageList, { Message } from "./components/MessageList.js";
import type { StreamEvent } from "./types/llm.js";
import { ProviderConfig } from "./types/provider.js";
import Chat from "./components/Chat.js";


export default function App() {
    const config = loadConfig();
    const [llmClient, setLLMClient] = useState<AnthropicClient | OpenAIClient>();
    const { exit } = useApp();
    const [messages, setMessages] = useState<Message[]>([]);
    //当前使用的Provider
    const [selectProvider, setSelectProvider] = useState<ProviderConfig>(config.providers[1])

    const handleSystemTools = useCallback((prompt: string) => {
        if (prompt === "q" || prompt === "/exit") {
            exit();
            return true;
        }

        if (prompt === "/clear") {
            setMessages([]);
            return true;
        }

        if (prompt === "/help") {
            setMessages(previous => [
                ...previous,
                { role: "user", content: prompt },
                { role: "assistant", content: "Commands: /help, /clear, /exit, q" }
            ]);
            return true;
        }

        return false;
    }, [exit])


    const createLLMClient = useCallback(async () => {
        try {
            const client = createClient({ provider: selectProvider });
            // console.log("🚀 ~ App ~ client:", client)
            setLLMClient(client)
            // You can use the client here for further operations
        } catch (error) {
            console.error(error);
        }
    }, [selectProvider]);

    useEffect(() => {
        createLLMClient();
    }, []);

    return (
        <Box flexDirection="column">
            <PlatformHeader provider={selectProvider} />
            <Chat
                provider={selectProvider}
                llmClient={llmClient}
                changeProvider={setSelectProvider}
            />
        </Box>
    );
}
