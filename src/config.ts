import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ProviderConfig, ProviderProtocol } from "./types/provider.js";
import writeLog from "./utils/writeLog.js";

export type AppConfig = {
    providers: ProviderConfig[];
};

const configPath = resolve(process.cwd(), "config.yaml");

type RawProviderConfig = Partial<Record<keyof ProviderConfig, string | boolean | number>>;

function stripInlineComment(line: string): string {
    let inSingleQuote = false;
    let inDoubleQuote = false;

    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        const previous = line[index - 1];

        if (char === "'" && !inDoubleQuote) {
            inSingleQuote = !inSingleQuote;
        } else if (char === "\"" && !inSingleQuote && previous !== "\\") {
            inDoubleQuote = !inDoubleQuote;
        } else if (char === "#" && !inSingleQuote && !inDoubleQuote) {
            return line.slice(0, index).trimEnd();
        }
    }

    return line;
}

function parseYamlValue(rawValue: string): string | boolean | number {
    const value = stripInlineComment(rawValue).trim();

    if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        return value.slice(1, -1);
    }

    if (value === "true") {
        return true;
    }

    if (value === "false") {
        return false;
    }

    if (/^\d+$/.test(value)) {
        return Number(value);
    }

    return value;
}

function parseKeyValue(line: string): [string, string] | null {
    const separatorIndex = line.indexOf(":");

    if (separatorIndex === -1) {
        return null;
    }

    return [
        line.slice(0, separatorIndex).trim(),
        line.slice(separatorIndex + 1).trim(),
    ];
}

function parseConfigYaml(source: string): {
    activeProviderName?: string;
    providers: RawProviderConfig[];
} {
    const providers: RawProviderConfig[] = [];
    let activeProviderName: string | undefined;
    let currentProvider: RawProviderConfig | null = null;
    let section = "";

    for (const rawLine of source.split(/\r?\n/)) {
        const line = stripInlineComment(rawLine).trimEnd();

        if (!line.trim()) {
            continue;
        }

        const trimmed = line.trim();
        const indentation = line.length - line.trimStart().length;

        if (indentation === 0) {
            const entry = parseKeyValue(trimmed);

            if (!entry) {
                continue;
            }

            const [key, rawValue] = entry;

            if (key === "providers") {
                section = "providers";
                continue;
            }

            section = "";

            if (key === "active_provider" || key === "provider") {
                activeProviderName = String(parseYamlValue(rawValue));
            }

            continue;
        }

        if (section !== "providers") {
            continue;
        }

        if (trimmed.startsWith("-")) {
            currentProvider = {};
            providers.push(currentProvider);

            const entry = parseKeyValue(trimmed.slice(1).trim());
            if (entry) {
                const [key, rawValue] = entry;
                currentProvider[key as keyof ProviderConfig] = parseYamlValue(rawValue);
            }

            continue;
        }

        if (!currentProvider) {
            continue;
        }

        const entry = parseKeyValue(trimmed);

        if (!entry) {
            continue;
        }

        const [key, rawValue] = entry;
        currentProvider[key as keyof ProviderConfig] = parseYamlValue(rawValue);
    }

    return { activeProviderName, providers };
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
    const providers = config.providers.map(normalizeProvider);
    return {
        providers,
    };
}
