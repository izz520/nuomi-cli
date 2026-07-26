import type { ProviderConfig } from "../types/provider.js";
import createClient from "../client/create.js";
import AnthropicClient from "./anthorpic.js";
import OpenAIClient from "./openai.js";

// Short aliases the model field of an agent definition may use. Unknown names
// pass through unchanged so a full model id still works. Mirrors Go modelAliases.
const MODEL_ALIASES: Record<string, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6-20250514",
  opus: "claude-opus-4-6-20250514",
};

export function resolveModelId(shortName: string): string {
  return MODEL_ALIASES[shortName] ?? shortName;
}

// Returns a function that builds a client for a given short model name, reusing
// the base provider config (api key, base url, protocol) but swapping the model.
// Mirrors Go NewModelResolver.
export function createModelResolver(
  baseCfg: ProviderConfig,
  systemPrompt: string
): (shortName: string) => AnthropicClient | OpenAIClient {
  return (shortName: string) =>
    createClient({ provider: baseCfg, systemPrompt: systemPrompt, model: resolveModelId(shortName) },);
}
