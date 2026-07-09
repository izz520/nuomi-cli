import React from 'react'
import AnthropicClient from './anthorpic.js';
import OpenAIClient from './openai.js';
import { buildSystemPrompt, detectEnvironment } from '../prompt/builder.js';
import { ProviderConfig } from '../types/provider.js';
import writeLog from '../utils/writeLog.js';

interface CreateClientProps {
    provider: ProviderConfig;
}
const createClient = ({ provider }: CreateClientProps) => {
    // 构建系统提示词
    //获取启动时的目录地址
    const workDir = process.cwd();
    //读取系统信息和git仓库信息
    const env = detectEnvironment(workDir);
    //设置env的model为provider的model
    env.model = provider.model;
    //将对象转变为string的系统提示词
    const systemPrompt = buildSystemPrompt(env);
    writeLog(systemPrompt)
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