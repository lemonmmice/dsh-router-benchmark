using System;
using System.Collections.Generic;

namespace DemoApp.Orders
{
    // 订单服务：下单流程状态机 + 订单持久化
    public sealed class OrderService
    {
        private readonly List<Order> _orders = new();
        public const int MaxItemsPerOrder = 20;

        public enum OrderStatus { Draft, Submitted, Paid, Cancelled }

        public Order CreateOrder(string customerId)
        {
            var order = new Order { Id = Guid.NewGuid(), CustomerId = customerId, Status = OrderStatus.Draft, CreatedAt = DateTime.Now };
            _orders.Add(order);
            return order;
        }

        public bool SubmitOrder(Guid orderId)
        {
            var order = _orders.Find(o => o.Id == orderId);
            if (order == null || order.Status != OrderStatus.Draft) return false;
            order.Status = OrderStatus.Submitted;
            return true;
        }

        public bool CancelOrder(Guid orderId)
        {
            var order = _orders.Find(o => o.Id == orderId);
            if (order == null || order.Status == OrderStatus.Paid) return false;
            order.Status = OrderStatus.Cancelled;
            return true;
        }

        public List<Order> GetOrders(string customerId) => _orders.FindAll(o => o.CustomerId == customerId);
    }

    public class Order
    {
        public Guid Id { get; set; }
        public string CustomerId { get; set; } = "";
        public OrderService.OrderStatus Status { get; set; }
        public DateTime CreatedAt { get; set; }
    }
}
