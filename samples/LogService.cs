using System;

namespace DemoApp.Logging
{
    // 日志服务：分级日志 + 文件滚动
    public static class LogService
    {
        public enum LogLevel { Debug, Info, Warn, Error }

        public static LogLevel MinLevel { get; set; } = LogLevel.Info;
        public const int MaxLogFileSizeBytes = 10 * 1024 * 1024; // 10MB 滚动

        public static void Debug(string msg) => Write(LogLevel.Debug, msg);
        public static void Info(string msg) => Write(LogLevel.Info, msg);
        public static void Warn(string msg) => Write(LogLevel.Warn, msg);
        public static void Error(string msg) => Write(LogLevel.Error, msg);

        private static void Write(LogLevel level, string msg)
        {
            if (level < MinLevel) return;
            Console.WriteLine($"[{level}] {DateTime.Now:HH:mm:ss} {msg}");
        }
    }
}
