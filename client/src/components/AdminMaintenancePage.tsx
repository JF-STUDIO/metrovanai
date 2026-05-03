import type { ReactNode } from 'react';

interface AdminMaintenancePageProps {
  adminMaintenanceBusy: boolean;
  adminMaintenanceReports: any[];
  adminPageTitle: (title: string, subtitle?: ReactNode, actions?: ReactNode) => ReactNode;
  formatAdminShortDate: (value: string | null) => string;
  onLoadMaintenanceReports: () => void | Promise<void>;
}

export function AdminMaintenancePage({
  adminMaintenanceBusy,
  adminMaintenanceReports,
  adminPageTitle,
  formatAdminShortDate,
  onLoadMaintenanceReports
}: AdminMaintenancePageProps) {
  return (
    <div className="page-content active">
      {adminPageTitle(
        '维护报告',
        <>自动巡检历史 · 最近载入 <span className="mono accent-text">{adminMaintenanceReports.length}</span> 份</>,
        <button className="btn btn-ghost" type="button" onClick={() => void onLoadMaintenanceReports()} disabled={adminMaintenanceBusy}>
          {adminMaintenanceBusy ? '读取中...' : '刷新报告'}
        </button>
      )}
      <div className="maintenance-report-list">
        {adminMaintenanceReports.map((report) => (
          <article className="card maintenance-report-card" key={report.id}>
            <div className="admin-mini-head">
              <strong>{formatAdminShortDate(report.completedAt ?? report.startedAt ?? '')}</strong>
              <span className={report.ok ? 'tag tag-green' : 'tag tag-red'}>{report.ok ? '通过' : `${report.failedCount} 项异常`}</span>
            </div>
            <div className="admin-health-grid compact">
              <div><strong>{report.totals?.projects ?? '—'}</strong><span>项目</span></div>
              <div><strong>{report.totals?.hdrItems ?? '—'}</strong><span>HDR 项</span></div>
              <div><strong>{report.totals?.downloadJobs ?? '—'}</strong><span>下载任务</span></div>
              <div><strong>{report.alert?.sent ? '已发送' : report.alert?.reason ?? '未发送'}</strong><span>邮件告警</span></div>
            </div>
            {report.alerts.length ? (
              <div className="maintenance-alert-row">
                {report.alerts.map((alert: any) => (
                  <span key={alert.code}>{alert.code}: {alert.value}</span>
                ))}
              </div>
            ) : (
              <div className="admin-health-ok">这份报告没有应用数据异常。</div>
            )}
            {report.priorityQueue.length ? (
              <div className="maintenance-priority-list">
                {report.priorityQueue.map((item: any, index: number) => (
                  <div className="maintenance-priority-item" key={`${report.id}-${item.projectId}`}>
                    <span className={item.priority === 'high' ? 'tag tag-red' : item.priority === 'medium' ? 'tag tag-orange' : 'tag tag-gray'}>#{index + 1} {item.priority}</span>
                    <strong>{item.projectName}</strong>
                    <small>{item.rootCauseSummary}</small>
                    <em>{item.recommendedActionLabels?.join(' / ') || '后台查看'}</em>
                  </div>
                ))}
              </div>
            ) : null}
            {report.reviewedProjects?.length ? (
              <div className="maintenance-priority-list">
                {report.reviewedProjects.map((item: any) => (
                  <div className="maintenance-priority-item" key={`${report.id}-reviewed-${item.projectId}`}>
                    <span className="tag tag-green">已审核</span>
                    <strong>{item.projectName}</strong>
                    <small>{item.note || '当前问题无需处理。'}</small>
                    <em>{item.reviewedBy || '管理员'} · {item.reviewedAt ? formatAdminShortDate(item.reviewedAt) : '时间未知'}</em>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="maintenance-check-grid">
              {report.checks.map((check: any) => (
                <span className={check.ok ? 'tag tag-green' : 'tag tag-red'} key={`${report.id}-${check.id}`}>
                  {check.id}{check.alertCount ? ` · ${check.alertCount}` : ''}
                </span>
              ))}
            </div>
          </article>
        ))}
        {!adminMaintenanceReports.length ? (
          <div className="card">
            <div className="empty-tip">{adminMaintenanceBusy ? '正在读取维护报告...' : '暂无维护报告，等待定时任务生成。'}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
