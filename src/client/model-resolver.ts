import type { ProviderConfig, SubAgentModelTier } from "../types/provider.js";
import createClient from "../client/create.js";
import AnthropicClient from "./anthorpic.js";
import OpenAIClient from "./openai.js";

const MODEL_TIERS = new Set<SubAgentModelTier>([
  "fast",
  "standard",
  "strong",
]);

export function resolveModelId(
  requestedModel: string | undefined,
  provider: ProviderConfig,
): string {
  const requested = requestedModel?.trim();
  if (!requested) return provider.model;

  const tier = MODEL_TIERS.has(requested as SubAgentModelTier)
    ? requested as SubAgentModelTier
    : undefined;

  // subagent_models is intentionally optional and may be partially configured.
  // A missing tier always falls back to the provider's known-good default model.
  if (tier) return provider.subagent_models?.[tier] ?? provider.model;

  // Non-tier values are treated as provider-specific full model IDs.
  return requested;
}

// Returns a function that builds a client for a given short model name, reusing
// the base provider config (api key, base url, protocol) but swapping the model.
// Mirrors Go NewModelResolver.
export function createModelResolver(
  baseCfg: ProviderConfig,
  systemPrompt: string
): (shortName: string) => AnthropicClient | OpenAIClient {
  return (shortName: string) =>
    createClient({
      provider: baseCfg,
      systemPrompt,
      model: resolveModelId(shortName, baseCfg),
    });
}
