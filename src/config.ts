import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { load } from "js-yaml";
import type { ProviderConfig, ProviderProtocol, SandBoxConfig } from "./types/provider.js";

export type AppConfig = {
    providers: ProviderConfig[];
    activeProviderName?: string;
    sandbox: SandBoxConfig
};

const configPath = resolve(process.cwd(), "config.yaml");

type RawProviderConfig = Partial<Record<keyof ProviderConfig, unknown>>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConfigYaml(source: string): {
    activeProviderName?: string;
    providers: RawProviderConfig[];
    sandbox: SandBoxConfig
} {
    const parsed = load(source, { filename: configPath });
    // console.log("🚀 ~ parseConfigYaml ~ parsed:", parsed)

    if (!isRecord(parsed)) {
        throw new Error("config.yaml must contain a YAML object.");
    }

    if (!Array.isArray(parsed.providers)) {
        throw new Error('config.yaml must contain a "providers" array.');
    }

    const providers = parsed.providers.map((provider, index) => {
        if (!isRecord(provider)) {
            throw new Error(`Provider #${index + 1} must be a YAML object.`);
        }

        return provider as RawProviderConfig;
    });
    const activeProvider = parsed.active_provider ?? parsed.provider;
    const activeProviderName = typeof activeProvider === "string" ? activeProvider : undefined;
    const sandbox: SandBoxConfig = parsed.sandbox ? parsed.sandbox as SandBoxConfig : { enabled: true, auto_allow: true, network_enabled: true } as SandBoxConfig
    return { activeProviderName, providers, sandbox };
}

function assertString(value: unknown, key: string, providerName: string): string {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`Missing ${key} for provider "${providerName}".`);
    }

    return value;
}

function normalizeProvider(provider: RawProviderConfig, index: number): ProviderConfig {
    const providerName = typeof provider.name === "string" && provider.name.length > 0
        ? provider.name
        : `#${index + 1}`;
    const protocol = assertString(provider.protocol, "protocol", providerName);

    if (protocol !== "anthropic" && protocol !== "openai") {
        throw new Error(`Unsupported protocol "${protocol}" for provider "${providerName}".`);
    }

    return {
        name: assertString(provider.name, "name", providerName),
        protocol: protocol as ProviderProtocol,
        base_url: assertString(provider.base_url, "base_url", providerName),
        api_key: assertString(provider.api_key, "api_key", providerName),
        model: assertString(provider.model, "model", providerName),
        thinking: typeof provider.thinking === "boolean" ? provider.thinking : undefined,
        context_window: typeof provider.context_window === "number" ? provider.context_window : undefined,
        max_output_tokens: typeof provider.max_output_tokens === "number" ? provider.max_output_tokens : undefined,
    };
}

export function loadConfig(): AppConfig {
    const config = parseConfigYaml(readFileSync(configPath, "utf8"));
    // console.log("🚀 ~ loadConfig ~ config:", config)
    const providers = config.providers.map(normalizeProvider);
    return {
        ...config,
        providers,

    };
}
