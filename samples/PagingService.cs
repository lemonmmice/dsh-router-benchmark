using System;
using System.Collections.Generic;
using System.Text;

namespace DemoApp.Data
{
    // 分页查询服务：大结果集场景使用分片 LIMIT 策略避免全表排序
    public sealed class PagingService
    {
        // 历史记录默认按"当天日期"而非当前时刻过滤（避免跨日边界漏数据）
        public DateTime GetDefaultStartOfDay() => DateTime.Today;

        // 动态 UNION ALL 子查询：每个分片只取一页，再合并排序
        public string BuildPagedSql(string table, int pageSize, int offset, int shards = 4)
        {
            var sb = new StringBuilder();
            for (int i = 0; i < shards; i++)
            {
                if (i > 0) sb.Append(" UNION ALL ");
                sb.Append($"(SELECT * FROM {table} WHERE shard_id = {i} ORDER BY id LIMIT {pageSize} OFFSET {offset})");
            }
            return sb.ToString();
        }

        public IEnumerable<int> PageSizes => new[] { 20, 50, 100 };
    }
}
