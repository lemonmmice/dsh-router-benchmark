# dsh-router-benchmark

**成本感知多模型路由评测基准** —— 用同一批真实任务，对比「单模型基线」与「路由模式」的**通过率、成本、时延**，回答一个问题：

> 按任务难度把请求路由到不同模型，真的比"一个模型打天下"更划算吗？

这是为 DeepSeek Harness 的 cost-aware multi-model 协作模式设计的评测框架：任务集基于评测仓库自带的公开示例代码库（samples/），gold 答案可自动判分。

## 对比的三种模式

| 模式 | 策略 |
|---|---|
| flash-only | 所有任务都用最便宜的 DeepSeek V4 Flash |
| pro-only | 所有任务都用 DeepSeek V4 Pro（当前主力模型） |
| routed | 成本感知路由：tier1 检索 → Flash；tier2 分析 → Pro；tier3 复杂/评审 → 四专家并行（Pro + MiMo + Kimi + GPT）只读评审，父代理（Pro）综合落盘 |

## 指标

- **通过率**：命中 gold 关键事实数 ≥ minGold 即通过（gold 来自示例代码库中的具体事实）
- **成本（元）**：tokens × 各提供商单价（在 config.json 维护价格表；缺失时标 unknown，不编造）
- **时延（ms）**：端到端墙钟时间（路由模式取专家并行 + 父代理综合的总耗时）
- **附带**：每个专家的独立通过率（detail 字段），可观察"专家分歧 → 父代理仲裁"的效果

## 任务集（tasks/*.json，10 个）

三个类别 × 三个难度档，全部只读、可自动判分：

| 类别 | tier1（Flash） | tier2（Pro） | tier3（多专家） |
|---|---|---|---|
| 检索 | 定位定时器抽象 | 分页工具类职责 | — |
| 分析 | — | Agent 循环参数、分页策略分析 | 通知服务重试评审、路由闸门条件 |
| 评审 | — | — | 通知服务重试逻辑、定时轮询风险 |

## 快速开始

```bash
# 1. 配置密钥（按你各中转站的实际情况）
export DEEPSEEK_RELAY_API_KEY=...   # DeepSeek（中转/官方均可）
export XIAOMI_API_KEY=...           # 小米 MiMo
export MOONSHOTAI_CN_API_KEY=...    # Kimi K3
export OPENAI_API_KEY=...           # GPT-5.6 Sol
export MINIMAX_API_KEY=...          # MiniMax

# 2. 在 config.json 补全价格表（元/百万token），未填的模型成本记为 unknown

# 3. 小样本试跑（每个模式前 3 个任务）
node runner.mjs --limit 3

# 4. 全量跑 + 生成 HTML 报告
node runner.mjs
node gen-report.mjs
```

结果写入 `results/results-YYYYMMDD.json`，报告生成在 `report.html`（含 SVG 图表，浏览器直接打开）。
