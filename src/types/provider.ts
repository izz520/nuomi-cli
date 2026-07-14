export type ProviderProtocol = "anthropic" | "openai";

export interface ProviderConfig {
    name: string;
    protocol: ProviderProtocol;
    base_url: string;
    model: string;
    api_key: string;
    thinking?: boolean;
    context_window?: number;
    max_output_tokens?: number;
}


export interface SandBoxConfig {
    enabled: boolean;
    auto_allow: boolean;
    network_enabled: boolean
}