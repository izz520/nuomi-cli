import type { IMessage } from "../types/messsage.js";
import { MessageManager } from "./message.js";

// 重新构建一个新的Message管理器消息
export function buildMessageManager(messages: IMessage[]): MessageManager {
  const mgr = new MessageManager();
  for (const msg of messages) {
    if (msg.toolUses && msg.toolUses.length > 0) {
      mgr.addAssistantFull(msg.content, msg.thinkingBlocks ?? [], msg.toolUses);
    } else if (msg.toolResults && msg.toolResults.length > 0) {
      mgr.addToolResultsMessage(msg.toolResults);
    } else if (msg.role === "user") {
      mgr.addUserMessage(msg.content);
    } else if (msg.role === "assistant") {
      mgr.addAssistantMessage(msg.content);
    }
  }
  return mgr;
}
