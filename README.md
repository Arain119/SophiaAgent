# Sophia Agent

Sophia Agent v0.1 是一个面向终端的 AI 编程助手。它使用单一 Core 运行时，
自动完成规划、工具选择、后台任务跟踪，并连接兼容 OpenAI Responses 的模型服务。

## 功能

- 交互式和无头模式，支持会话恢复与上下文压缩
- 文件、搜索、Shell、网页、内置浏览器和 SSH 工具
- 按需自动发现 Skills 与 MCP
- 子 Agent、工作流、定时任务、本地记忆和任务监控
- 命名 Provider 配置，可分别设置主 Agent 与子 Agent 模型
- 固定自动执行策略，无需配置权限模式

## 安装

要求 Bun 1.3.11 或更高版本，以及一个兼容 OpenAI Responses 的端点。

推荐使用一键安装：

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/Arain119/SophiaAgent/main/scripts/install.sh | bash

# Windows PowerShell
irm https://raw.githubusercontent.com/Arain119/SophiaAgent/main/scripts/install.ps1 | iex
```

安装脚本会在需要时准备 Bun，并全局安装 `sophiaagent` 包。之后运行：

```bash
sophia
```

也可以直接安装 npm 包：

```bash
npm install --global sophiaagent
```

## 从源码运行

```bash
bun install
bun run dev
```

构建并验证 CLI：

```bash
bun run build
bun run health
```

可选的 ripgrep 设置需要显式执行，不会在安装时修改机器：

```bash
bun run setup:ripgrep
```

## 使用入口

- 可执行文件：`sophia`
- 全局配置：`~/.sophia/`
- 项目配置：`.sophia/`
- 项目指令：`SOPHIA.md`
- 模型与 Provider：`/model`
- 主 Agent 推理 effort：`/effort`
- 会话管理：`/new`、`/resume`、`/exit`
- 会话统计：`/usage`

## 开发检查

```bash
bun run typecheck
bun run lint
bun test
bun run build
bun run health
```

## 安全问题

请勿在公开 Issue 中报告安全漏洞。请通过 GitHub Security Advisories
私下提交：[创建安全报告](https://github.com/Arain119/SophiaAgent/security/advisories/new)。
报告应包含可复现步骤、受影响版本、影响范围和可行的缓解措施。提交前请移除
API Key、密码及其他敏感信息。
