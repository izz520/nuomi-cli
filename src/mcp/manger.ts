import type { MCPServerConfig } from "../types/provider.js";
import { MCPClient } from "./client.js";
import type { MCPTool } from "./client.js";

export interface ConnectResult {
    tools: { serverName: string; tool: MCPTool }[];
    servers: string[];
    errors: { serverName: string; error: string }[];
    instructions: { serverName: string; text: string }[];
}

//MCP管理器
export class MCPManager {
    private clients = new Map<string, MCPClient>();

    //连接所有MCP
    async connectAll(configs: MCPServerConfig[]): Promise<ConnectResult> {
        //连接结果
        const result: ConnectResult = { tools: [], servers: [], errors: [], instructions: [] };
        //循环用户配置中的全部MCP
        for (const cfg of configs) {
            //创建一个MCP CLient
            const client = new MCPClient(cfg);
            try {
                //连接MCP Server
                await client.connect();
                //把当前MCP存储进clients的Map中
                this.clients.set(cfg.name, client);
                //把server里面添加这个MCP
                result.servers.push(cfg.name);
                //获取这个MCP的所有工具
                const tools = await client.listTools();
                for (const tool of tools) {
                    //循环把当前MCP的工具添加进Tools
                    result.tools.push({ serverName: cfg.name, tool });
                }
                //尝试获取说明
                const instructions = client.getInstructions();
                if (instructions) {
                    //如果有说明的话，就把说明也存储进去
                    result.instructions.push({ serverName: cfg.name, text: instructions });
                }
            } catch (err) {
                //出错的叭，也同样加进去，只是存进错误
                result.errors.push({
                    serverName: cfg.name,
                    error: (err as Error).message,
                });
            }
        }
        //返回全部结果
        return result;
    }

    getClient(name: string): MCPClient | undefined {
        //根据名字获取MCP的client
        return this.clients.get(name);
    }

    async disconnectAll(): Promise<void> {
        for (const client of this.clients.values()) {
            //循环断开所有的MCP
            await client.disconnect();
        }
        //清楚当前存储的MCP Client
        this.clients.clear();
    }
}
