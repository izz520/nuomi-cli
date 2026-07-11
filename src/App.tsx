import React, { useCallback, useEffect, useState } from "react";
import { Box } from "ink";
import PlatformHeader from "./components/PlatformHeader.js";
import createClient from "./client/create.js";
import AnthropicClient from "./client/anthorpic.js";
import OpenAIClient from "./client/openai.js";
import { loadConfig } from "./config.js";
import { ProviderConfig } from "./types/provider.js";
import Chat from "./components/Chat.js";
import { buildSystemPrompt, detectEnvironment } from "./prompt/builder.js";


export default function App() {
    const config = loadConfig();
    const [llmClient, setLLMClient] = useState<AnthropicClient | OpenAIClient>();
    //当前使用的Provider
    const [selectProvider, setSelectProvider] = useState<ProviderConfig>(config.providers[1])

    const initClient = useCallback(() => {
        const workDir = process.cwd();
        //读取系统信息和git仓库信息
        const env = detectEnvironment(workDir);
        // console.log("🚀 ~ createClient ~ env:", env)
        //设置env的model为provider的model
        env.model = selectProvider.model;
        //将对象转变为string的系统提示词
        const systemPrompt = buildSystemPrompt(env);
        const client = createClient({ provider: selectProvider, systemPrompt: systemPrompt })
        setLLMClient(client)
    }, [selectProvider])

    useEffect(() => {
        initClient()
    }, [selectProvider])

    return (
        <Box flexDirection="column">
            <PlatformHeader provider={selectProvider} />
            <Chat
                llmClient={llmClient}
                changeProvider={setSelectProvider}
            />
        </Box>
    );
}
