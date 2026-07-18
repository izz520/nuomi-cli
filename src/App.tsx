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
import { MemoryManager } from "./memory/manager.js";
import { RuntimeContextManager } from "./context/runtime-context.js";
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
import { EditMemoryTool, ReadMemoryTool, WriteMemoryTool } from "./tools/memory.js";

const workDir = process.cwd()
const config = loadConfig();
export default function App() {

    // console.log("🚀 ~ App ~ config:", config)
    const [llmClient, setLLMClient] = useState<AnthropicClient | OpenAIClient>();
    //当前使用的Provider
    const [selectProvider, setSelectProvider] = useState<ProviderConfig>(config.providers[0])
    const [permMode, setPermMode] = useState<PermissionMode>("default")
    const memManagerRef = useRef<MemoryManager | null>(null)
    const runtimeContextManagerRef = useRef<RuntimeContextManager | null>(null)
    const messageManagerRef = useRef<MessageManager | null>(null);
    const toolManagerRef = useRef<ToolsManger | null>(null);
    const recoveryManagerRef = useRef<RecoveryManager | null>(null)
    const toolResultCompactMangerRef = useRef<ToolResultCompactStateManger | null>(null);
    if (messageManagerRef.current === null) {
        messageManagerRef.current = new MessageManager();
    }
    if (memManagerRef.current === null) {
        memManagerRef.current = new MemoryManager(workDir);
    }
    if (runtimeContextManagerRef.current === null) {
        runtimeContextManagerRef.current = new RuntimeContextManager(workDir, memManagerRef.current);
    }
    if (toolManagerRef.current === null) {
        toolManagerRef.current = createToolManager(
            memManagerRef.current,
            runtimeContextManagerRef.current,
        );
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
                runtimeContextManager={runtimeContextManagerRef.current}
                memoryManager={memManagerRef.current}
            />
        </Box>
    );
}

const createToolManager = (
    memoryManager: MemoryManager,
    runtimeContextManager: RuntimeContextManager,
): ToolsManger => {
    const manager = new ToolsManger();
    manager.register(new ReadFile());
    manager.register(new WriteFileTool());
    manager.register(new EditFileTool());
    manager.register(new GlobTool());
    manager.register(new GrepTool());
    manager.register(new BashTool());
    manager.register(new ToolSearchTool(manager));
    manager.register(new ReadMemoryTool(memoryManager));
    manager.register(new WriteMemoryTool(memoryManager, () => runtimeContextManager.invalidate()));
    manager.register(new EditMemoryTool(memoryManager, () => runtimeContextManager.invalidate()));
    return manager;
};
