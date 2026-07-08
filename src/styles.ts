// 来源：公众号@小林coding
// 后端八股网站：xiaolincoding.com
// Agent网站：xiaolinnote.com
// 简历模版：jianli.xiaolinnote.com

import chalk from "chalk";

export const brand = {
  primary: chalk.hex("#009697"),
  dim: chalk.dim,
  bright: chalk.bold.white,
  error: chalk.bold.red,
  success: chalk.green,
  warning: chalk.yellow,
  muted: chalk.gray,
  tool: chalk.cyan,
  thinking: chalk.hex("#009697"),
  user: chalk.bold.blue,
  assistant: chalk.bold.hex("#a78bfa"),
};

export const symbols = {
  prompt: "❯",
  thinking: "◆",
  tool: "▶",
  success: "✓",
  error: "✗",
  arrow: "→",
  dot: "·",
  circle: "⏺",
};

export const commandIcons: Record<string, string> = {
  local: "⚙",
  local_ui: "⚙",
  skill_fork: "★",
  prompt: "◇",
};

export const borderColors: Record<string, string> = {
  idle: "gray",
  focused: "gray",
  agent: "#a855f6",
  error: "red",
};
