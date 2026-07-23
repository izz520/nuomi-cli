// 来源：公众号@小林coding
// 后端八股网站：xiaolincoding.com
// Agent网站：xiaolinnote.com
// 简历模版：jianli.xiaolinnote.com

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { load } from "js-yaml";
import type { Command } from "./commands.js";

// Loads user-defined slash commands from .mewcode/commands/*.md (user then
// project, so project wins on a name collision). Subdirectories namespace the
// command name: sub/dir/foo.md → "sub:dir:foo". Mirrors Go LoadUserCommands.
export function loadUserCommands(workDir: string): Command[] {
  const byName = new Map<string, Command>();
  // 拿到两个配置的地址
  const bases = [
    join(homedir(), ".nuomi", "commands"),
    join(workDir, ".nuomi", "commands"),
  ];
  // 循环这两个配置地址
  for (const base of bases) {
    // 如果不存在，就直接跳过
    if (!existsSync(base)) continue;
    // 存在的话，先walkDir拿到配置路径下的cmd全部对象，然后再循环把cmd设置进入byName
    for (const cmd of walkDir(base, base)) byName.set(cmd.name, cmd);
  }
  //最后把两个路径的cmd对象返回
  return [...byName.values()];
}

function walkDir(base: string, dir: string): Command[] {
  let entries: string[];
  try {
    //拿到dir目录下的全部文件名
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: Command[] = [];
  //循环文件名
  for (const entry of entries) {
    // 拿到完整路径
    const full = join(dir, entry);
    let st;
    try {
      //读取文件信息
      st = statSync(full);
    } catch {
      continue;
    }
    //如果是一个文件夹
    if (st.isDirectory()) {
      // 递归调用
      out.push(...walkDir(base, full));
    } else if (entry.endsWith(".md")) {
      //如果是每一个md的文件，则解析成一个cmd指令对象
      const cmd = parseCommandFile(base, full);
      //如果cmd对象存在，则把他添加到out中
      if (cmd) out.push(cmd);
    }
  }
  //最后返回全部cmd对象
  return out;
}

//解析文件，更像是在解析skill
function parseCommandFile(base: string, full: string): Command | null {
  let raw: string;
  try {
    // 读取文件
    raw = readFileSync(full, "utf-8");
  } catch {
    return null;
  }

  let description = "";
  let argumentHint = "";
  let aliases: string[] = [];
  let body = raw;

  if (raw.startsWith("---")) {
    //除掉开头的---，找到下一个---
    const end = raw.indexOf("---", 3);
    // 如果下一个---存在
    if (end !== -1) {
      // 截取从开头的---开始到下一个---之前的内容
      const frontmatter = raw.slice(3, end).trim();
      // body是下一个---开始再加上---本身的三个字符开始
      body = raw.slice(end + 3).trim();
      try {
        //通过yarml的形式读取frontmatter，转化成key value的形式
        const p = load(frontmatter) as Record<string, unknown> | null;
        //从p中拿到description
        description = (p?.description as string) ?? "";
        //从p中拿到argumentHint
        argumentHint = (p?.["argument-hint"] as string) ?? "";
        //从p中拿到aliases
        aliases = (p?.aliases as string[]) ?? [];
      } catch {
        // ignore frontmatter parse errors; treat whole file as body
      }
    }
  }
  //拿到根据文件名转换的名字
  //如"/project/.mewcode/commands/Git Tools/Sync Repo.md"变成git-tools:sync-repo
  const name = commandName(base, full);
  //如果名字不存在，则返回空
  if (!name) return null;

  return {
    name,
    aliases: Array.isArray(aliases) ? aliases : [],
    type: "prompt",
    description: description || (argumentHint ? `custom command (args: ${argumentHint})` : "custom command"),
    handler: (ctx) => renderBody(body, ctx.args),
  };
}

//将文件路径换成名字
function commandName(base: string, full: string): string {
  //把full = "/project/.mewcode/commands/Git Tools/Sync Repo.md"变成Git Tools/Sync Repo
  const rel = full.slice(base.length + 1).replace(/\.md$/, "");
  //根据/切割成[Git Tools,Sync Repo]，再循环替换掉” “为-，得到[git-tools,sync-repo]
  return rel
    .split(/[/\\]/)
    .map((p) => p.toLowerCase().replace(/ /g, "-"))
    //最后把[git-tools,sync-repo]变成git-tools:sync-repo
    .join(":");
}

// Render a command body, substituting $ARGUMENTS; if there is no placeholder and
// args were given, append them. Mirrors Go promptHandler.
//动态加载内容
export function renderBody(body: string, args: string): string {
  //如果body目前存在$ARGUMENTS，则把$ARGUMENTS替换成args的内容
  if (body.includes("$ARGUMENTS")) return body.replaceAll("$ARGUMENTS", args);
  //如果body不存在$ARGUMENTS，则把args拼接在body后面
  if (args) return `${body}\n\n${args}`;
  return body;
}
