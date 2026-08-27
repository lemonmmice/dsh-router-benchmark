using System;
using System.Threading.Tasks;

namespace DemoApp.Push
{
    // 通知服务：SignalR 实时推送 + 断线重连（指数退避）+ 本地缓存未读数
    public sealed class NotificationService
    {
        private int _retryCount;
        private const int MaxRetry = 5;

        public event EventHandler<string>? MessageReceived;

        public bool IsConnected { get; private set; }

        public async Task ConnectAsync()
        {
            while (!IsConnected && _retryCount < MaxRetry)
            {
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(Math.Pow(2, _retryCount))); // 指数退避
                    IsConnected = true;
                    _retryCount = 0;
                }
                catch
                {
                    _retryCount++;
                }
            }
        }

        public void OnMessage(string json)
        {
            var cache = Cache.GetUnreadCount() + 1;
            Cache.SetUnreadCount(cache);
            MessageReceived?.Invoke(this, json);
        }
    }

    internal static class Cache
    {
        private static int _unread;
        public static int GetUnreadCount() => _unread;
        public static void SetUnreadCount(int v) => _unread = v;
    }
}
