import type { Tool, ToolContext, ToolResult } from "../types/tools.js";
import type {
  SubAgentTaskManager,
  SubAgentTaskSnapshot,
} from "../subAgent/task-manager.js";
import { boolArg, intArg, strArg } from "./utils.js";

const MAX_WAIT_SECONDS = 110;

function formatTask(task: SubAgentTaskSnapshot): string {
  const progress = [
    `turn=${task.turn}`,
    task.lastTool ? `last_tool=${task.lastTool}` : "",
  ].filter(Boolean).join(", ");

  if (task.status === "running") {
    return `Task ${task.id} is still running (${progress}).`;
  }
  if (task.status === "completed") {
    return `Task ${task.id} completed.\n\n${task.output || "[No output]"}`;
  }
  if (task.status === "cancelled") {
    return `Task ${task.id} was cancelled: ${task.error || "Task cancelled"}`;
  }
  return `Task ${task.id} failed: ${task.error || "Unknown error"}`;
}

export class TaskOutputTool implements Tool {
  name = "TaskOutput";
  description =
    "Get the status or result of a background sub-agent task. " +
    "Set block=true to wait briefly for a running task.";
  category = "read" as const;
  system = true;

  constructor(private taskManager: SubAgentTaskManager) {}

  schema(): Record<string, unknown> {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Background task ID returned by Agent" },
          block: {
            type: "boolean",
            description: "Wait for completion up to timeout seconds",
            default: false,
          },
          timeout: {
            type: "integer",
            description: `Wait timeout in seconds (max ${MAX_WAIT_SECONDS})`,
            default: 30,
          },
          clear: {
            type: "boolean",
            description: "Remove a completed task after reading its result",
            default: true,
          },
        },
        required: ["task_id"],
      },
    };
  }

  async execute(args: Record<string, unknown>, _ctx?: ToolContext): Promise<ToolResult> {
    const taskId = strArg(args, "task_id").trim();
    if (!taskId) return { output: "Error: task_id is required", isError: true };

    const block = boolArg(args, "block");
    const timeoutSeconds = Math.min(
      MAX_WAIT_SECONDS,
      Math.max(0, intArg(args, "timeout", 30)),
    );
    const task = block
      ? await this.taskManager.wait(taskId, timeoutSeconds * 1000)
      : this.taskManager.get(taskId);

    if (!task) {
      return { output: `Error: task '${taskId}' not found`, isError: true };
    }

    const terminal = task.status !== "running";
    const result = {
      output: formatTask(task),
      isError: task.status === "failed" || task.status === "cancelled",
    };
    if (terminal && boolArg(args, "clear", true)) {
      this.taskManager.remove(taskId);
    }
    return result;
  }
}

export class TaskStopTool implements Tool {
  name = "TaskStop";
  description = "Stop a running background sub-agent task.";
  category = "read" as const;
  system = true;

  constructor(private taskManager: SubAgentTaskManager) {}

  schema(): Record<string, unknown> {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Background task ID returned by Agent" },
        },
        required: ["task_id"],
      },
    };
  }

  async execute(args: Record<string, unknown>, _ctx?: ToolContext): Promise<ToolResult> {
    const taskId = strArg(args, "task_id").trim();
    if (!taskId) return { output: "Error: task_id is required", isError: true };

    const before = this.taskManager.get(taskId);
    if (!before) {
      return { output: `Error: task '${taskId}' not found`, isError: true };
    }
    if (before.status !== "running") {
      return {
        output: `Task ${taskId} is already ${before.status}.`,
        isError: false,
      };
    }

    this.taskManager.stop(taskId);
    return { output: `Task ${taskId} stopped.`, isError: false };
  }
}
