import type { Skill } from "../types/skill.js";

/**
 * 加载内置 skill。
 * 当前版本不包含任何内置 skill，所有 skill 通过用户目录或项目目录加载。
 */
export function loadBuiltins(): Skill[] {
  return [];
}
