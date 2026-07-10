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
import { Agent } from "./client/agent.js";
import { RegisterTools } from "./tools/register.js";
import { ReadFile } from "./tools/read-file.js";
import { MessageManger } from "./messageManger/message.js";
import writeLog from "./utils/writeLog.js";


export default function App() {
    const config = loadConfig();
    const [llmClient, setLLMClient] = useState<AnthropicClient | OpenAIClient>();
    const { exit } = useApp();
    const toolMangerRuf = useRef(new RegisterTools())
    const messageMangerRuf = useRef(new MessageManger())
    const [agent, setAgent] = useState<Agent>()
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


    const initAgent = useCallback(async () => {
        writeLog("Start Init Agent");
        //2.添加支持的工具
        toolMangerRuf.current.register(new ReadFile())
        writeLog("Tool Manger", toolMangerRuf.current);
        writeLog("Message Manger", messageMangerRuf.current);
        //3.创建Agent
        const agent = new Agent(selectProvider, messageMangerRuf.current, toolMangerRuf.current)
        setAgent(agent)
        writeLog("Agent", agent);
    }, [selectProvider]);

    useEffect(() => {
        initAgent();
    }, []);

    return (
        <Box flexDirection="column">
            <PlatformHeader provider={selectProvider} />
            <Chat
                agent={agent}
                messageManget={messageMangerRuf.current}
                provider={selectProvider}
                llmClient={llmClient}
                changeProvider={setSelectProvider}
            />
        </Box>
    );
}
