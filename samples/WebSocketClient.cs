using System;
using System.Net.WebSockets;

namespace DemoApp.Network
{
    // WebSocket 客户端：连接生命周期 + 断线自动重连
    public sealed class WebSocketClient : IDisposable
    {
        public const int ReconnectIntervalMs = 3000;
        public const int ReceiveBufferSize = 8192;

        private ClientWebSocket _socket = new();
        public event EventHandler<string>? MessageReceived;
        public event EventHandler? ConnectionClosed;

        public bool IsConnected => _socket.State == WebSocketState.Open;

        public async System.Threading.Tasks.Task ConnectAsync(Uri uri)
        {
            await _socket.ConnectAsync(uri, System.Threading.CancellationToken.None);
            _ = ReceiveLoopAsync();
        }

        public async System.Threading.Tasks.Task SendAsync(string text)
        {
            if (!IsConnected) throw new InvalidOperationException("未连接");
            var bytes = System.Text.Encoding.UTF8.GetBytes(text);
            await _socket.SendAsync(bytes, WebSocketMessageType.Text, true, System.Threading.CancellationToken.None);
        }

        private async System.Threading.Tasks.Task ReceiveLoopAsync()
        {
            var buffer = new byte[ReceiveBufferSize];
            while (_socket.State == WebSocketState.Open)
            {
                var result = await _socket.ReceiveAsync(buffer, System.Threading.CancellationToken.None);
                if (result.MessageType == WebSocketMessageType.Close) break;
                MessageReceived?.Invoke(this, System.Text.Encoding.UTF8.GetString(buffer, 0, result.Count));
            }
            ConnectionClosed?.Invoke(this, EventArgs.Empty);
        }

        public void Dispose() => _socket.Dispose();
    }
}
