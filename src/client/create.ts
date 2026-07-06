import React from 'react'
import AnthropicClient from './anthorpic.js';
import OpenAIClient from './openai.js';

interface CreateClientProps {
    provider: string;
}
const createClient = ({ provider }: CreateClientProps) => {
    switch (provider) {
        case "anthropic":
            return new AnthropicClient();
        case "openai":
            return new OpenAIClient();
        default:
            throw new Error(`Unsupported provider: ${provider}`);
    }
}

export default createClient;