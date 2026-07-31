import { IMessage } from "../types/messsage.js";
import { ToolResultCompactStateManger } from "./state.js";
import {
    persistToolResult,
    TOOL_OUTPUT_PREVIEW_CHARS,
} from "./persisted-tool-output.js";
// 单个工具最大的字符限制
const SINGLE_TOOL_MAX_CONTENT = 50000
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
                    content = persistToolResult(workDir, result.toolUseId, content);
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
                    if (r.content.length > TOOL_OUTPUT_PREVIEW_CHARS) {
                        //存储原内容
                        const before = r.content;
                        //拿到了工具id缓存的路径，和存储工具结果
                        const replacement = persistToolResult(workDir, r.toolUseId, before);
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
