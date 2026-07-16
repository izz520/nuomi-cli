import { join } from "path";
import { IMessage } from "../types/messsage.js";
import { mkdirSync, writeFileSync } from "fs";
import { ToolResultCompactStateManger } from "./state.js";
// 单个工具最大的字符限制
const SINGLE_TOOL_MAX_CONTENT = 50000
// preview截取的最大长度，超出就会自动截取
const TOOL_RESULT_PREVIEW = 2000
//单个消息下，所有工具结果的总字符限制
const SINGLE_MESSAGE_TOOL_MAX_CONTENT = 200000;

// 压缩所有会话的所有工具调用结果
export const compactToolResults = (messages: IMessage[], workDir: string, state: ToolResultCompactStateManger) => {
    const results: IMessage[] = []
    for (const message of messages) {
        //浅拷贝一下，防止修改原始数据
        const newMessage = { ...message }
        if (newMessage.toolResults && newMessage.toolResults.length > 0) {
            const newResults = newMessage.toolResults.map((result) => {
                // 是否已经被替换过，返回时已经压缩的内容
                const isReplace = state.getReplacement(result.toolUseId)
                if (isReplace !== undefined) {
                    //是被替换过的，直接把压缩的内容返回
                    return { ...result, content: isReplace };
                }
                // 没有压缩
                let content = result.content;
                // Pass 1: 单条工具结果是否超出限制 → 溢出到磁盘
                if (content.length > SINGLE_TOOL_MAX_CONTENT) {
                    //拿到了工具id缓存的路径，和存储工具结果
                    const spillPath = saveToolResultToFile(workDir, result.toolUseId, content);
                    //替换上下文，内容为之展示部分，其他的在哪个路径文件里
                    content = compactToolResult(content, spillPath);
                    //将这个工具id的结果标记到工具压缩状态管理器里面成替换的内容：id-原文内容-替换后的内容
                    state.record(result.toolUseId, result.content, content);
                }
                // 返回压缩后的
                return { ...result, content };
            })
            //计算所有工具结果压缩后的内容总长度
            let totalLen = newResults.reduce((sum, r) => sum + r.content.length, 0);
            //判断当前的消息的所有工具调用结果是否大于最大限制
            if (totalLen > SINGLE_MESSAGE_TOOL_MAX_CONTENT) {
                //排序一下，内容最长的放在最前面
                const sorted = [...newResults].sort(
                    (a, b) => b.content.length - a.content.length
                );
                //循环排序后的全部工具调用结果
                for (const r of sorted) {
                    //判断工具全部结果内容是否小于最大限制了
                    if (totalLen <= SINGLE_MESSAGE_TOOL_MAX_CONTENT) break;
                    //单个内容超出了单个结果最大内容限制
                    if (r.content.length > TOOL_RESULT_PREVIEW) {
                        //存储原内容
                        const before = r.content;
                        //拿到了工具id缓存的路径，和存储工具结果
                        const spillPath = saveToolResultToFile(workDir, r.toolUseId, before);
                        //替换上下文，内容为之展示部分，其他的在哪个路径文件里
                        const replacement = compactToolResult(before, spillPath);
                        //总长度=总长度-原始长度+压缩后的新长度
                        totalLen = totalLen - before.length + replacement.length;
                        //把原来的工具结果替换
                        r.content = replacement;
                        //记录替换的内容：id-原文内容-替换后的内容
                        state.record(r.toolUseId, before, replacement);
                    }
                }
            }
            newMessage.toolResults = newResults;
        }
        results.push(newMessage)
    }
    return results
}

// 将原始调用结果存储到文件里
const saveToolResultToFile = (workDir: string, toolUseId: string, content: string) => {
    //拿到当前拼接好的存放目录
    const dir = join(workDir, ".nuomi", "tool_results");
    //recursive防止文件存在的报错，以及创建多成目录的错误
    mkdirSync(dir, { recursive: true });
    //拼接工具目录和工具id的内容，比如：/nuomi-cli/.newcode/tool_results/111111
    const path = join(dir, toolUseId);
    try {
        //把工具的结果写入文件
        //flag的wx：如果文件已存在，写入操作会报错失败，如果是w：则存在会覆盖
        writeFileSync(path, content, { encoding: "utf-8", flag: "wx" });
    } catch (e: any) {
        if (e.code !== "EEXIST") throw e;
    }
    //返回当前工具id的路径
    return path;
}

// 压缩单个工具调用结果
const compactToolResult = (content: string, path: string) => {
    //计算内容大小
    const sizeKB = Math.floor(content.length / 1024);
    //切割内容，只保留2000字符
    const preview = content.slice(0, TOOL_RESULT_PREVIEW);
    //判断是否超过2000字符
    const hasMore = content.length > TOOL_RESULT_PREVIEW;
    //拼接消息：当前内容太长了，内容保存在哪个路径下
    return `<persisted-output>
            输出太大（${sizeKB}KB），完整内容已保存到：
            ${path}

            预览（前 2000 个字符）：
            ${preview}
            ...
        </persisted-output>`;
}