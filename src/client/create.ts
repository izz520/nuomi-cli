import React from 'react'
import AnthropicClient from './anthorpic.js';
import OpenAIClient from './openai.js';
import { buildSystemPrompt, detectEnvironment } from '../prompt/builder.js';
import { ProviderConfig } from '../types/provider.js';
import writeLog from '../utils/writeLog.js';

interface CreateClientProps {
    provider: ProviderConfig;
    systemPrompt: string
}
const createClient = ({ provider, systemPrompt }: CreateClientProps) => {
    switch (provider.protocol) {
        case "anthropic":
            return new AnthropicClient(provider, systemPrompt);
        case "openai":
            return new OpenAIClient(provider, systemPrompt);
        default:
            throw new Error(`Unsupported provider: ${provider}`);
    }
}

export default createClient;