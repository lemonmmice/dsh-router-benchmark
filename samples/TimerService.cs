using System;
using System.Windows.Threading;

namespace DemoApp.Timers
{
    // 定时器服务：业务模块通过它创建统一风格的定时任务
    public sealed class TimerService : IDisposable
    {
        private readonly DispatcherTimer _timer;

        public TimerService(int intervalMs = 5000)
        {
            _timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(intervalMs) };
            _timer.Tick += OnTick;
        }

        public event EventHandler? Tick;

        public void Start() => _timer.Start();
        public void Stop() => _timer.Stop();
        public bool IsRunning => _timer.IsEnabled;

        private void OnTick(object? sender, EventArgs e) => Tick?.Invoke(this, e);

        public void Dispose()
        {
            Stop();
            _timer.Tick -= OnTick;
        }
    }
}
