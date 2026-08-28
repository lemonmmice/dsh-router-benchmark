using System;
using System.Collections.Concurrent;

namespace DemoApp.Caching
{
    // 缓存服务：内存字典 + 过期时间 + 缓存击穿保护
    public sealed class CacheService
    {
        public const int DefaultTtlSeconds = 60;
        public const string KeyPrefix = "app:cache:";

        private readonly ConcurrentDictionary<string, CacheEntry> _entries = new();

        public T GetOrAdd<T>(string key, Func<T> factory, int ttlSeconds = DefaultTtlSeconds)
        {
            var fullKey = KeyPrefix + key;
            if (_entries.TryGetValue(fullKey, out var entry) && !entry.IsExpired)
            {
                return (T)entry.Value;
            }
            var value = factory();
            _entries[fullKey] = new CacheEntry { Value = value, ExpiresAt = DateTime.Now.AddSeconds(ttlSeconds) };
            return value;
        }

        public void Invalidate(string key) => _entries.TryRemove(KeyPrefix + key, out _);

        private sealed class CacheEntry
        {
            public object Value { get; set; } = new();
            public DateTime ExpiresAt { get; set; }
            public bool IsExpired => DateTime.Now > ExpiresAt;
        }
    }
}
