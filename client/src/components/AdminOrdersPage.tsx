import type { ReactNode } from 'react';
import type { PaymentOrderRecord } from '../types';

interface AdminOrdersTableProps {
  adminRefundBusy?: boolean;
  compact?: boolean;
  formatAdminDate: (value: string | null) => string;
  formatAdminShortDate: (value: string | null) => string;
  formatPaymentOrderStatus: (status: PaymentOrderRecord['status']) => string;
  getAdminInitials: (value: string) => string;
  onOpenRefund?: (order: PaymentOrderRecord) => void | Promise<void>;
  orders: PaymentOrderRecord[];
  planToneClass: (index: number) => string;
  tagClassForStatus: (status: string) => string;
  userAvatarClass: (index: number) => string;
}

interface AdminOrdersPageProps extends AdminOrdersTableProps {
  adminOrdersBusy: boolean;
  adminOrdersSearch: string;
  adminOrdersStatusFilter: string;
  adminPageTitle: (title: string, subtitle?: ReactNode, actions?: ReactNode) => ReactNode;
  onExportOrdersCSV: () => void;
  onLoadOrders: () => void | Promise<void>;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  paidOrderRevenue: number;
  paidOrders: PaymentOrderRecord[];
  kpi: (label: string, value: ReactNode, delta?: ReactNode, tone?: 'up' | 'down') => ReactNode;
}

export function AdminOrdersPage({
  adminOrdersBusy,
  adminOrdersSearch,
  adminOrdersStatusFilter,
  adminPageTitle,
  onExportOrdersCSV,
  onLoadOrders,
  onSearchChange,
  onStatusFilterChange,
  orders,
  paidOrderRevenue,
  paidOrders,
  kpi,
  ...tableProps
}: AdminOrdersPageProps) {
  const filtered = orders.filter((order) =>
    (!adminOrdersSearch || order.email.toLowerCase().includes(adminOrdersSearch.toLowerCase()) || String(order.id).includes(adminOrdersSearch)) &&
    (adminOrdersStatusFilter === 'all' || order.status === adminOrdersStatusFilter)
  );

  return (
    <div className="page-content active">
      {adminPageTitle(
        '订单管理',
        <>本月营收 <span className="mono accent-text">${paidOrderRevenue.toFixed(2)}</span> · 退款 <span className="mono danger-text">{orders.filter((order) => order.status === 'refunded').length}</span></>,
        <>
          <button className="btn btn-ghost" type="button" onClick={onExportOrdersCSV} disabled={!orders.length}>导出账单 CSV</button>
          <button className="btn btn-primary" type="button" onClick={() => void onLoadOrders()} disabled={adminOrdersBusy}>{adminOrdersBusy ? '刷新中...' : '刷新订单'}</button>
        </>
      )}
      <div className="kpi-grid">
        {kpi('本月订单数', orders.length.toLocaleString(), <><span>▲ {paidOrders.length}</span><span className="vs">已支付</span></>)}
        {kpi('客单价', paidOrders.length ? `$${(paidOrderRevenue / paidOrders.length).toFixed(0)}` : '$0', <><span>▲ 实时</span><span className="vs">平均</span></>)}
        {kpi('完成率', orders.length ? `${Math.round((paidOrders.length / orders.length) * 100)}%` : '0%', <><span>▲</span><span className="vs">订单</span></>)}
        {kpi('失败率', orders.length ? `${Math.round((orders.filter((order) => order.status === 'failed').length / orders.length) * 100)}%` : '0%', <><span>▼</span><span className="vs">异常</span></>, 'down')}
      </div>
      <div className="card">
        <div className="toolbar">
          <input value={adminOrdersSearch} onChange={(event) => onSearchChange(event.target.value)} placeholder="搜索 订单号 / 邮箱" />
          <select value={adminOrdersStatusFilter} onChange={(event) => onStatusFilterChange(event.target.value)}>
            <option value="all">所有状态</option>
            <option value="paid">已支付</option>
            <option value="checkout_created">处理中</option>
            <option value="failed">失败</option>
            <option value="refunded">已退款</option>
          </select>
        </div>
        {orders.length ? (
          filtered.length ? (
            <AdminOrdersTable orders={filtered} {...tableProps} />
          ) : (
            <div className="empty-tip">没有匹配的订单{adminOrdersSearch ? `（关键词："${adminOrdersSearch}"）` : ''}</div>
          )
        ) : (
          <div className="empty-tip">{adminOrdersBusy ? '正在读取订单...' : '暂无订单'}</div>
        )}
      </div>
    </div>
  );
}

export function AdminOrdersTable({
  adminRefundBusy = false,
  compact = false,
  formatAdminDate,
  formatAdminShortDate,
  formatPaymentOrderStatus,
  getAdminInitials,
  onOpenRefund,
  orders,
  planToneClass,
  tagClassForStatus,
  userAvatarClass
}: AdminOrdersTableProps) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>订单号</th>
            <th>用户</th>
            <th>套餐</th>
            <th>金额</th>
            <th>渠道</th>
            <th>状态</th>
            <th>{compact ? '时间' : '支付时间'}</th>
            {!compact ? <th></th> : null}
          </tr>
        </thead>
        <tbody>
          {orders.map((order, index) => (
            <tr key={order.id}>
              <td className="cell-id">#{order.id}</td>
              <td>
                <div className="user-cell">
                  <div className={userAvatarClass(index)}>{getAdminInitials(order.email)}</div>
                  <div>
                    <div className="name">{order.email.split('@')[0]}</div>
                    <div className="email">{order.email}</div>
                  </div>
                </div>
              </td>
              <td><span className={`tag ${planToneClass(index)}`}>{order.packageName}</span></td>
              <td className="mono">${order.amountUsd.toFixed(2)}</td>
              <td>{order.stripeCheckoutSessionId ? 'Stripe' : 'Manual'}</td>
              <td><span className={tagClassForStatus(order.status)}>{formatPaymentOrderStatus(order.status)}</span></td>
              <td className="cell-id">{compact ? formatAdminShortDate(order.createdAt) : formatAdminDate(order.paidAt ?? order.createdAt)}</td>
              {!compact ? (
                <td>
                  {order.status === 'paid' && order.stripePaymentIntentId && onOpenRefund ? (
                    <button className="btn btn-ghost btn-xs" type="button" onClick={() => void onOpenRefund(order)} disabled={adminRefundBusy}>
                      退款
                    </button>
                  ) : (
                    <div className="tbl-icon">⋯</div>
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
