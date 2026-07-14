# nuomi-cli

nuomi-cli 是一个运行在终端中的 AI 编程助手，灵感来源于 Claude Code / Kiro CLI。它基于 React + Ink 构建交互界面，支持多 AI 服务商，并内置了一套文件操作与代码执行工具，让 AI 可以直接在你的项目中读写文件、执行命令、搜索代码。

## 技术栈

| 层次 | 技术 |
|------|------|
| 终端 UI | [Ink](https://github.com/vadimdemedes/ink) + React 19 |
| 运行时 | Node.js + tsx |
| 语言 | TypeScript |
| 包管理 | pnpm |

## 核心功能

- **多 Provider 支持** — 通过 `config.yaml` 配置，同时支持 OpenAI 协议和 Anthropic 协议的接口，可灵活切换模型
- **内置工具集** — AI 可调用以下工具与本地环境交互：
  - `bash` — 执行 shell 命令
  - `read-file` — 读取文件内容
  - `write-file` — 写入/创建文件
  - `edit-file` — 精确编辑文件片段
  - `glob` — 按模式匹配文件路径
  - `grep` — 在文件中搜索文本
- **权限系统** — 内置 `PermissionDialog`，对敏感操作（如写文件、执行命令）弹出授权确认
- **沙箱模式** — 可在 `config.yaml` 中开启沙箱，控制网络访问与自动授权策略
- **环境感知** — 启动时自动读取当前工作目录、git 仓库状态，注入系统提示词

## 快速开始

```bash
# 安装依赖
pnpm install

# 开发模式（热重载）
pnpm dev

# 直接运行
pnpm cli
```

## 配置

编辑根目录的 `config.yaml`：

```yaml
providers:
  - name: my-provider
    protocol: openai   # 或 anthropic
    base_url: https://...
    api_key: "sk-..."
    model: gpt-4o
    thinking: false

sandbox:
  enabled: true
  auto_allow: true
  network_enabled: true
```

## 项目结构

```
nuomi-cli/
├── main.tsx              # 入口，挂载 Ink 应用
├── config.yaml           # Provider 与沙箱配置
└── src/
    ├── App.tsx           # 根组件，初始化 Client 与系统提示词
    ├── config.ts         # 配置加载
    ├── client/           # Anthropic / OpenAI 客户端封装
    ├── components/       # Chat、PromptInput、PermissionDialog 等 UI 组件
    ├── tools/            # 工具定义与注册（bash、文件操作、glob、grep）
    ├── prompt/           # 系统提示词构建与环境检测
    ├── premisson/        # 权限检查逻辑
    ├── sandbox/          # 沙箱控制
    ├── messageManger/    # 消息历史管理
    └── types/            # TypeScript 类型定义
```
