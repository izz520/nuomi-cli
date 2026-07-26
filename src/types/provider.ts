export type ProviderProtocol = "anthropic" | "openai";
export type SubAgentModelTier = "fast" | "standard" | "strong";
export type SubAgentModelConfig = Partial<Record<SubAgentModelTier, string>>;

export interface ProviderConfig {
    name: string;
    protocol: ProviderProtocol;
    base_url: string;
    model: string;
    api_key: string;
    thinking?: boolean;
    context_window?: number;
    max_output_tokens?: number;
    subagent_models?: SubAgentModelConfig;
}


export interface SandBoxConfig {
    enabled: boolean;
    auto_allow: boolean;
    network_enabled: boolean
}

export interface MCPServerConfig {
    name: string;
    command?: string;
    args?: string[];
    url?: string;
    transport?: string;
    headers?: Record<string, string>;
    env?: Record<string, string>;
}

export interface HookConfig {
    id?: string;
    event: string;
    condition?: string;
    action: {
        type: string;
        command?: string;
        url?: string;
        method?: string;
        prompt?: string;
    };
    reject?: boolean;
    once?: boolean;
    async?: boolean;
    on_error?: string;
}
