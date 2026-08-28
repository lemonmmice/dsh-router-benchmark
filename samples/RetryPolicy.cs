using System;
using System.Threading.Tasks;

namespace DemoApp.Resilience
{
    // 重试策略：固定上限 + 指数退避
    public sealed class RetryPolicy
    {
        public const int MaxRetryCount = 3;
        public const int BaseDelayMs = 200;

        public async Task<T> ExecuteAsync<T>(Func<Task<T>> action)
        {
            int attempt = 0;
            while (true)
            {
                try
                {
                    return await action();
                }
                catch (Exception ex) when (attempt < MaxRetryCount)
                {
                    attempt++;
                    int delayMs = BaseDelayMs * (int)Math.Pow(2, attempt - 1);
                    await Task.Delay(delayMs);
                }
            }
        }
    }
}
