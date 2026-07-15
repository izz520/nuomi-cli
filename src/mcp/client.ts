import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { MCPServerConfig } from "../types/provider.js";

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

type AnyTransport =
  | StdioClientTransport
  | StreamableHTTPClientTransport
  | SSEClientTransport;

// Expand ${VAR} / $VAR references in config values from the environment so
// secrets (API keys etc.) can live in env vars rather than the config file.
function expandEnv(value: string): string {
  return value.replace(/\$\{(\w+)\}|\$(\w+)/g, (_, a, b) => process.env[a ?? b] ?? "");
}

export class MCPClient {
  //名字
  name: string;
  //用户的MCP的配置
  private config: MCPServerConfig;
  // client
  private client: Client | null = null;
  // 通讯方式
  private transport: AnyTransport | null = null;

  constructor(config: MCPServerConfig) {
    //存储名字
    this.name = config.name;
    //存储MCP配置
    this.config = config;
  }

  //连接MCP
  async connect(): Promise<void> {
    // 如果配置存在command字段，则走Stdio管道
    if (this.config.command) {
      // stdio transport
      //拿到系统环境变量
      const env: Record<string, string> = { ...(process.env as Record<string, string>) };
      if (this.config.env) {
        //把配置文件的环境变量转换成二维数组，然后循环二维数组，去Key和Value，然后把拷贝的env系统环境变量的$${AUTHTOKEN}替换或者添加为真实的值
        for (const [k, v] of Object.entries(this.config.env)) env[k] = expandEnv(v);
      }
      //创建Stdio管道
      this.transport = new StdioClientTransport({
        //command的命令
        command: this.config.command,
        //参数
        args: this.config.args ?? [],
        //环境变量
        env,
        stderr: "ignore",
      });
    } else if (this.config.url) {
      //如果存在http，则走StreamableHTTP或者SSE
      // http / sse transport
      //构建URL
      const url = new URL(this.config.url);
      //构建请求头
      const headers: Record<string, string> = {};
      if (this.config.headers) {
        //如果配置里面的headers有值，则把值添加到headers里面
        for (const [k, v] of Object.entries(this.config.headers)) headers[k] = expandEnv(v);
      }
      //这个应该是固定请求头格式
      const opts = { requestInit: { headers } };
      this.transport =
        this.config.transport === "sse"
          ? new SSEClientTransport(url, opts)
          : new StreamableHTTPClientTransport(url, opts);
    } else {
      throw new Error(
        `MCP server '${this.name}': needs either 'command' (stdio) or 'url' (http/sse)`
      );
    }
    //新建一个MCP Client
    this.client = new Client({ name: "mewcode", version: "0.1.0" }, {});
    // 等待client与MCP Server连接
    await this.client.connect(this.transport);
  }

  // The server's instructions from the initialize result, if any.
  getInstructions(): string {
    return this.client?.getInstructions() ?? "";
  }

  //获取全部工具列表
  async listTools(): Promise<MCPTool[]> {
    if (!this.client) throw new Error("Not connected");
    //从客户端调用listTools获取工具列表
    const result = await this.client.listTools();
    return (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));
  }

  //调用工具
  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<string> {
    if (!this.client) throw new Error("Not connected");
    //直接调用MCP的callTool
    const result = await this.client.callTool({ name, arguments: args });
    if (result.content && Array.isArray(result.content)) {
      return result.content
        .map((c: { type: string; text?: string }) =>
          c.type === "text" ? c.text ?? "" : JSON.stringify(c)
        )
        .join("\n");
    }
    return JSON.stringify(result);
  }

  async disconnect(): Promise<void> {
    try {
      await this.client?.close();
    } catch {
      // ignore
    }
    this.client = null;
    this.transport = null;
  }
}
