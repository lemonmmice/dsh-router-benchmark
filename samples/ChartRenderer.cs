using System;
using System.Collections.Generic;

namespace DemoApp.Charts
{
    // 图表渲染器：大数据量场景使用抽稀采样 + 局部重绘
    public sealed class ChartRenderer
    {
        public const int MaxPointsPerFrame = 10000;
        public const int DownsampleThreshold = 50000;

        private readonly List<DataPoint> _points = new();
        public event EventHandler? RenderRequested;

        public void AddPoints(IEnumerable<DataPoint> points)
        {
            _points.AddRange(points);
            if (_points.Count > DownsampleThreshold)
            {
                Downsample();
            }
            RenderRequested?.Invoke(this, EventArgs.Empty);
        }

        public void Clear() => _points.Clear();

        private void Downsample()
        {
            // 抽稀：每 2 点取 1 个，保持趋势
            for (int i = _points.Count - 1; i >= 0; i -= 2) _points.RemoveAt(i);
        }
    }

    public struct DataPoint
    {
        public double X { get; set; }
        public double Y { get; set; }
    }
}
