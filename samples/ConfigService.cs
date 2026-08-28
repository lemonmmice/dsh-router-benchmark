using System;
using System.Collections.Generic;

namespace DemoApp.Config
{
    // 配置服务：支持 JSON 文件 + 环境变量覆盖
    public sealed class ConfigService
    {
        private readonly Dictionary<string, string> _values = new();
        public const string DefaultConfigFile = "appsettings.json";

        public ConfigService LoadFromFile(string path = DefaultConfigFile)
        {
            // 读取 JSON 配置写入 _values
            return this;
        }

        public ConfigService ApplyEnvironmentOverrides()
        {
            // 环境变量 APP_XXX 覆盖同名配置项
            return this;
        }

        public string Get(string key, string fallback = "") =>
            _values.TryGetValue(key, out var v) ? v : fallback;

        public bool GetBool(string key, bool fallback = false) =>
            bool.TryParse(Get(key), out var v) ? v : fallback;

        public int GetInt(string key, int fallback = 0) =>
            int.TryParse(Get(key), out var v) ? v : fallback;
    }
}
