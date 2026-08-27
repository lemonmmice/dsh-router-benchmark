using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace DemoApp.Agent
{
    // 简化版 Agent 循环演示：工具调用循环 + 轮次上限
    public sealed class AgentLoopDemo
    {
        private const int MaxRounds = 6;

        public async Task<string> RunAsync(string userInput, Func<string, string> callModel)
        {
            var messages = new List<JsonNode>
            {
                new JsonObject { ["role"] = "system", ["content"] = "你是只读助手，不知道就说不知道，不要编造。" },
                new JsonObject { ["role"] = "user", ["content"] = userInput }
            };

            bool hasToolResult = false;
            for (int round = 1; round <= MaxRounds; round++)
            {
                string toolChoice = hasToolResult ? "auto" : "required"; // 首轮强制工具调用
                var reply = JsonNode.Parse(callModel(JsonSerializer.Serialize(messages)))!.AsObject();
                messages.Add(reply);

                var calls = reply["tool_calls"] as JsonArray;
                if (calls is { Count: > 0 })
                {
                    foreach (var call in calls)
                    {
                        messages.Add(new JsonObject
                        {
                            ["role"] = "tool",
                            ["tool_call_id"] = call!["id"]!.ToString(),
                            ["content"] = ExecuteTool(call["function"]!["name"]!.ToString())
                        });
                    }
                    hasToolResult = true;
                    continue;
                }
                return reply["content"]?.ToString() ?? "";
            }
            return "(达到轮次上限)";
        }

        private string ExecuteTool(string name) => name switch
        {
            "ListFiles" => "file-a.cs\nfile-b.cs",
            "ReadFile" => "content...",
            _ => "未知工具"
        };
    }
}
