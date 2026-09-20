#!/usr/bin/env node
// dsh-router-benchmark runner v1 — 带工具调用的 Agent 评测
// 模式: flash-only / pro-only / routed(成本感知路由: tier1→Flash, tier2→Pro, tier3→四专家+父代理仲裁)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf-8"));

const args = process.argv.slice(2);
const getArg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const limit = parseInt(getArg("--limit", "0"), 10);
const onlyTask = getArg("--task", null);
const modes = (getArg("--modes", "flash-only,pro-only,routed")).split(",").map(s => s.trim());
const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
const outPath = getArg("--out", path.join(__dirname, "results", "results-" + ts + ".json"));

// ---------- 模型引用 ----------
function resolve(ref) {
  const [p, m] = ref.split(".");
  const pc = cfg.providers[p];
  if (!pc || !pc.models[m]) throw new Error("未知模型引用: " + ref);
  const price = (pc.prices && pc.prices[m]) || { in: null, out: null };
  const baseURL = (pc.baseURLEnv && process.env[pc.baseURLEnv]) || pc.baseURL;
  const modelDef = pc.models[m];
  const modelId = typeof modelDef === "string" ? modelDef : modelDef.id;
  const temperature = typeof modelDef === "string" ? 0.2 : (modelDef.temperature ?? 0.2);
  return { provider: p, modelId, baseURL, apiKeyEnv: pc.apiKeyEnv, price, temperature, display: pc.displayName + "/" + modelId };
}
function apiKey(ref) {
  const r = resolve(ref);
  const key = process.env[r.apiKeyEnv];
  if (!key) throw new Error("缺少环境变量 " + r.apiKeyEnv + "（" + r.display + "）");
  return { ...r, key };
}

// ---------- 只读工具 ----------
const SKIP = new Set([".git", "node_modules", "bin", "obj", ".vs", "packages", "dist", ".venv"]);
function walk(dir, max = 800) {
  const out = [];
  const stack = [dir];
  while (stack.length && out.length < max) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else out.push(p);
      if (out.length >= max) break;
    }
  }
  return out;
}
function safeJoin(root, rel) {
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(path.resolve(root))) throw new Error("路径越界: " + rel);
  return abs;
}
const tools = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "列出目录下的文件（递归，跳过 bin/obj/node_modules/.git）。参数 dir 为相对仓库根目录的路径，缺省为根。",
      parameters: { type: "object", properties: { dir: { type: "string", description: "相对目录，如 Client 或 ." } }, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "grep",
      description: "在仓库中搜索代码/文本（大小写不敏感，支持子串或正则）。返回 文件路径:行号:内容，最多 60 条。",
      parameters: { type: "object", properties: { pattern: { type: "string", description: "搜索模式" }, dir: { type: "string", description: "相对目录，缺省为全仓库" } }, required: ["pattern"] }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取仓库内文本文件（最多 200 行）。参数 path 为相对仓库根目录的路径。",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
    }
  }
];
function runTool(root, name, argsJson) {
  let a = {};
  try { a = JSON.parse(argsJson || "{}"); } catch { return "参数不是合法 JSON"; }
  if (name === "list_files") {
    const dir = safeJoin(root, a.dir || ".");
    const files = walk(dir);
    return files.map(f => path.relative(root, f)).slice(0, 500).join("\n") || "(空目录)";
  }
  if (name === "grep") {
    const base = safeJoin(root, a.dir || ".");
    const files = walk(base, 3000);
    const re = (() => { try { return new RegExp(a.pattern, "i"); } catch { return null; } })();
    const hits = [];
    for (const f of files) {
      if (!/\.(cs|csproj|sln|xaml|json|md|ts|js|mjs|py|ps1|yaml|yml|txt|xml|vue|sh)$/i.test(f)) continue;
      let lines;
      try { lines = fs.readFileSync(f, "utf-8").split("\n"); } catch { continue; }
      lines.forEach((ln, i) => {
        if (hits.length >= 60) return;
        const ok = re ? re.test(ln) : ln.toLowerCase().includes(String(a.pattern).toLowerCase());
        if (ok) hits.push(path.relative(root, f) + ":" + (i + 1) + ": " + ln.trim().slice(0, 160));
      });
    }
    return hits.join("\n") || "(无匹配)";
  }
  if (name === "read_file") {
    const f = safeJoin(root, a.path);
    const lines = fs.readFileSync(f, "utf-8").split("\n");
    return lines.slice(0, 200).map((l, i) => (i + 1) + ": " + l).join("\n");
  }
  return "未知工具: " + name;
}

// ---------- LLM 调用 ----------
async function chatOnce(ref, messages, opts = {}) {
  const r = apiKey(ref);
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 300000);
  try {
    const body = { model: r.modelId, messages, temperature: opts.temperature ?? r.temperature, stream: false };
    if (opts.tools) body.tools = opts.tools;
    const resp = await fetch(r.baseURL.replace(/\/$/, "") + "/chat/completions", {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + r.key },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(r.display + " HTTP " + resp.status + ": " + JSON.stringify(data).slice(0, 250));
    return {
      message: data.choices?.[0]?.message ?? { content: "" },
      tokensIn: data.usage?.prompt_tokens ?? null,
      tokensOut: data.usage?.completion_tokens ?? null,
      // DeepSeek 原生字段：上下文缓存命中/未命中的输入 token（其他供应商可能不返回）
      cacheHit: data.usage?.prompt_cache_hit_tokens ?? null,
      cacheMiss: data.usage?.prompt_cache_miss_tokens ?? null,
      ms: Date.now() - t0
    };
  } finally { clearTimeout(timer); }
}

// ---------- Agent 循环（带工具，只读） ----------
async function agentLoop(ref, task, opts = {}) {
  const sys = "你是只读代码分析专家，只基于工具返回的仓库事实作答，绝不编造文件路径或代码内容。最终回答要求：结论 + 证据路径（文件:行号），简洁。";
  const messages = [
    { role: "system", content: sys + "\n仓库根目录: " + task.root + "\n任务类型: " + task.category },
    { role: "user", content: task.prompt }
  ];
  let totalIn = 0, totalOut = 0, totalHit = 0, totalMiss = 0, cacheSeen = false, lastMs = 0;
  for (let round = 1; round <= (opts.maxRounds ?? 4); round++) {
    const res = await chatOnce(ref, messages, { tools });
    totalIn += res.tokensIn ?? 0; totalOut += res.tokensOut ?? 0; lastMs = Math.max(lastMs, res.ms);
    if (res.cacheHit != null || res.cacheMiss != null) { cacheSeen = true; totalHit += res.cacheHit ?? 0; totalMiss += res.cacheMiss ?? 0; }
    const msg = res.message;
    messages.push(msg);
    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) {
      return { text: msg.content ?? "", tokensIn: totalIn, tokensOut: totalOut, cacheHit: cacheSeen ? totalHit : null, cacheMiss: cacheSeen ? totalMiss : null, ms: lastMs, rounds: round - 1 };
    }
    let idx = 0;
    for (const c of calls) {
      idx += 1;
      const id = (c.id && String(c.id).length) ? String(c.id) : ("tc_" + round + "_" + idx);
      const toolRes = (() => { try { return runTool(task.root, c.function?.name, c.function?.arguments); } catch (e) { return "工具错误: " + e.message; } })();
      messages.push({ role: "tool", tool_call_id: id, content: String(toolRes).slice(0, 12000) });
    }
  }
  const last = messages[messages.length - 1];
  return { text: (last.content ?? "(达到轮次上限，未给出最终答案)"), tokensIn: totalIn, tokensOut: totalOut, cacheHit: cacheSeen ? totalHit : null, cacheMiss: cacheSeen ? totalMiss : null, ms: lastMs, rounds: opts.maxRounds };
}

// ---------- 判分 ----------
function judge(text, task) {
  const hits = task.gold.filter(g => (text ?? "").toLowerCase().includes(g.toLowerCase()));
  const score = hits.length / task.gold.length;
  const minGold = task.minGold ?? Math.ceil(task.gold.length * (cfg.judge.defaultMinGold ?? 0.6));
  return { pass: hits.length >= minGold, score: +(score).toFixed(2), hits, missed: task.gold.filter(g => !hits.includes(g)), minGold };
}
function costOf(ref, res) {
  if (res.tokensIn == null || res.tokensOut == null) return { cost: null, flatCost: null, costKnown: false, cacheKnown: false };
  const p = resolve(ref).price;
  if (p.in == null || p.out == null) return { cost: null, flatCost: null, costKnown: false, cacheKnown: false };
  // 平铺口径（旧模型）：输入价不分缓存命中。保留它是为了让历史数据可对照，
  // 也为了量化"忽略缓存会把成本高估多少"。
  const flat = (res.tokensIn / 1e6) * p.in + (res.tokensOut / 1e6) * p.out;
  // 分层口径：命中部分按 cacheIn，未命中部分按 in。
  // 缺 cacheIn、或供应商不返回 hit/miss 时退回平铺，并用 cacheKnown 如实标注（不假装省了钱）。
  const hasCache = p.cacheIn != null && res.cacheHit != null && res.cacheMiss != null;
  const cost = hasCache
    ? (res.cacheHit / 1e6) * p.cacheIn + (res.cacheMiss / 1e6) * p.in + (res.tokensOut / 1e6) * p.out
    : flat;
  return { cost, flatCost: flat, costKnown: true, cacheKnown: hasCache };
}

// ---------- 三种模式 ----------
async function runSingle(task, ref) {
  const res = await agentLoop(ref, task);
  const j = judge(res.text, task);
  const c = costOf(ref, res);
  return { ...j, ...c, ...res, models: [resolve(ref).display], detail: [] };
}
async function runRouted(task, refs, synthRef) {
  const specialist = await Promise.all(refs.map(async (ref) => {
    try { return { ref, res: await agentLoop(ref, task, { maxRounds: 3 }) }; }
    catch (e) { return { ref, error: e.message }; }
  }));
  const ok = specialist.filter(s => s.res);
  if (ok.length === 0) throw new Error("所有专家调用失败: " + specialist.map(s => s.error).join("; "));
  const parentRes = await chatOnce(synthRef, [
    { role: "system", content: "你是父代理，综合以下专家（只读）的结论给出最终答案：取证据最扎实、结论收敛度最高的说法，不盲从任何一名专家，注明采纳理由。" },
    { role: "user", content: "任务: " + task.prompt + "\n\n专家意见:\n" + ok.map(s => "[" + resolve(s.ref).display + "]\n" + s.res.text).join("\n\n") + "\n\n父代理最终答案：" }
  ]);
  const parentText = parentRes.message?.content ?? "";
  const j = judge(parentText, task);
  let cost = null, flatCost = null, known = true, cacheKnown = true;
  for (const s of ok) {
    const c = costOf(s.ref, s.res);
    if (!c.costKnown) known = false;
    if (!c.cacheKnown) cacheKnown = false;
    cost = (cost ?? 0) + (c.cost ?? 0);
    flatCost = (flatCost ?? 0) + (c.flatCost ?? 0);
  }
  const pc = costOf(synthRef, { tokensIn: parentRes.tokensIn, tokensOut: parentRes.tokensOut, cacheHit: parentRes.cacheHit, cacheMiss: parentRes.cacheMiss });
  if (!pc.costKnown) known = false;
  if (!pc.cacheKnown) cacheKnown = false;
  cost = (cost ?? 0) + (pc.cost ?? 0);
  flatCost = (flatCost ?? 0) + (pc.flatCost ?? 0);
  const sumHit = ok.reduce((a, s) => a + (s.res.cacheHit ?? 0), 0) + (parentRes.cacheHit ?? 0);
  const sumMiss = ok.reduce((a, s) => a + (s.res.cacheMiss ?? 0), 0) + (parentRes.cacheMiss ?? 0);
  return {
    ...j, cost, flatCost, costKnown: known, cacheKnown, text: parentText,
    tokensIn: ok.reduce((a, s) => a + (s.res.tokensIn ?? 0), 0) + (parentRes.tokensIn ?? 0),
    tokensOut: ok.reduce((a, s) => a + (s.res.tokensOut ?? 0), 0) + (parentRes.tokensOut ?? 0),
    cacheHit: cacheKnown ? sumHit : null,
    cacheMiss: cacheKnown ? sumMiss : null,
    ms: Math.max(...ok.map(s => s.res.ms), parentRes.ms),
    models: [...ok.map(s => resolve(s.ref).display), resolve(synthRef).display + "(综合)"],
    detail: [...ok.map(s => ({ model: resolve(s.ref).display, pass: judge(s.res.text, task).pass, rounds: s.res.rounds, ms: s.res.ms })), ...specialist.filter(s => s.error).map(s => ({ model: resolve(s.ref).display, error: s.error }))]
  };
}
async function runTask(task, mode) {
  if (mode === "routed") {
    const tier = cfg.routing["tier" + task.tier];
    if (!tier) throw new Error("任务 " + task.id + " 无路由档位");
    const models = tier.models, synth = tier.synthesizeWith;
    return models.length === 1 ? runSingle(task, models[0]) : runRouted(task, models, synth);
  }
  const base = cfg.baselines[mode];
  if (!base) throw new Error("未知模式 " + mode);
  return runSingle(task, base.models[0]);
}

// ---------- 主流程 ----------
// 评测代码库根目录：默认使用仓库自带的公开示例代码（samples/），
// 可通过环境变量 BENCH_REPO 覆盖为任何本地只读代码库。
const BENCH_REPO = process.env.BENCH_REPO ? path.resolve(process.env.BENCH_REPO) : path.join(__dirname, "samples");
const tasksDir = path.join(__dirname, "tasks");
let tasks = fs.readdirSync(tasksDir).filter(f => f.endsWith(".json")).map(f => JSON.parse(fs.readFileSync(path.join(tasksDir, f), "utf-8")));
for (const t of tasks) t.root = BENCH_REPO;
if (onlyTask) tasks = tasks.filter(t => t.id === onlyTask);
  if (limit > 0) tasks = tasks.slice(0, limit);

const results = { generatedAt: new Date().toISOString(), modes, tasks: [] };
for (const mode of modes) {
  console.log("\n===== 模式: " + mode + " =====");
  for (const task of tasks) {
    try {
      const r = await runTask(task, mode);
      const row = {
        taskId: task.id, title: task.title, category: task.category, tier: task.tier, mode,
        pass: r.pass, score: r.score, hits: r.hits, missed: r.missed,
        tokensIn: r.tokensIn, tokensOut: r.tokensOut, cost: r.cost == null ? null : +r.cost.toFixed(4),
        flatCost: r.flatCost == null ? null : +r.flatCost.toFixed(4),
        cacheHit: r.cacheHit ?? null, cacheMiss: r.cacheMiss ?? null, cacheKnown: r.cacheKnown ?? false,
        costKnown: r.costKnown, ms: r.ms, models: r.models, detail: r.detail ?? [],
        text: r.text.slice(0, 2000)
      };
      results.tasks.push(row);
      console.log("  [" + (r.pass ? "PASS" : "FAIL") + "] " + task.id + " (tier" + task.tier + ") score=" + r.score + " ms=" + r.ms + " cost=" + (r.cost == null ? "partial/unknown" : r.cost.toFixed(4)) + " | " + r.models.join(" + "));
      for (const d of r.detail) if (d.error) console.log("      [专家失败] " + d.model + ": " + d.error);
    } catch (e) {
      results.tasks.push({ taskId: task.id, title: task.title, mode, error: e.message });
      console.log("  [ERR ] " + task.id + " " + e.message);
    }
  }
}

const agg = {};
for (const mode of modes) {
  const rows = results.tasks.filter(r => r.mode === mode && !r.error);
  const passed = rows.filter(r => r.pass).length;
  agg[mode] = {
    tasks: rows.length,
    passRate: rows.length ? +(passed / rows.length).toFixed(2) : null,
    totalCost: rows.every(r => r.cost != null) ? +rows.reduce((a, r) => a + r.cost, 0).toFixed(4) : null,
    costKnownAll: rows.every(r => r.costKnown),
    avgMs: rows.length ? Math.round(rows.reduce((a, r) => a + r.ms, 0) / rows.length) : null,
    totalTokensIn: rows.reduce((a, r) => a + (r.tokensIn ?? 0), 0),
    totalTokensOut: rows.reduce((a, r) => a + (r.tokensOut ?? 0), 0),
    // 上下文缓存统计。拿不到 hit/miss 时如实置 null —— 不把"没采到"写成"0 次命中"。
    totalCacheHit: rows.some(r => r.cacheHit != null) ? rows.reduce((a, r) => a + (r.cacheHit ?? 0), 0) : null,
    totalCacheMiss: rows.some(r => r.cacheMiss != null) ? rows.reduce((a, r) => a + (r.cacheMiss ?? 0), 0) : null,
    cacheHitRate: (() => {
      const h = rows.reduce((a, r) => a + (r.cacheHit ?? 0), 0), m = rows.reduce((a, r) => a + (r.cacheMiss ?? 0), 0);
      return (h + m) > 0 ? +(h / (h + m)).toFixed(3) : null;
    })(),
    totalFlatCost: rows.every(r => r.flatCost != null) ? +rows.reduce((a, r) => a + r.flatCost, 0).toFixed(4) : null,
    costSavedByCache: (() => {
      if (!rows.every(r => r.cost != null && r.flatCost != null)) return null;
      const f = rows.reduce((a, r) => a + r.flatCost, 0), c = rows.reduce((a, r) => a + r.cost, 0);
      return f > 0 ? +(f - c).toFixed(4) : null;
    })()
  };
}
results.aggregates = agg;
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log("\n===== 聚合结果 =====");
console.table(agg);
console.log("结果已写入:", outPath);
console.log("生成报告: node gen-report.mjs " + outPath);
