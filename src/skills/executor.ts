import type { Skill, SkillHost, SkillForkHost } from "../types/skill.js";

/**
 * 以 inline 模式运行 skill：将 skill body 注入当前对话上下文。
 */
export function runInline(
  skill: Skill,
  args: string,
  host: SkillHost
): string {
  //拿到Skill的全部内容
  let body = skill.body;
  // 替换 body 中的 $ARGUMENTS 占位符；没有占位符时追加用户请求
  //如果内容主题包括$ARGUMENTS
  if (body.includes("$ARGUMENTS")) {
    // 替换 body 中的 $ARGUMENTS 占位符；没有占位符时追加用户请求
    body = body.replaceAll("$ARGUMENTS", args);
  } else if (args) {
    //没有的话，就直接返回这个Body的内容，并且把用户的参数加上
    body += `\n\nUser Request: ${args}`;
  }
  //host激活这个skill
  host.activateSkill(skill.meta.name, body);
  //返回skill的body内容
  return body;
}

/**
 * 以 fork 模式运行 skill：在隔离的子代理中执行。
 */
export async function runFork(
  skill: Skill,
  args: string,
  host: SkillForkHost
): Promise<string> {
  let prompt = skill.body;
  if (args) {
    prompt += `\n\nARGUMENTS: ${args}`;
  }

  // 根据 forkContext 配置决定携带多少父对话上下文
  const contextMode = skill.meta.forkContext ?? "none";
  if (contextMode === "recent") {
    const context = host.snapshotParentMessages(5);
    prompt = `Context from parent conversation:\n${context}\n\n${prompt}`;
  } else if (contextMode === "full") {
    const context = host.snapshotParentMessages(100);
    prompt = `Context from parent conversation:\n${context}\n\n${prompt}`;
  }

  return host.runSubAgent(prompt);
}
