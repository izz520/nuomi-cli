import React, { useCallback, useEffect, useRef, useState } from "react";
import { randomUUID } from "node:crypto";
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
import { ReadToolResult } from "./tools/read-tool-result.js";
import { WriteFileTool } from "./tools/write-file.js";
import { EditFileTool } from "./tools/edit-file.js";
import { GlobTool } from "./tools/glob.js";
import { GrepTool } from "./tools/grep.js";
import { BashTool } from "./tools/bash.js";
import { ToolSearchTool } from "./tools/tool-search.js";
import { EditMemoryTool, ReadMemoryTool, WriteMemoryTool } from "./tools/memory.js";
import { SkillManager } from "./skills/manager.js";
import { LoadSkillTool } from "./tools/load-skill-tool.js";
import { SkillHost } from "./types/skill.js";
import { InstallSkillTool } from "./tools/install-skill-tool.js";
import { Command, CommandManager, createCommandManager } from "./commands/commands.js";
import { runInline } from "./skills/executor.js";
import { Skill } from "openai/resources";
import { HookManager, validateHooks } from "./hooks/hooks.js";
import { AgentTool, SubAgentRunRequest } from "./tools/agent-tool.js";
import { startSubAgent } from "./subAgent/spawn.js";
import {
    SubAgentTaskManager,
    type SubAgentTaskSnapshot,
} from "./subAgent/task-manager.js";
import { TaskOutputTool, TaskStopTool } from "./tools/subagent-task-tools.js";
import { TeamManager } from "./teams/team.js";
import { createTeamAgentSession } from "./teams/team-agent-session.js";
import {
    ListTeamsTool,
    SendMessageTool,
    TeamCreateTool,
    TeamDeleteTool,
} from "./teams/tools.js";

const workDir = process.cwd()
const config = loadConfig();
// console.log("🚀 ~ config:", config)
export default function App() {

    // console.log("🚀 ~ App ~ config:", config)
    const [llmClient, setLLMClient] = useState<AnthropicClient | OpenAIClient>();
    //当前使用的Provider
    const [selectProvider, setSelectProvider] = useState<ProviderConfig>(config.providers[1])
    const memManagerRef = useRef<MemoryManager | null>(null)
    const runtimeContextManagerRef = useRef<RuntimeContextManager | null>(null)
    const messageManagerRef = useRef<MessageManager | null>(null);
    const toolManagerRef = useRef<ToolsManger | null>(null);
    const recoveryManagerRef = useRef<RecoveryManager | null>(null)
    const activeSkillsRef = useRef(new Map<string, string>());
    const skillManagerRef = useRef<SkillManager | null>(null)
    const hookManagerRef = useRef<HookManager | null>(null)
    const cmdManagerRef = useRef(createCommandManager());
    const hookError = useRef<Error | null>(null);
    const subAgentTaskManagerRef = useRef<SubAgentTaskManager | null>(null);
    const teamManagerRef = useRef<TeamManager | null>(null);
    const notifiedTaskIdsRef = useRef(new Set<string>());
    const [subagents, setSubagents] = useState<SubAgentTaskSnapshot[]>([]);
    const skillHostRef = useRef<SkillHost>({
        activateSkill: (name, body) => activeSkillsRef.current.set(name, body),
    });
    const toolResultCompactMangerRef = useRef<ToolResultCompactStateManger | null>(null);
    const drainTeamNotifications = useCallback(
        () => teamManagerRef.current?.drainLeads() ?? [],
        [],
    );
    if (messageManagerRef.current === null) {
        messageManagerRef.current = new MessageManager();
    }
    if (memManagerRef.current === null) {
        memManagerRef.current = new MemoryManager(workDir);
    }
    if (runtimeContextManagerRef.current === null) {
        runtimeContextManagerRef.current = new RuntimeContextManager(workDir, memManagerRef.current);
    }
    if (subAgentTaskManagerRef.current === null) {
        subAgentTaskManagerRef.current = new SubAgentTaskManager();
    }
    if (teamManagerRef.current === null) {
        teamManagerRef.current = new TeamManager(workDir);
    }
    if (toolManagerRef.current === null) {
        toolManagerRef.current = createToolManager(
            memManagerRef.current,
            runtimeContextManagerRef.current,
            subAgentTaskManagerRef.current,
            teamManagerRef.current,
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
        //加载skills
        // 创建SKill管理器
        const skillManager = new SkillManager();
        // 把配置目录的skill全部加载进entries中
        skillManager.load(workDir);
        // 把当前skill的管理器存储起来
        skillManagerRef.current = skillManager;
        // console.log("🚀 ~ App ~ skillManager:", skillManager)
        writeSkillToCommand(skillManager, cmdManagerRef.current, skillHostRef.current);
        //将对象转变为string的系统提示词
        const systemPrompt = buildSystemPrompt(env, skillManager, workDir);
        const client = createClient({ provider: selectProvider, systemPrompt: systemPrompt })
        setLLMClient(client)
        // 注册加载SKill的Tool工具
        toolManagerRef.current?.register(new LoadSkillTool(skillManager, skillHostRef.current));
        toolManagerRef.current?.register(new InstallSkillTool(workDir, skillManager, () => {
            // 把新的Skill加入到cmd中
            writeSkillToCommand(skillManager, cmdManagerRef.current, skillHostRef.current);
            // 安装后刷新系统提示词
            const updatedPrompt = buildSystemPrompt(env, skillManager, workDir);
            client.setSystemPrompt(updatedPrompt);
        }));
        // 做hooks配置的参数校验
        const hookErr = validateHooks(config.hooks);
        hookError.current = hookErr
        hookManagerRef.current = new HookManager(config.hooks);
        // 注册Agent的工具
        const agentTool = new AgentTool(
            workDir,
            startSubAgenthandle,
            messageManagerRef.current!,
        );
        // 设置agent的team管理器
        agentTool.setTeamManager(teamManagerRef.current!, (
            subAgent,
            identity,
            modelOverride,
        ) => createTeamAgentSession({
            subAgent,
            identity,
            provider: selectProvider,
            parentToolManager: toolManagerRef.current!,
            teamManager: teamManagerRef.current!,
            workDir,
            modelOverride,
        }));
        // 工具管理器注册Agent工具
        toolManagerRef.current?.register(agentTool);
    }, [selectProvider, workDir])


    // 执行subAgent的函数
    const startSubAgenthandle = async (request: SubAgentRunRequest) => {
        const {
            description,
            prompt,
            background,
            modelOverride,
            abortSignal,
            onActivity,
        } = request;
        // fresh/fork 都使用 subagent_type 对应的文件配置，仅上下文来源不同。
        const subAgent = request.subAgent;
        const worktreeSlug = `${subAgent.name}-${randomUUID().slice(0, 8)}`;
        // 调用子Agent任务管理器的start函数创建任务
        const task = subAgentTaskManagerRef.current!.createTask({
            label: `${subAgent.name}: ${description}`,
            background,
            // 后台任务独立于当前主请求，只能通过 TaskStop 主动停止。
            parentSignal: background ? undefined : abortSignal,
            //真正启动子 Agent
            runTask: ({ signal, onProgress }) => startSubAgent({
                subAgent,
                contextMode: request.contextMode,
                parentMessages: request.contextMode === "fork"
                    ? request.parentMessages
                    : undefined,
                prompt,
                parentToolManager: toolManagerRef.current!,
                parentProvider: selectProvider,
                workDir,
                onProgress,
                modelOverride,
                abortSignal: signal,
                onActivity,
                background,
                worktreeSlug,
            }),
        });
        // 异步Agent的话，直接先返回一个信息给Agent
        if (background) {
            return (
                `Background sub-agent started. task_id: ${task.id}. ` +
                "Use TaskOutput to read the result or TaskStop to cancel it."
            );
        }
        // 同步任务
        try {
            //等待子Agent任务管理器完成task.id的任务
            const completed = await subAgentTaskManagerRef.current!.wait(task.id);
            if (!completed) throw new Error(`Sub-agent task '${task.id}' disappeared`);
            //如果任务状态是completed，则返回output
            if (completed.status === "completed") {
                return completed.output || "[No output]";
            }
            // 不然就报错
            throw new Error(completed.error || `Sub-agent task ${completed.status}`);
        } finally {
            // 最后子Agent任务管理器移除当前任务
            subAgentTaskManagerRef.current!.remove(task.id);
        }
    }

    // 写入skill到cmd里面
    function writeSkillToCommand(
        skillManager: SkillManager,
        cmdRegistry: CommandManager,
        skillHost: SkillHost
    ): void {
        // console.log("🚀 ~ writeSkillToCommand ~ skillManager:", skillManager)
        for (const meta of skillManager.list()) {
            // console.log("🚀 ~ writeSkillToCommand ~ meta:", meta)
            // Don't shadow existing built-in or user commands.
            if (cmdRegistry.find(meta.name)) continue;

            const skill = skillManager.get(meta.name);
            if (!skill) continue;

            const isFork = skill.meta.mode === "fork";

            const cmd: Command = {
                name: meta.name,
                aliases: [],
                type: isFork ? "skill_fork" : "prompt",
                description: `${meta.description} [skill]`,
                handler: isFork
                    ? () => ""   // fork dispatch handled in executeCommand before handler
                    : (ctx) => runInline(skill, ctx.args, skillHost),
            };
            // console.log("🚀 ~ writeSkillToCommand ~ cmd:", cmd)
            try {
                cmdRegistry.register(cmd);
            } catch {
                // name clash → keep the existing command
            }
        }
    }

    useEffect(() => {
        initClient()
    }, [selectProvider])

    useEffect(() => {
        return subAgentTaskManagerRef.current!.subscribe((tasks) => {
            setSubagents(tasks);
            for (const task of tasks) {
                if (
                    !task.background
                    || task.status === "running"
                    || notifiedTaskIdsRef.current.has(task.id)
                ) {
                    continue;
                }
                notifiedTaskIdsRef.current.add(task.id);
                messageManagerRef.current?.addSystemReminder(
                    `<task-notification task_id="${task.id}" status="${task.status}">\n` +
                    `Background sub-agent "${task.label}" is ${task.status}. ` +
                    `Call TaskOutput with task_id "${task.id}" to read its result.\n` +
                    "</task-notification>",
                );
            }
        });
    }, []);

    useEffect(() => {
        // 当组件卸载的时候，把所有team的成员移除
        return () => {
            const manager = teamManagerRef.current;
            if (!manager) return;
            void Promise.all(manager.list().map((team) => manager.delete(team.name)));
        };
    }, []);

    return (
        <Box flexDirection="column">
            <PlatformHeader provider={selectProvider} />
            <Chat
                llmClient={llmClient}
                changeProvider={setSelectProvider}
                workDir={workDir}
                sandboxConfig={config.sandbox}
                mcpServers={config.mcp_servers}
                commandManager={cmdManagerRef.current}
                contextWindow={selectProvider.context_window}
                messageManager={messageManagerRef.current}
                toolManager={toolManagerRef.current}
                recoveryManager={recoveryManagerRef.current}
                toolResultCompactManger={toolResultCompactMangerRef.current}
                runtimeContextManager={runtimeContextManagerRef.current}
                memoryManager={memManagerRef.current}
                selectedProvider={selectProvider}
                hookManager={hookManagerRef.current!}
                hookError={hookError.current}
                subagents={subagents}
                drainTeamNotifications={drainTeamNotifications}

            />
        </Box>
    );
}

const createToolManager = (
    memoryManager: MemoryManager,
    runtimeContextManager: RuntimeContextManager,
    subAgentTaskManager: SubAgentTaskManager,
    teamManager: TeamManager,
): ToolsManger => {
    // 创建工具管理器
    const manager = new ToolsManger();
    //添加常规读工具
    manager.register(new ReadFile());
    manager.register(new ReadToolResult());
    //添加常规写工具
    manager.register(new WriteFileTool());
    //添加常规编辑工具
    manager.register(new EditFileTool());
    //添加常规工具
    manager.register(new GlobTool());
    //添加常规工具
    manager.register(new GrepTool());
    //添加常规工具
    manager.register(new BashTool());
    //添加MCP搜索工具
    manager.register(new ToolSearchTool(manager));
    //添加缓存工具
    manager.register(new ReadMemoryTool(memoryManager));
    //添加写入缓存工具
    manager.register(new WriteMemoryTool(memoryManager, () => runtimeContextManager.invalidate()));
    //添加编辑缓存工具
    manager.register(new EditMemoryTool(memoryManager, () => runtimeContextManager.invalidate()));
    // 添加写入子Agent任务工具
    manager.register(new TaskOutputTool(subAgentTaskManager));
    //添加写入子Agent取消任务工具
    manager.register(new TaskStopTool(subAgentTaskManager));
    // Team members are spawned exclusively through Agent(team_name=...).
    // 添加创建Team的工具
    manager.register(new TeamCreateTool(teamManager));
    // 添加Team发送消息的工具
    manager.register(new SendMessageTool(teamManager));
    // 创建查看所有team的工具
    manager.register(new ListTeamsTool(teamManager));
    // 创建删除Team的工具
    manager.register(new TeamDeleteTool(teamManager));
    return manager;
};
