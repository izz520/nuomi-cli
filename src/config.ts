import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type Provider = "anthropic" | "openai";

export type AppConfig = {
    provider: Provider;
    apiUrl: string;
    apiKey: string;
    model: string;
};

const configPath = resolve(process.cwd(), "config.toml");

function parseStringValue(rawValue: string): string {
    const value = rawValue.trim();

    if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        return value.slice(1, -1);
    }

    return value;
}

function parseConfigToml(source: string): Record<string, string> {
    const entries: Record<string, string> = {};

    for (const line of source.split(/\r?\n/)) {
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith("#")) {
            continue;
        }

        const separatorIndex = trimmed.indexOf("=");

        if (separatorIndex === -1) {
            continue;
        }

        const key = trimmed.slice(0, separatorIndex).trim();
        const rawValue = trimmed.slice(separatorIndex + 1);

        entries[key] = parseStringValue(rawValue);
    }

    return entries;
}

export function loadConfig(): AppConfig {
    const config = parseConfigToml(readFileSync(configPath, "utf8"));
    const provider = config.provider;

    if (provider !== "anthropic" && provider !== "openai") {
        throw new Error(`Unsupported provider "${provider || ""}" in config.toml.`);
    }

    if (!config.api_key) {
        throw new Error("Missing api_key in config.toml.");
    }

    return {
        provider,
        apiUrl: config.api_url || "https://api.anthropic.com",
        apiKey: config.api_key,
        model: config.model,
    };
}
