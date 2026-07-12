// 来源：公众号@小林coding
// 后端八股网站：xiaolincoding.com
// Agent网站：xiaolinnote.com
// 简历模版：jianli.xiaolinnote.com

import type { ToolsManger } from "../tools/register.js";
import type { ToolResult, ToolContext } from "../types/tools.js";

interface PendingCall {
  toolId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

interface ExecutionResult {
  toolId: string;
  toolName: string;
  result: ToolResult;
  elapsed: number;
}

export class ToolExecutManger {
  private pendingTask: PendingCall[] = [];
  private toolManger: ToolsManger;
  private ctx: ToolContext;

  constructor(toolManger: ToolsManger, ctx: ToolContext) {
    this.toolManger = toolManger;
    this.ctx = ctx;
  }
  //把当前的工具调用放进等待池
  submit(toolId: string, toolName: string, args: Record<string, unknown>): void {

    this.pendingTask.push({ toolId, toolName, arguments: args });
  }
  //执行等待池的工具调用
  async collectResults(): Promise<ExecutionResult[]> {
    const calls = [...this.pendingTask];
    this.pendingTask = [];

    const promises = calls.map(async (call) => {
      //从工具管理器中获取工具
      const tool = this.toolManger.get(call.toolName);
      //获取当前的时间
      const start = Date.now();
      if (!tool) {
        //工具不存在，则直接返回错误
        return {
          toolId: call.toolId,
          toolName: call.toolName,
          result: {
            output: `Error: unknown tool '${call.toolName}'`,
            isError: true,
          },
          elapsed: 0,
        };
      }

      try {
        //执行工具
        const result = await tool.execute(call.arguments, this.ctx);
        //返回结果
        return {
          toolId: call.toolId,
          toolName: call.toolName,
          result,
          elapsed: (Date.now() - start) / 1000,
        };
      } catch (err) {
        return {
          toolId: call.toolId,
          toolName: call.toolName,
          result: {
            output: `Error executing ${call.toolName}: ${(err as Error).message}`,
            isError: true,
          },
          elapsed: (Date.now() - start) / 1000,
        };
      }
    });
    //等待全部调用再返回
    return Promise.all(promises);
  }

  hasPending(): boolean {
    return this.pendingTask.length > 0;
  }
}
