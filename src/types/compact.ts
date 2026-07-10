export interface UsageAnchor {
    // input + cache_read + cache_creation + output from the last real API usage.
    baselineTokens: number;
    // conversation.len() at the moment the anchor was recorded; only messages
    // beyond this index are estimated incrementally.
    anchorCount: number;
}