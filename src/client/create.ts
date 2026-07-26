import React from 'react'
import AnthropicClient from './anthorpic.js';
import OpenAIClient from './openai.js';
import { buildSystemPrompt, detectEnvironment } from '../prompt/builder.js';
import { ProviderConfig } from '../types/provider.js';
import writeLog from '../utils/writeLog.js';

interface CreateClientProps {
    provider: ProviderConfig;
    systemPrompt: string
    model?: string
}
const createClient = ({ provider, systemPrompt, model }: CreateClientProps) => {
    switch (provider.protocol) {
        case "anthropic":
            return new AnthropicClient(provider, systemPrompt, model);
        case "openai":
            return new OpenAIClient(provider, systemPrompt, model);
        default:
            throw new Error(`Unsupported provider: ${provider}`);
    }
}

export default createClient;