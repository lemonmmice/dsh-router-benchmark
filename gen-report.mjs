#!/usr/bin/env node
// 生成评测报告 report.html（含 SVG 图表，无依赖）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inPath = process.argv[2] || fs.readdirSync(path.join(__dirname, "results")).filter(f => f.endsWith(".json")).sort().pop();
if (!inPath) { console.error("未找到 results/*.json，请先跑 runner.mjs"); process.exit(1); }
const data = JSON.parse(fs.readFileSync(inPath, "utf-8"));
const agg = data.aggregates ?? {};
const modes = Object.keys(agg);

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 条形图: 通过率 / 成本 / 平均时延
function bars(title, key, unit, color) {
  const max = Math.max(...modes.map(m => agg[m][key] ?? 0), 1e-9);
  const rows = modes.map(m => {
    const v = agg[m][key];
    const label = v == null ? "未知" : (key === "passRate" ? (v * 100).toFixed(0) + "%" : key === "totalCost" ? v.toFixed(4) : v);
    const w = v == null ? 0 : Math.max(2, (v / max) * 260);
    return '<div style="margin:6px 0"><span style="display:inline-block;width:130px;font-weight:600">' + esc(m) + '</span><span style="display:inline-block;background:' + color + ';height:16px;width:' + w + 'px;border-radius:3px"></span><span style="margin-left:8px;color:#555">' + label + ' ' + unit + '</span></div>';
  }).join("");
  return '<h3>' + esc(title) + '</h3>' + rows;
}

const tableRows = data.tasks.map(r => {
  if (r.error) return "<tr><td>" + esc(r.taskId) + "</td><td>" + esc(r.mode) + "</td><td colspan=6 style='color:#c00'>" + esc(r.error) + "</td></tr>";
  const cost = r.cost == null ? "未知" : r.cost.toFixed(4);
  return "<tr><td>" + esc(r.taskId) + "</td><td>tier" + r.tier + " " + esc(r.category) + "</td><td>" + esc(r.mode) + "</td><td style='color:" + (r.pass ? "#1a7f37" : "#c00") + ";font-weight:700'>" + (r.pass ? "通过" : "未通过") + "</td><td>" + r.score.toFixed(2) + "</td><td>" + (r.ms ?? "-") + "</td><td>" + cost + "</td><td title='" + esc(r.models.join(" + ")) + "'>" + esc(r.models.slice(0, 2).join("+")) + "</td></tr>";
}).join("");

const html = "<!DOCTYPE html><html lang='zh'><head><meta charset='utf-8'><title>多模型路由评测报告</title>" +
"<style>body{font-family:'Microsoft YaHei',sans-serif;max-width:960px;margin:24px auto;color:#262626;line-height:1.5}" +
"h1{border-bottom:2px solid #8faadc;padding-bottom:8px}h2{margin-top:28px;color:#1f4e79}h3{margin-bottom:4px}" +
"table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #ddd;padding:5px 8px;text-align:left}" +
"th{background:#eef3fb}.meta{color:#777;font-size:12px}</style></head><body>" +
"<h1>多模型路由评测报告</h1><p class='meta'>生成时间: " + esc(data.generatedAt) + " | 数据文件: " + esc(inPath) + " | 任务数: " + (agg[modes[0]]?.tasks ?? data.tasks.filter(t => !t.error).length / Math.max(modes.length, 1)) + "</p>" +
"<h2>聚合指标</h2>" +
bars("通过率（%）", "passRate", "", "#2f6fed") +
bars("总成本（元）", "totalCost", "元", "#e8912d") +
bars("平均时延（ms）", "avgMs", "ms", "#8a6d3b") +
"<h2>逐任务明细</h2><table><tr><th>任务</th><th>类型</th><th>模式</th><th>结果</th><th>命中率</th><th>时延ms</th><th>成本元</th><th>模型</th></tr>" +
tableRows + "</table>" +
"<h2>结论要点</h2><ul>" +
"<li>路由模式的意义不是「每次都赢」，而是「用与任务难度匹配的模型组合，以可控成本接近最强基线」。</li>" +
"<li>tier1 检索类应看到 flash 与 pro 通过率接近、成本显著更低；tier3 多专家应看到路由模式通过率追上或超过 pro-only。</li>" +
"<li>若某档路由明显劣于基线，检查该任务的 gold 与提示词是否公平，再调整路由档位。</li></ul>" +
"</body></html>";

const out = path.join(__dirname, "report.html");
fs.writeFileSync(out, html);
console.log("报告已生成:", out);
