import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box } from "ink";
import PlatformHeader from "./components/PlatformHeader.js";
import createClient from "./client/create.js";
import AnthropicClient from "./client/anthorpic.js";
import OpenAIClient from "./client/openai.js";
import { loadConfig } from "./config.js";
import { ProviderConfig } from "./types/provider.js";
import Chat from "./components/Chat.js";
import { buildSystemPrompt, detectEnvironment } from "./prompt/builder.js";
import { PermissionMode } from "./premisson/checker.js";
import { loadInstructions } from "./memory/instructions.js";
import { MemoryManager } from "./memory/manager.js";
import { MessageManager } from "./messageManager/message.js";
import { ToolsManger } from "./tools/register.js";
import { RecoveryManager } from "./compact/recovery.js";
import { ToolResultCompactStateManger } from "./compact/state.js";
import { ReadFile } from "./tools/read-file.js";
import { WriteFileTool } from "./tools/write-file.js";
import { EditFileTool } from "./tools/edit-file.js";
import { GlobTool } from "./tools/glob.js";
import { GrepTool } from "./tools/grep.js";
import { BashTool } from "./tools/bash.js";
import { ToolSearchTool } from "./tools/tool-search.js";

const workDir = process.cwd()
const config = loadConfig();
export default function App() {

    // console.log("🚀 ~ App ~ config:", config)
    const [llmClient, setLLMClient] = useState<AnthropicClient | OpenAIClient>();
    //当前使用的Provider
    const [selectProvider, setSelectProvider] = useState<ProviderConfig>(config.providers[0])
    const [permMode, setPermMode] = useState<PermissionMode>("default")
    const memManagerRef = useRef<MemoryManager | undefined>(undefined)
    const messageManagerRef = useRef<MessageManager | null>(null);
    const toolManagerRef = useRef<ToolsManger | null>(null);
    const recoveryManagerRef = useRef<RecoveryManager | null>(null)
    const toolResultCompactMangerRef = useRef<ToolResultCompactStateManger | null>(null);
    if (messageManagerRef.current === null) {
        messageManagerRef.current = new MessageManager();
    }
    if (toolManagerRef.current === null) {
        toolManagerRef.current = createToolManager();
    }
    if (toolResultCompactMangerRef.current === null) {
        toolResultCompactMangerRef.current = new ToolResultCompactStateManger()
    }
    if (recoveryManagerRef.current === null) {
        recoveryManagerRef.current = new RecoveryManager()
    }
    const initClient = useCallback(() => {
        //读取系统信息和git仓库信息
        const env = detectEnvironment(workDir);
        // console.log("🚀 ~ createClient ~ env:", env)
        //设置env的model为provider的model
        env.model = selectProvider.model;
        //将对象转变为string的系统提示词
        const systemPrompt = buildSystemPrompt(env);
        // 读取AGENTS.md或者NUOMI.md这类的文件
        const instructions = loadInstructions(workDir);
        //创建 MemoryManager
        const memMgr = new MemoryManager(workDir);
        memManagerRef.current = memMgr;
        //扫描记忆prompt
        const memReminder = memMgr.buildSystemReminder();
        // console.log("🚀 ~ App ~ instructions:", instructions)
        messageManagerRef.current?.injectLongTermMemory(instructions, memReminder)
        const client = createClient({ provider: selectProvider, systemPrompt: systemPrompt })
        setLLMClient(client)
    }, [selectProvider, workDir])

    useEffect(() => {
        initClient()
    }, [selectProvider])

    return (
        <Box flexDirection="column">
            <PlatformHeader provider={selectProvider} />
            <Chat
                llmClient={llmClient}
                changeProvider={setSelectProvider}
                workDir={workDir}
                permMode={permMode}
                sandboxConfig={config.sandbox}
                mcpServers={config.mcp_servers}
                contextWindow={selectProvider.context_window}
                messageManager={messageManagerRef.current}
                toolManager={toolManagerRef.current}
                recoveryManager={recoveryManagerRef.current}
                toolResultCompactManger={toolResultCompactMangerRef.current}
            />
        </Box>
    );
}

const createToolManager = (): ToolsManger => {
    const manager = new ToolsManger();
    manager.register(new ReadFile());
    manager.register(new WriteFileTool());
    manager.register(new EditFileTool());
    manager.register(new GlobTool());
    manager.register(new GrepTool());
    manager.register(new BashTool());
    manager.register(new ToolSearchTool(manager));
    return manager;
};
