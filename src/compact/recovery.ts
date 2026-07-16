// Recovery budgets for the attachment block appended to the summary
// message. Compact wipes the working conversation; without these
// snapshots the model would forget which files it just read and which
// skill SOPs it was operating under. Mirrors Go recovery.go.
// 文件截取的最大保留数
const RECOVERY_FILE_LIMIT = 5;
// 文件内容的最大token
const RECOVERY_TOKENS_PER_FILE = 5_000;
// Skill的最大保留token
const RECOVERY_SKILLS_BUDGET = 25_000;
// skill 内容的最大token
const RECOVERY_TOKENS_PER_SKILL = 5_000;
// 字符串转token的比例 预估3.5个字符串等于1token
const RECOVERY_CHARS_PER_TOKEN = 3.5;

// 计算token
function calcTokens(s: string): number {
  if (!s) return 0;
  return Math.floor(s.length / RECOVERY_CHARS_PER_TOKEN);
}

// 截断内容
function truncateByTokens(s: string, maxToken: number): string {
  // 如果没有最大token限制，则直接返回原内容
  if (maxToken <= 0 || !s) return s;
  // 根据内容的长度，估算一个token量，如果token的量小于最大token的限制，则原文返回
  if (calcTokens(s) <= maxToken) return s;
  //通过最大token限制乘于3.5，估算出来大概有多少个字符
  const maxChars = Math.floor(maxToken * RECOVERY_CHARS_PER_TOKEN);
  // 如果字符小于等于0，或者字符超过了原文的最大字符，则返回原文
  if (maxChars <= 0 || maxChars >= s.length) return s;
  // 截取对应字符长度的内容，再拼接内容已截断
  return s.slice(0, maxChars) + "\n… (content truncated)";
}


//文件的纪录
interface FileReadRecord {
  // 文件的路径
  path: string;
  // 文件内容
  content: string;
  // 读取时间
  timestamp: number;
}

// Skill的记录
interface SkillInvocationRecord {
  // skill的名字
  name: string;
  // skill的描述
  body: string;
  // skill的使用时间
  timestamp: number;
}

export class RecoveryManager {
  // 创建一个文件记录的map
  private files = new Map<string, FileReadRecord>();
  // 创建一个skill记录的map
  private skills = new Map<string, SkillInvocationRecord>();

  // 记录文件读取
  recordFileRead(path: string, content: string): void {
    this.files.set(path, { path, content, timestamp: Date.now() });
  }

  // 记录skill
  recordSkillInvocation(name: string, body: string): void {
    this.skills.set(name, { name, body, timestamp: Date.now() });
  }

  // 提取快照记录，目前限制5个
  snapshotFiles(limit = RECOVERY_FILE_LIMIT): FileReadRecord[] {
    // 根据最新时间排序
    const sorted = [...this.files.values()].sort(
      (a, b) => b.timestamp - a.timestamp
    );
    // 返回前5个记录
    return sorted.slice(0, limit);
  }

  // 提取快照Skill，按最新的在最前面排序
  snapshotSkills(): SkillInvocationRecord[] {
    return [...this.skills.values()].sort(
      (a, b) => b.timestamp - a.timestamp
    );
  }

  buildRecoveryPrompt(toolSchemaNames: string[]): string {
    const sections: string[] = [];
    // 拿到最新的5条记录
    const recentFiles = this.snapshotFiles();
    if (recentFiles.length > 0) {
      // 添加两个prompt
      sections.push("## Recently read files\n");
      sections.push(
        "These snapshots are what the file-reading tool last returned. Re-open with the tool if you need the current bytes.\n"
      );
      // 循环文件记录
      for (const f of recentFiles) {
        // 拿到截取后的记录
        const content = truncateByTokens(f.content, RECOVERY_TOKENS_PER_FILE);
        // 生成秒级时间戳
        const ts = new Date(f.timestamp).toISOString().replace(/\.\d{3}Z$/, "Z");
        // 生成一个Markdown
        sections.push(`### ${f.path}  (read ${ts})\n\n\`\`\`\n${content}${content.endsWith("\n") ? "" : "\n"}\`\`\``);
      }
    }
    // 拿到skill
    const skills = this.snapshotSkills();
    if (skills.length > 0) {

      let used = 0;
      const skillParts: string[] = [];
      // 添加markdown的头
      skillParts.push("## Active skills\n");
      skillParts.push(
        "These skills were invoked earlier in the session. Continue to follow each SOP when its triggering condition applies.\n"
      );
      let emitted = false;
      // 循环skills
      for (const sk of skills) {
        // 截取skill的内容
        const body = truncateByTokens(sk.body, RECOVERY_TOKENS_PER_SKILL);
        // 预估token
        const tokens = calcTokens(body) + calcTokens(sk.name) + 8;
        // 如果说总已使用的token超过RECOVERY_SKILLS_BUDGET限制，则不要了
        if (used + tokens > RECOVERY_SKILLS_BUDGET) break;
        // 反之，先加上本次的token
        used += tokens;
        // 再在skillParts里面加上这个skill
        skillParts.push(`### ${sk.name}\n\n${body}`);
        // 标记有skill记录
        emitted = true;
      }
      // 只有在有skill使用记录的时候，才会在sections里面加入skill的markdown片段
      if (emitted) {
        sections.push(skillParts.join("\n\n"));
      }
    }

    // 有传进来的工具名
    if (toolSchemaNames.length > 0) {
      // 在sections里面添加上使用过的工具名
      sections.push(
        "## Available tools\n\nYou still have access to the following tools — call them directly when the task needs one:\n\n" +
        toolSchemaNames.map((n) => `- ${n}`).join("\n")
      );
    }
    // 最后如果sections都有0的话，直接返回空
    if (sections.length === 0) return "";
    // 加上最后一个内容块
    sections.push(
      "## Note\n\nEverything above the divider is reconstructed context. For exact code, error strings, or user-typed text, re-read the source rather than guess from the summary."
    );
    //给每个内容块添加换行符，然后转成string
    return sections.join("\n\n");
  }
}
