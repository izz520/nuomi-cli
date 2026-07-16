import type { UsageAnchor } from "../types/compact.js";
import type { UsageInfo } from "../types/llm.js";

/**
 * Build an anchor for the messages that were sent to the model.
 *
 * The assistant response is appended after `anchorCount`, so output tokens must
 * not be included in the baseline. The next context calculation estimates that
 * response, along with tool results and later user messages, as new messages.
 */
export function createUsageAnchor(usage: UsageInfo, anchorCount: number): UsageAnchor {
    return {
        baselineTokens:
            usage.inputTokens +
            usage.cacheReadInputTokens +
            usage.cacheCreationInputTokens,
        anchorCount,
    };
}
