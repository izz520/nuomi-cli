import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderConfig } from "../types/provider.js";
import { resolveModelId } from "./model-resolver.js";

const provider = (
  overrides: Partial<ProviderConfig> = {},
): ProviderConfig => ({
  name: "test",
  protocol: "openai",
  base_url: "https://example.invalid",
  api_key: "test",
  model: "provider-default",
  ...overrides,
});

test("falls back to the provider default when subagent_models is omitted", () => {
  const config = provider();

  assert.equal(resolveModelId(undefined, config), "provider-default");
  assert.equal(resolveModelId("fast", config), "provider-default");
  assert.equal(resolveModelId("standard", config), "provider-default");
  assert.equal(resolveModelId("strong", config), "provider-default");
});

test("uses configured tiers and falls back for a missing partial tier", () => {
  const config = provider({
    subagent_models: {
      fast: "gpt-fast",
      strong: "gpt-strong",
    },
  });

  assert.equal(resolveModelId("fast", config), "gpt-fast");
  assert.equal(resolveModelId("standard", config), "provider-default");
  assert.equal(resolveModelId("strong", config), "gpt-strong");
});

test("passes a provider-specific full model ID through unchanged", () => {
  assert.equal(resolveModelId("custom-openai-model", provider()), "custom-openai-model");
});
