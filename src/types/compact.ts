export interface UsageAnchor {
    //经过AI精准计算的当前会话已消耗token
    baselineTokens: number;
    //当前会话的总条数
    anchorCount: number;
}