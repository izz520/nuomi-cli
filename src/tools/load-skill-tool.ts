import type { Tool, ToolResult } from "../types/tools.js";
import { strArg } from "../tools/utils.js";
import type { SkillManager } from "../skills/manager.js";
import type { SkillHost } from "../types/skill.js"
import { runInline } from "../skills/executor.js";

// On-demand skill activation: returns the full SOP body so it enters the
// conversation as a regular message (progressive disclosure). Mirrors Go.
/**
 * 加载Skill，首先在系统提示词中有Skill的全部简介，但是并不是完整的SKill
 * 然后Agent会通过这个Tool来加载单个完整的SKill
 */
export class LoadSkillTool implements Tool {
  name = "LoadSkill";
  description =
    "Activate a skill by name. Returns the full SOP body so you can follow its instructions. Use this when a task matches an available skill's description.";
  category = "read" as const;
  system = true;

  constructor(
    private skillManager: SkillManager,
    private host: SkillHost
  ) { }

  schema(): Record<string, unknown> {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name of the skill to activate" },
        },
        required: ["name"],
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    // 从参数中拿到SKil的name
    const name = strArg(args, "name");
    // 在Skill管理器中查询这个name的skill
    const skill = this.skillManager.get(name);
    if (!skill) {
      // skill不存在，则返回没有找到，并且返回当前有哪些skill
      const available = this.skillManager.list().map((s) => s.name).join(", ") || "(none)";
      return { output: `Skill '${name}' not found. Available skills: ${available}`, isError: true };
    }
    // 找到了，则按照inLine模式加载Skil拿到body
    const body = runInline(skill, "", this.host);
    // 最后返回Skill的全部内容给Agent
    return { output: `Skill '${name}' activated.\n\n${body}`, isError: false };
  }
}
