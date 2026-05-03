import type { ReactNode } from 'react';
import type { PaymentOrderRecord } from '../types';
import { AdminOrdersTable } from './AdminOrdersPage';

interface AdminDashboardPageProps {
  adminOpsBusy: boolean;
  adminOpsHealth: any | null;
  adminOrders: PaymentOrderRecord[];
  adminOrdersBusy: boolean;
  adminPageTitle: (title: string, subtitle?: ReactNode, actions?: ReactNode) => ReactNode;
  adminProjectsBusy: boolean;
  adminTotals: { users: number };
  dashboardActivities: any[];
  exportAdminOrdersCSV: () => void;
  formatAdminDate: (value: string | null) => string;
  formatAdminShortDate: (value: string | null) => string;
  formatAdminTodayLabel: () => string;
  formatPaymentOrderStatus: (status: PaymentOrderRecord['status']) => string;
  getAdminInitials: (value: string) => string;
  handleAdminLoadOpsHealth: () => void | Promise<void>;
  handleRefreshAll: () => void | Promise<void>;
  kpi: (label: string, value: ReactNode, delta?: ReactNode, tone?: 'up' | 'down') => ReactNode;
  onOpenOrders: () => void;
  paidOrderRevenue: number;
  paidOrders: PaymentOrderRecord[];
  pendingProjectCount: number;
  planToneClass: (index: number) => string;
  tagClassForStatus: (status: string) => string;
  totalProjectPhotos: number;
  totalProjectResults: number;
  userAvatarClass: (index: number) => string;
}

export function AdminDashboardPage({
  adminOpsBusy,
  adminOpsHealth,
  adminOrders,
  adminOrdersBusy,
  adminPageTitle,
  adminProjectsBusy,
  adminTotals,
  dashboardActivities,
  exportAdminOrdersCSV,
  formatAdminDate,
  formatAdminShortDate,
  formatAdminTodayLabel,
  formatPaymentOrderStatus,
  getAdminInitials,
  handleAdminLoadOpsHealth,
  handleRefreshAll,
  kpi,
  onOpenOrders,
  paidOrderRevenue,
  paidOrders,
  pendingProjectCount,
  planToneClass,
  tagClassForStatus,
  totalProjectPhotos,
  totalProjectResults,
  userAvatarClass
}: AdminDashboardPageProps) {
  return (
    <div className="page-content active">
      {adminPageTitle(
        '仪表盘',
        <>{formatAdminTodayLabel()} · <span className="status-dot live" /> 系统运行中</>,
        <>
          <button className="btn btn-ghost" type="button" onClick={exportAdminOrdersCSV} disabled={!adminOrders.length}>导出订单 CSV</button>
          <button className="btn btn-primary" type="button" onClick={() => void handleRefreshAll()}>刷新全部数据</button>
        </>
      )}
      <div className="kpi-grid">
        {kpi('注册用户', <>{adminTotals.users.toLocaleString()}<span className="unit">人</span></>, <><span>▲ 实时</span><span className="vs">后台用户</span></>)}
        {kpi('已支付营收', <>${paidOrderRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</>, <><span>▲ {paidOrders.length}</span><span className="vs">笔订单</span></>)}
        {kpi('AI 修图调用', <>{totalProjectPhotos.toLocaleString()}<span className="unit">次</span></>, <><span>▲ {totalProjectResults}</span><span className="vs">结果图</span></>)}
        {kpi('待处理作品', <>{pendingProjectCount}<span className="unit">项</span></>, <><span>▲ 队列</span><span className="vs">实时</span></>, pendingProjectCount ? 'down' : 'up')}
        {kpi('运维告警', <>{adminOpsHealth?.alerts.length ?? 0}<span className="unit">项</span></>, <><span>{adminOpsBusy ? '读取中' : '监控'}</span><span className="vs">回传/积分/R2</span></>, adminOpsHealth?.alerts.length ? 'down' : 'up')}
      </div>
      <div className="dashboard-grid">
        <QueueCard adminOpsBusy={adminOpsBusy} adminOpsHealth={adminOpsHealth} handleAdminLoadOpsHealth={handleAdminLoadOpsHealth} />
        <DownloadQueueCard adminOpsHealth={adminOpsHealth} />
      </div>
      {adminOpsHealth?.alerts.length || adminOpsHealth?.recentAuditSignals?.length ? (
        <OpsSignalsCard adminOpsHealth={adminOpsHealth} formatAdminShortDate={formatAdminShortDate} />
      ) : null}
      <div className="dashboard-grid">
        <TrendCard />
        <ActivityCard adminOrdersBusy={adminOrdersBusy} adminProjectsBusy={adminProjectsBusy} dashboardActivities={dashboardActivities} />
      </div>
      <div className="card">
        <div className="card-header">
          <h3>近期订单</h3>
          <button className="btn btn-ghost" type="button" onClick={onOpenOrders}>查看全部 →</button>
        </div>
        {adminOrders.length ? (
          <AdminOrdersTable
            compact
            formatAdminDate={formatAdminDate}
            formatAdminShortDate={formatAdminShortDate}
            formatPaymentOrderStatus={formatPaymentOrderStatus}
            getAdminInitials={getAdminInitials}
            orders={adminOrders.slice(0, 5)}
            planToneClass={planToneClass}
            tagClassForStatus={tagClassForStatus}
            userAvatarClass={userAvatarClass}
          />
        ) : <div className="empty-tip">暂无订单数据</div>}
      </div>
    </div>
  );
}

function QueueCard({ adminOpsBusy, adminOpsHealth, handleAdminLoadOpsHealth }: Pick<AdminDashboardPageProps, 'adminOpsBusy' | 'adminOpsHealth' | 'handleAdminLoadOpsHealth'>) {
  const metrics: Array<[string, number]> = [
    ['上传中', adminOpsHealth?.queueStages?.uploadingProjects ?? 0],
    ['排队项目', adminOpsHealth?.queueStages?.queuedProjects ?? 0],
    ['处理中', adminOpsHealth?.queueStages?.processingProjects ?? 0],
    ['基础处理', adminOpsHealth?.queueStages?.runpodItems ?? 0],
    ['精修处理', adminOpsHealth?.queueStages?.runningHubItems ?? 0],
    ['回传完成', adminOpsHealth?.queueStages?.completedReturnItems ?? 0],
    ['失败', adminOpsHealth?.queueStages?.failedItems ?? 0]
  ];
  return (
    <div className="card">
      <div className="card-header">
        <div><h3>处理队列</h3><div className="card-sub">上传 → 基础处理 → 精修处理 → 回传</div></div>
        <button className="btn btn-ghost btn-xs" type="button" onClick={() => void handleAdminLoadOpsHealth()} disabled={adminOpsBusy}>{adminOpsBusy ? '刷新中...' : '刷新'}</button>
      </div>
      <MiniMetrics metrics={metrics} />
    </div>
  );
}

function DownloadQueueCard({ adminOpsHealth }: Pick<AdminDashboardPageProps, 'adminOpsHealth'>) {
  const metrics: Array<[string, number]> = [
    ['等待打包', adminOpsHealth?.downloadQueue?.queued ?? 0],
    ['内存任务', adminOpsHealth?.downloadQueue?.inMemoryJobs ?? 0],
    ['活跃请求', adminOpsHealth?.downloadQueue?.activeRequests ?? 0],
    ['Ready', adminOpsHealth?.downloadQueue?.statuses?.ready ?? 0],
    ['Failed', adminOpsHealth?.downloadQueue?.statuses?.failed ?? 0],
    ['Packaging', adminOpsHealth?.downloadQueue?.statuses?.packaging ?? 0]
  ];
  return (
    <div className="card">
      <div className="card-header">
        <div><h3>下载队列</h3><div className="card-sub">ZIP 打包 worker 与排队状态</div></div>
        <span className="tag tag-cyan">{adminOpsHealth?.downloadQueue?.activeWorkers ?? 0} / {adminOpsHealth?.downloadQueue?.maxWorkers ?? 3} workers</span>
      </div>
      <MiniMetrics metrics={metrics} />
    </div>
  );
}

function MiniMetrics({ metrics }: { metrics: Array<[string, number]> }) {
  return (
    <div className="mini-metrics-grid">
      {metrics.map(([label, value]) => (
        <div className="mini-metric" key={label}><span>{label}</span><strong>{Number(value).toLocaleString()}</strong></div>
      ))}
    </div>
  );
}

function OpsSignalsCard({ adminOpsHealth, formatAdminShortDate }: Pick<AdminDashboardPageProps, 'adminOpsHealth' | 'formatAdminShortDate'>) {
  return (
    <div className="card">
      <div className="card-header">
        <div><h3>关键监控</h3><div className="card-sub">接口异常、回传恢复、下载、退款和维护动作</div></div>
        <span className={adminOpsHealth?.alerts.length ? 'tag tag-orange' : 'tag tag-cyan'}>{adminOpsHealth?.alerts.length ?? 0} 个告警</span>
      </div>
      {adminOpsHealth?.alerts.length ? (
        <div className="admin-priority-list">
          {adminOpsHealth.alerts.map((alert: any) => (
            <div className="admin-priority-row" key={alert.code}>
              <span className={alert.level === 'error' ? 'tag tag-red' : 'tag tag-orange'}>{alert.level}</span>
              <strong>{alert.code}</strong>
              <small>当前 {typeof alert.value === 'number' ? alert.value.toLocaleString(undefined, { maximumFractionDigits: 4 }) : alert.value} · 阈值 {alert.threshold}</small>
              <em>{formatAdminShortDate(adminOpsHealth.generatedAt)}</em>
            </div>
          ))}
        </div>
      ) : (
        <div className="admin-health-ok">当前没有运维告警。</div>
      )}
      {adminOpsHealth?.recentAuditSignals?.length ? (
        <div className="admin-signal-list">
          {adminOpsHealth.recentAuditSignals.slice(0, 8).map((signal: any) => (
            <div className="admin-signal-row" key={signal.id}>
              <strong>{signal.action}</strong>
              <span>{signal.actorEmail || signal.targetUserId || signal.targetProjectId || 'system'}</span>
              <em>{formatAdminShortDate(signal.createdAt)}</em>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TrendCard() {
  return (
    <div className="card">
      <div className="card-header"><div><h3>营收 & 调用趋势</h3><div className="card-sub">最近 30 天</div></div><span className="chart-range-label">固定展示最近 30 天</span></div>
      <div className="card-body">
        <div className="chart-area" aria-hidden="true">
          <svg className="chart-svg" viewBox="0 0 600 240" preserveAspectRatio="none">
            <defs>
              <linearGradient id="adminGradRevenue" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7ce8ff" stopOpacity="0.4" /><stop offset="100%" stopColor="#7ce8ff" stopOpacity="0" /></linearGradient>
              <linearGradient id="adminGradCalls" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c69aff" stopOpacity="0.3" /><stop offset="100%" stopColor="#c69aff" stopOpacity="0" /></linearGradient>
            </defs>
            <line x1="0" y1="60" x2="600" y2="60" stroke="rgba(124,232,255,0.06)" strokeDasharray="2,4" />
            <line x1="0" y1="120" x2="600" y2="120" stroke="rgba(124,232,255,0.06)" strokeDasharray="2,4" />
            <line x1="0" y1="180" x2="600" y2="180" stroke="rgba(124,232,255,0.06)" strokeDasharray="2,4" />
            <path d="M 0 180 L 30 165 L 60 170 L 90 145 L 120 135 L 150 150 L 180 110 L 210 95 L 240 105 L 270 80 L 300 85 L 330 65 L 360 75 L 390 50 L 420 60 L 450 45 L 480 55 L 510 40 L 540 35 L 570 50 L 600 30 L 600 240 L 0 240 Z" fill="url(#adminGradRevenue)" />
            <path d="M 0 180 L 30 165 L 60 170 L 90 145 L 120 135 L 150 150 L 180 110 L 210 95 L 240 105 L 270 80 L 300 85 L 330 65 L 360 75 L 390 50 L 420 60 L 450 45 L 480 55 L 510 40 L 540 35 L 570 50 L 600 30" fill="none" stroke="#7ce8ff" strokeWidth="2" />
            <path d="M 0 200 L 30 195 L 60 190 L 90 175 L 120 180 L 150 170 L 180 155 L 210 145 L 240 150 L 270 130 L 300 135 L 330 115 L 360 125 L 390 100 L 420 110 L 450 95 L 480 105 L 510 90 L 540 85 L 570 100 L 600 80 L 600 240 L 0 240 Z" fill="url(#adminGradCalls)" opacity="0.6" />
            <path d="M 0 200 L 30 195 L 60 190 L 90 175 L 120 180 L 150 170 L 180 155 L 210 145 L 240 150 L 270 130 L 300 135 L 330 115 L 360 125 L 390 100 L 420 110 L 450 95 L 480 105 L 510 90 L 540 85 L 570 100 L 600 80" fill="none" stroke="#c69aff" strokeWidth="2" />
            <circle cx="540" cy="35" r="5" fill="#7ce8ff" /><circle cx="540" cy="35" r="10" fill="#7ce8ff" opacity="0.2" />
          </svg>
        </div>
        <div className="chart-legend"><span><i />营收 ($)</span><span><i className="purple" />AI 调用次数</span></div>
      </div>
    </div>
  );
}

function ActivityCard({ adminOrdersBusy, adminProjectsBusy, dashboardActivities }: Pick<AdminDashboardPageProps, 'adminOrdersBusy' | 'adminProjectsBusy' | 'dashboardActivities'>) {
  return (
    <div className="card">
      <div className="card-header"><h3>实时动态</h3><span className="live-label"><span className="status-dot live" />LIVE</span></div>
      <div className="card-body activity-list">
        {dashboardActivities.length ? dashboardActivities.map((item) => (
          <div key={item.id} className="activity-item">
            <div className={`activity-dot ${item.tone}`} />
            <div className="activity-content"><div className="activity-title">{item.title}</div><div className="activity-time">{item.meta}</div></div>
          </div>
        )) : (
          <div className="empty-tip">{adminOrdersBusy || adminProjectsBusy ? '正在读取实时动态...' : '暂无动态'}</div>
        )}
      </div>
    </div>
  );
}
