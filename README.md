# dsh-router-benchmark

**成本感知多模型路由评测基准** —— 用同一批真实任务，对比「单模型基线」与「路由模式」的**通过率、成本、时延**，回答一个问题：

> 按任务难度把请求路由到不同模型，真的比"一个模型打天下"更划算吗？

这是为 DeepSeek Harness 的 cost-aware multi-model 协作模式设计的评测框架：任务集基于评测仓库自带的公开示例代码库（samples/），gold 答案可自动判分。

## 最新结果（21 任务 × 3 模式）

| 模式 | 通过率 | 总成本（元） | 平均时延（ms） |
|---|---|---|---|
| flash-only | 86% | 0.11 | 3 581 |
| pro-only | 90% | 0.29 | 6 923 |
| routed | **100%** | 0.64 | 18 456 |

> 结论：路由模式通过率追平并反超最强基线，但成本约 2.2× pro-only——本文基准的
> 意义正是把这笔「可观测成本」量化出来。报告见 `report.html`（SVG 图表，直接浏览器打开）。
>
> ⚠ 上表是**平铺口径**（输入价不分缓存命中），属**上限估计**。加入分层口径后见下文
> 「上下文缓存」一节——长前缀场景下平铺口径会高估约 9–10 倍。

## 对比的三种模式

| 模式 | 策略 |
|---|---|
| flash-only | 所有任务都用最便宜的 DeepSeek V4 Flash |
| pro-only | 所有任务都用 DeepSeek V4 Pro（当前主力模型） |
| routed | 成本感知路由：tier1 检索 → Flash；tier2 分析 → Pro；tier3 复杂/评审 → 四专家并行（Pro + MiMo + Kimi + GPT）只读评审，父代理（Pro）综合落盘 |

## 指标

- **通过率**：命中 gold 关键事实数 ≥ minGold 即通过（gold 来自示例代码库中的具体事实）
- **成本（元）**：tokens × 各提供商单价（在 config.json 维护价格表；缺失时标 unknown，不编造）。
  自 2026-09-20 起给出**两套口径**：平铺（旧，历史可比）与**分层**（命中按 `cacheIn`、未命中按 `in`，贴近真实账单）；
  拿不到 hit/miss 时如实退回平铺并标注，不假装省了钱。
- **缓存命中率**：`prompt_cache_hit_tokens / (hit + miss)`；未采集时报告显示「未采集」而非 0%。
- **时延（ms）**：端到端墙钟时间（路由模式取专家并行 + 父代理综合的总耗时）
- **附带**：每个专家的独立通过率（detail 字段），可观察"专家分歧 → 父代理仲裁"的效果

## 上下文缓存（KV Cache / Context Caching）

DeepSeek 的上下文缓存**自动生效**，无需改代码：同一前缀第二次起，`usage` 会返回
`prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`。而缓存命中的输入价与未命中差距极大 ——
官方定价 deepseek-flash：命中 **$0.003/M** vs 未命中 **$0.150/M**，**单位价差 50 倍**。

因此本基准给出两套口径，并在报告中并列展示：

| 口径 | 输入计价 | 用途 |
|---|---|---|
| 平铺（旧） | 全部输入按 `in` | 与历史结果可比 |
| **分层（新）** | 命中按 `cacheIn`、未命中按 `in` | 贴近真实账单 |

报告里的「成本口径对照」表给出两者差额与**高估倍数**，即旧平铺口径在长前缀场景下高估了多少。

### 本机实测（2026-09-20，deepseek-flash，各 5 次）

同一段 2929 token 前缀：

| 条件 | 冷启动命中率 | 稳态命中率 | 稳态成本（美元） |
|---|---|---|---|
| 稳定前缀 | 0% | **91.8%**（hit 2688 / miss 241） | $0.000189 |
| 变动前缀（变化标记放在**最前面**） | 0% | **0%**（5/5 全 miss） | $0.001769 |

- 变动前缀的稳态成本是稳定前缀的 **9.37 倍**。
- ⚠ **50 倍与 9.37 倍不能混着说**：50 是**单位价格**的倍数；端到端倍数由**命中率**决定 ——
  每次提问那一小段（241 token）必然 miss、按全价计费。
- ⚠ 延迟层面**未测出**稳定收益（147ms vs 100ms，小样本下网络抖动主导）。本基准只就成本下结论，
  **不声称「缓存能提速」**。

### 对 Harness 的含义

缓存按**前缀**匹配：稳定部分（系统提示、工具定义、项目约定）必须放在**最前面**，易变内容放后面。
改动系统提示的前几个字符，会让整个前缀缓存失效 —— 这正是成本敏感型 Agent 的上下文设计约束。

价格来源：[DeepSeek 官方定价页](https://api-docs.deepseek.com/quick_start/pricing)（2026-09-20 读取）；
机制见 [Context Caching 文档](https://api-docs.deepseek.com/guides/kv_cache)。


三个类别 × 三个难度档，全部只读、可自动判分：

| 类别 | tier1（Flash） | tier2（Pro） | tier3（多专家） |
|---|---|---|---|
| 检索 | 定时器/分页/命名空间/日志级别定位 | 缓存键来源、订单常量类职责 | — |
| 分析 | — | Agent 循环参数、分页策略、图表渲染性能分析 | 通知服务重试评审、路由闸门条件、事件列表 |
| 评审 | — | — | 通知服务重试逻辑、定时轮询风险、WebSocket 重连 |

> 任务标题与 gold 答案对第三方模型是可读的（中文标题 + 代码事实答案），
> 新增任务可参考 `tasks/*.json` 的 schema。

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
