import type { ReactNode } from 'react';
import {
  ADMIN_FEATURE_CATEGORY_OPTIONS,
  ADMIN_FEATURE_STATUS_OPTIONS,
  ADMIN_FEATURE_TONE_OPTIONS,
  ADMIN_MAX_BATCH_CODES,
  MAX_RUNNINGHUB_MAX_IN_FLIGHT,
  MAX_RUNPOD_HDR_BATCH_SIZE,
  MIN_RUNNINGHUB_MAX_IN_FLIGHT,
  MIN_RUNPOD_HDR_BATCH_SIZE
} from '../app-utils';
import { AdminActivationCodesPage } from './AdminActivationCodesPage';
import { AdminBillingLedgerPage } from './AdminBillingLedgerPage';
import { AdminConsole } from './AdminConsole';
import { AdminContentPage } from './AdminContentPage';
import { AdminDashboardPage } from './AdminDashboardPage';
import { AdminEnginePage, AdminPromptsPage } from './AdminEnginePages';
import { AdminFailuresPage } from './AdminFailuresPage';
import { AdminLogsPage } from './AdminLogsPage';
import { AdminMaintenancePage } from './AdminMaintenancePage';
import { AdminOrdersPage } from './AdminOrdersPage';
import { AdminPlansConfigPage } from './AdminPlansConfigPage';
import { AdminProjectCostsPage } from './AdminProjectCostsPage';
import { AdminProjectDetailPanel } from './AdminProjectDetailPanel';
import { AdminRegenerationAuditPage } from './AdminRegenerationAuditPage';
import { AdminRefundDialog } from './AdminRefundDialog';
import { AdminSettingsPage } from './AdminSettingsPage';
import { AdminUsersPage } from './AdminUsersPage';
import { AdminWorksList } from './AdminWorksList';

interface AdminRouteProps {
  data: any;
}

export function AdminRoute({ data }: AdminRouteProps) {
  const {
    adminActionBusy,
    adminActivationBusy,
    adminActivationCodes,
    adminActivationDraft,
    adminActivationPackages,
    adminAdjustment,
    adminAuditLogs,
    adminBatchCodeDraft,
    adminBatchCodeOpen,
    adminBillingLedgerRef,
    adminBillingLedgerSearch,
    adminBillingUserTotal,
    adminBillingUserTotals,
    adminBillingUserUnitUsd,
    adminBillingUsers,
    adminBillingUsersBusy,
    adminBusy,
    adminCodesStatusFilter,
    adminConsolePage,
    adminDeepHealthBusy,
    adminDetailBillingEntries,
    adminDetailBusy,
    adminDetailProjects,
    adminExpandedFeatureIds,
    adminFailedPhotoRows,
    adminFailedPhotosBusy,
    adminFailedPhotosCauseCounts,
    adminFailedPhotosLoaded,
    adminFailedPhotosPage,
    adminFailedPhotosPageCount,
    adminFailedPhotosTotal,
    adminFailedPhotosTotalAll,
    adminFailureCauseFilter,
    adminFailureCauseOptions,
    adminFailuresSearch,
    adminFeatureDrafts,
    adminFeatureImageBusy,
    adminLoaded,
    adminLogsSearch,
    adminMaintenanceBusy,
    adminMaintenanceReports,
    adminMessage,
    adminOrders,
    adminOrdersBusy,
    adminOrdersSearch,
    adminOrdersStatusFilter,
    adminOpsBusy,
    adminOpsHealth,
    adminPage,
    adminPageCount,
    adminPlanDraft,
    adminPlanEditorOpen,
    adminPriorityProjects,
    adminProjectCostDatePreset,
    adminProjectCostEndDate,
    adminProjectCostSearch,
    adminProjectCostStartDate,
    adminProjectCostTotal,
    adminProjectCostTotals,
    adminProjectCostUnitUsd,
    adminProjectCosts,
    adminProjectCostsBusy,
    adminProjectHealthCounts,
    adminProjects,
    adminProjectsBusy,
    adminProjectsPage,
    adminProjectsPageCount,
    adminProjectsTotal,
    adminRegenerationAudit,
    adminRegenerationAuditBusy,
    adminRegenerationAuditMode,
    adminRegenerationAuditSearch,
    adminRegenerationAuditTotal,
    adminRegenerationAuditTotals,
    adminRefundBusy,
    adminRefundOrder,
    adminRefundPreview,
    adminRepairBusy,
    adminRoleFilter,
    adminSearch,
    adminSelectedProject,
    adminSelectedProjectCanMarkStalled,
    adminSelectedProjectCanRetryFailed,
    adminSelectedProjectDeepHealth,
    adminSelectedProjectFailedItems,
    adminSelectedProjectMissingItems,
    adminSelectedProjectProcessingItems,
    adminSelectedProjectResults,
    adminSelectedUser,
    adminSettingsTab,
    adminSingleCodeOpen,
    adminStatusFilter,
    adminSystemBusy,
    adminSystemDraft,
    adminSystemSettings,
    adminTotals,
    adminTotalUsers,
    adminUsers,
    adminVerifiedFilter,
    adminWorkflowBusy,
    adminWorkflowSummary,
    adminWorksSearch,
    billingPackages,
    closeAdminRefundDialog,
    exportAdminBillingUsersCSV,
    exportAdminOrdersCSV,
    exportAdminUsersCSV,
    formatAdminDate,
    formatAdminShortDate,
    formatAdminTodayLabel,
    formatPaymentOrderStatus,
    getAdminFeaturePublishIssues,
    getAdminFeatureWorkflowDisplay,
    getAdminInitials,
    getBillingEntryAdminLabel,
    getHdrItemStatusLabel,
    getProjectStatusLabel,
    getSelectedExposure,
    handleAddAdminFeatureCard,
    handleAdminAdjustBilling,
    handleAdminAllowUserAccess,
    handleAdminConfirmRefund,
    handleAdminCreateActivationCode,
    handleAdminCreateBatchActivationCodes,
    handleAdminDeleteActivationCode,
    handleAdminDeleteProject,
    handleAdminDeleteUser,
    handleAdminFeatureImageUpload,
    handleAdminLoadActivationCodes,
    handleAdminLoadBillingUsers,
    handleAdminLoadFailedPhotos,
    handleAdminLoadMaintenanceReports,
    handleAdminLoadOpsHealth,
    handleAdminLoadOrders,
    handleAdminLoadProjectCosts,
    handleAdminLoadProjects,
    handleAdminLoadRegenerationAudit,
    handleAdminLoadSystemSettings,
    handleAdminLoadUsers,
    handleAdminLoadWorkflows,
    handleAdminLogoutUser,
    handleAdminMoveFeatureCard,
    handleAdminOpenBatchActivationCodes,
    handleAdminOpenNewPlanPackage,
    handleAdminOpenRefund,
    handleAdminOpenUserBilling,
    handleAdminRecoverSelectedProject,
    handleAdminRepairSelectedProject,
    handleAdminRecommendedProjectAction,
    handleAdminRunDeepHealth,
    handleAdminSavePlanPackage,
    handleAdminSaveSystemSettings,
    handleAdminSelectProject,
    handleAdminSelectUser,
    handleAdminToggleActivationCode,
    handleAdminUpdateUser,
    handleAdminLoadMoreProjects,
    handleAdminEditPlanPackage,
    locale,
    navigateToRoute,
    resolveMediaUrl,
    session,
    setAdminActivationDraft,
    setAdminBatchCodeDraft,
    setAdminBatchCodeOpen,
    setAdminBillingLedgerSearch,
    setAdminBillingUsersLoaded,
    setAdminCodesStatusFilter,
    setAdminConsolePage,
    setAdminExpandedFeatureIds,
    setAdminFailedPhotosLoaded,
    setAdminFailureCauseFilter,
    setAdminFailuresSearch,
    setAdminLoaded,
    setAdminLogsSearch,
    setAdminOrdersSearch,
    setAdminOrdersStatusFilter,
    setAdminPage,
    setAdminPlanDraft,
    setAdminPlanEditorOpen,
    setAdminProjectCostDatePreset,
    setAdminProjectCostEndDate,
    setAdminProjectCostsLoaded,
    setAdminProjectCostSearch,
    setAdminProjectCostStartDate,
    setAdminRegenerationAuditLoaded,
    setAdminRegenerationAuditMode,
    setAdminRegenerationAuditSearch,
    setAdminRoleFilter,
    setAdminSearch,
    setAdminSettingsTab,
    setAdminSingleCodeOpen,
    setAdminStatusFilter,
    setAdminSystemDraft,
    setAdminVerifiedFilter,
    setAdminWorksSearch,
    signOut,
    updateAdminFeatureDraft
  } = data;

  const paidOrders = adminOrders.filter((order: any) => order.status === 'paid');
  const pendingProjectCount = adminProjects.filter((project: any) =>
    ['importing', 'uploading', 'processing'].includes(project.status)
  ).length;
  const planPackages = adminSystemSettings?.billingPackages?.length
    ? adminSystemSettings.billingPackages
    : adminActivationPackages.length
      ? adminActivationPackages
      : billingPackages;
  const totalProjectPhotos = adminProjects.reduce((sum: number, project: any) => sum + project.photoCount, 0) || adminTotals.photos;
  const totalProjectResults = adminProjects.reduce((sum: number, project: any) => sum + project.resultAssets.length, 0);
  const workflowItems = adminWorkflowSummary?.items ?? [];
  const enabledWorkflowCount = workflowItems.length;
  const paidOrderRevenue = paidOrders.reduce((sum: number, order: any) => sum + order.amountUsd, 0);
  const resolvedAdminPageCount = Math.max(1, adminPageCount);
  const availableCodeCount = adminActivationCodes.filter((item: any) => item.available).length;
  const usedCodeCount = adminActivationCodes.reduce((sum: number, item: any) => sum + item.redemptionCount, 0);
  const codeCapacity = adminActivationCodes.reduce((sum: number, item: any) => sum + (item.maxRedemptions ?? 0), 0);
  const codeUsageRate = codeCapacity ? Math.round((usedCodeCount / codeCapacity) * 1000) / 10 : 0;
  const dashboardActivities = [
    ...adminOrders.slice(0, 3).map((order: any) => ({
      id: `order-${order.id}`,
      tone: order.status === 'paid' ? 'default' : order.status === 'failed' ? 'danger' : 'warn',
      title: `${order.email} · ${formatPaymentOrderStatus(order.status)}`,
      meta: `${order.packageName} · $${order.amountUsd.toFixed(2)} · ${formatAdminShortDate(order.createdAt)}`
    })),
    ...adminProjects.slice(0, 4).map((project: any) => ({
      id: `project-${project.id}`,
      tone: project.status === 'failed' ? 'danger' : project.status === 'processing' ? 'warn' : 'default',
      title: `${project.name} · ${getProjectStatusLabel(project, locale)}`,
      meta: `${project.photoCount} 张 · ${project.resultAssets.length} 结果 · ${formatAdminShortDate(project.updatedAt)}`
    })),
    ...adminAuditLogs.slice(0, 3).map((entry: any) => ({
      id: `audit-${entry.id}`,
      tone: 'default',
      title: entry.action,
      meta: `${entry.actorEmail ?? entry.actorType} · ${formatAdminShortDate(entry.createdAt)}`
    }))
  ].slice(0, 6);

  const adminPageTitle = (title: string, subtitle: ReactNode, actions?: ReactNode) => (
    <div className="page-title-row">
      <div>
        <div className="page-title">{title}</div>
        <div className="page-sub">{subtitle}</div>
      </div>
      {actions ? <div className="admin-page-actions">{actions}</div> : null}
    </div>
  );
  const kpi = (label: string, value: ReactNode, trend?: ReactNode, tone: 'up' | 'down' = 'up') => (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {trend ? <div className={`kpi-trend ${tone}`}>{trend}</div> : null}
    </div>
  );
  const tagClassForStatus = (status: string) => {
    if (['paid', 'active', 'completed', 'ready', 'published'].includes(status)) return 'tag tag-green';
    if (['failed', 'disabled', 'cancelled'].includes(status)) return 'tag tag-red';
    if (status === 'refunded') return 'tag tag-purple';
    if (['processing', 'uploading', 'checkout_created', 'pending'].includes(status)) return 'tag tag-orange';
    return 'tag tag-gray';
  };
  const planToneClass = (index: number) => ['tag-gray', 'tag-cyan', 'tag-purple', 'tag-orange'][index % 4];
  const projectToneClass = (index: number) => `work-thumb work-thumb-${(index % 8) + 1}`;
  const userAvatarClass = (index: number) => `user-avatar user-avatar-${(index % 5) + 1}`;
  const getProjectHealthLabel = (project: any) => {
    const status = project.adminHealth?.status;
    if (status === 'healthy') return '健康';
    if (status === 'attention') return '需检查';
    if (status === 'processing') return '处理中';
    return '待观察';
  };
  const getProjectHealthTagClass = (project: any) => {
    const status = project.adminHealth?.status;
    if (status === 'healthy') return 'tag tag-green';
    if (status === 'attention') return 'tag tag-red';
    if (status === 'processing') return 'tag tag-orange';
    return 'tag tag-gray';
  };
  const getAdminRepairActionLabel = (action: string) => {
    if (action === 'retry-failed-processing') return '重试失败照片';
    if (action === 'regenerate-download') return '重新生成下载包';
    if (action === 'mark-stalled-failed') return '标记卡住失败';
    if (action === 'acknowledge-maintenance') return '标记已审核';
    if (action === 'deep-health') return '深度巡检';
    return action;
  };
  const getAdminFailureProviderLabel = (provider: string | null | undefined, stage: string | null | undefined) => {
    if (provider === 'runpod' || stage === 'runpod') return '基础处理';
    if (provider === 'runninghub' || stage === 'runninghub') return '精修处理';
    if (stage === 'failed') return '处理阶段';
    return '未定位';
  };
  const getAdminFailureTaskLabel = (diagnostic: any) => {
    const taskId = diagnostic.runpodJobId || diagnostic.runpodBatchJobId || diagnostic.runningHubTaskId;
    if (!taskId) return '无任务号';
    return taskId.length > 18 ? `${taskId.slice(0, 10)}...${taskId.slice(-6)}` : taskId;
  };
  const getAdminPriorityLabel = (score: number) => {
    if (score >= 100) return '高优先级';
    if (score >= 40) return '中优先级';
    return '低优先级';
  };

  const pages: Record<string, ReactNode> = {
    dashboard: (
      <AdminDashboardPage
        adminOpsBusy={adminOpsBusy}
        adminOpsHealth={adminOpsHealth}
        adminOrders={adminOrders}
        adminOrdersBusy={adminOrdersBusy}
        adminPageTitle={adminPageTitle}
        adminProjectsBusy={adminProjectsBusy}
        adminTotals={adminTotals}
        dashboardActivities={dashboardActivities}
        exportAdminOrdersCSV={exportAdminOrdersCSV}
        formatAdminDate={formatAdminDate}
        formatAdminShortDate={formatAdminShortDate}
        formatAdminTodayLabel={formatAdminTodayLabel}
        formatPaymentOrderStatus={formatPaymentOrderStatus}
        getAdminInitials={getAdminInitials}
        handleAdminLoadOpsHealth={() => void handleAdminLoadOpsHealth()}
        handleRefreshAll={() => void Promise.all([handleAdminLoadUsers(), handleAdminLoadOrders(), handleAdminLoadProjects(), handleAdminLoadOpsHealth()])}
        kpi={kpi}
        onOpenOrders={() => setAdminConsolePage('orders')}
        paidOrderRevenue={paidOrderRevenue}
        paidOrders={paidOrders}
        pendingProjectCount={pendingProjectCount}
        planToneClass={planToneClass}
        tagClassForStatus={tagClassForStatus}
        totalProjectPhotos={totalProjectPhotos}
        totalProjectResults={totalProjectResults}
        userAvatarClass={userAvatarClass}
      />
    ),
    users: (
      <AdminUsersPage
        adminActionBusy={adminActionBusy}
        adminAdjustment={adminAdjustment}
        adminBillingLedgerRef={adminBillingLedgerRef}
        adminBusy={adminBusy}
        adminDetailBillingEntries={adminDetailBillingEntries}
        adminDetailBusy={adminDetailBusy}
        adminDetailProjects={adminDetailProjects}
        adminLoaded={adminLoaded}
        adminPage={adminPage}
        adminPageTitle={adminPageTitle}
        adminRoleFilter={adminRoleFilter}
        adminSearch={adminSearch}
        adminSelectedUser={adminSelectedUser}
        adminStatusFilter={adminStatusFilter}
        adminTotalUsers={adminTotalUsers}
        adminUsers={adminUsers}
        adminVerifiedFilter={adminVerifiedFilter}
        exportAdminUsersCSV={exportAdminUsersCSV}
        formatAdminDate={formatAdminDate}
        getAdminInitials={getAdminInitials}
        getBillingEntryAdminLabel={getBillingEntryAdminLabel}
        getProjectStatusLabel={getProjectStatusLabel}
        handleAdminAdjustBilling={(userId) => void handleAdminAdjustBilling(userId)}
        handleAdminAllowUserAccess={(userId) => void handleAdminAllowUserAccess(userId)}
        handleAdminDeleteUser={(userId) => void handleAdminDeleteUser(userId)}
        handleAdminLoadUsers={() => void handleAdminLoadUsers()}
        handleAdminLogoutUser={(userId) => void handleAdminLogoutUser(userId)}
        handleAdminOpenUserBilling={(userId) => void handleAdminOpenUserBilling(userId)}
        handleAdminSelectProject={(projectId) => void handleAdminSelectProject(projectId)}
        handleAdminSelectUser={(userId) => void handleAdminSelectUser(userId)}
        handleAdminUpdateUser={(userId, patch) => void handleAdminUpdateUser(userId, patch)}
        locale={locale}
        resolvedAdminPageCount={resolvedAdminPageCount}
        setAdminAdjustment={data.setAdminAdjustment}
        setAdminLoaded={setAdminLoaded}
        setAdminPage={setAdminPage}
        setAdminRoleFilter={setAdminRoleFilter}
        setAdminSearch={setAdminSearch}
        setAdminStatusFilter={setAdminStatusFilter}
        setAdminVerifiedFilter={setAdminVerifiedFilter}
        tagClassForStatus={tagClassForStatus}
        userAvatarClass={userAvatarClass}
      />
    ),
    failures: (
      <AdminFailuresPage
        adminFailedPhotoRows={adminFailedPhotoRows}
        adminFailedPhotosBusy={adminFailedPhotosBusy}
        adminFailedPhotosCauseCounts={adminFailedPhotosCauseCounts}
        adminFailedPhotosLoaded={adminFailedPhotosLoaded}
        adminFailedPhotosPage={adminFailedPhotosPage}
        adminFailedPhotosPageCount={adminFailedPhotosPageCount}
        adminFailedPhotosTotal={adminFailedPhotosTotal}
        adminFailedPhotosTotalAll={adminFailedPhotosTotalAll}
        adminFailureCauseFilter={adminFailureCauseFilter}
        adminFailureCauseOptions={adminFailureCauseOptions}
        adminFailuresSearch={adminFailuresSearch}
        adminPageTitle={adminPageTitle}
        formatAdminShortDate={formatAdminShortDate}
        getAdminFailureProviderLabel={getAdminFailureProviderLabel}
        getAdminFailureTaskLabel={getAdminFailureTaskLabel}
        getAdminRepairActionLabel={getAdminRepairActionLabel}
        handleAdminLoadFailedPhotos={(page) => void handleAdminLoadFailedPhotos(page)}
        kpi={kpi}
        onOpenProject={(projectId) => {
          setAdminConsolePage('works');
          void handleAdminSelectProject(projectId);
        }}
        setAdminFailedPhotosLoaded={setAdminFailedPhotosLoaded}
        setAdminFailureCauseFilter={setAdminFailureCauseFilter}
        setAdminFailuresSearch={setAdminFailuresSearch}
      />
    ),
    works: (
      <div className="page-content active">
        {adminPageTitle(
          '修图作品',
          <>
            所有用户的 AI 修图作品 · 当前载入 <span className="mono accent-text">{adminProjects.length.toLocaleString()}</span>
            {adminProjectsTotal ? <> / {adminProjectsTotal.toLocaleString()}</> : null} 项
          </>,
          <>
            <button className="btn btn-ghost" type="button" onClick={() => void handleAdminLoadProjects()} disabled={adminProjectsBusy}>
              {adminProjectsBusy ? '刷新中...' : '刷新作品'}
            </button>
            {adminProjectsPage < adminProjectsPageCount ? (
              <button className="btn btn-ghost" type="button" onClick={() => void handleAdminLoadMoreProjects()} disabled={adminProjectsBusy}>
                继续载入
              </button>
            ) : null}
            <button className="btn btn-primary" type="button" onClick={() => setAdminConsolePage('content')}>管理功能卡片</button>
          </>
        )}
        <div className="kpi-grid">
          {kpi('健康项目', <>{adminProjectHealthCounts.healthy}<span className="unit">项</span></>, <><span>可下载</span><span className="vs">结果完整</span></>)}
          {kpi('需检查', <>{adminProjectHealthCounts.attention}<span className="unit">项</span></>, <><span>失败/缺失/可疑</span><span className="vs">优先处理</span></>, adminProjectHealthCounts.attention ? 'down' : 'up')}
          {kpi('处理中', <>{adminProjectHealthCounts.processing}<span className="unit">项</span></>, <><span>队列</span><span className="vs">实时刷新</span></>)}
          {kpi('下载异常', <>{adminProjects.filter((project: any) => project.adminHealth?.latestDownloadJob?.status === 'failed').length}<span className="unit">项</span></>, <><span>最近任务</span><span className="vs">下载包</span></>, adminProjects.some((project: any) => project.adminHealth?.latestDownloadJob?.status === 'failed') ? 'down' : 'up')}
        </div>
        <div className="card admin-priority-queue">
          <div className="admin-mini-head">
            <strong>待处理队列</strong>
            <span>{adminPriorityProjects.length ? `优先处理 ${adminPriorityProjects.length} 项` : '暂无异常'}</span>
          </div>
          {adminPriorityProjects.length ? (
            <div className="admin-priority-list">
              {adminPriorityProjects.map(({ project, score, errorCount, warningCount }: any) => (
                <button className="admin-priority-row" type="button" key={project.id} onClick={() => void handleAdminSelectProject(project.id)}>
                  <span className={score >= 100 ? 'tag tag-red' : score >= 40 ? 'tag tag-orange' : 'tag tag-gray'}>
                    {getAdminPriorityLabel(score)}
                  </span>
                  <strong>{project.name}</strong>
                  <small>{project.adminHealth?.rootCauseSummary ?? '需要检查项目状态。'}</small>
                  <em>{errorCount} 错误 · {warningCount} 警告 · {formatAdminShortDate(project.updatedAt)}</em>
                </button>
              ))}
            </div>
          ) : (
            <div className="admin-health-ok">当前载入项目没有需要优先处理的健康问题。</div>
          )}
        </div>
        <AdminWorksList
          adminProjects={adminProjects}
          adminProjectsBusy={adminProjectsBusy}
          adminProjectsPage={adminProjectsPage}
          adminProjectsPageCount={adminProjectsPageCount}
          adminProjectsTotal={adminProjectsTotal}
          adminWorksSearch={adminWorksSearch}
          formatAdminShortDate={formatAdminShortDate}
          getProjectHealthLabel={getProjectHealthLabel}
          getProjectHealthTagClass={getProjectHealthTagClass}
          onSearchChange={setAdminWorksSearch}
          onSelectProject={(projectId) => void handleAdminSelectProject(projectId)}
          projectToneClass={projectToneClass}
          resolveMediaUrl={resolveMediaUrl}
        />
        <AdminProjectDetailPanel
          adminActionBusy={adminActionBusy}
          adminDeepHealthBusy={adminDeepHealthBusy}
          adminRepairBusy={adminRepairBusy}
          canMarkStalled={adminSelectedProjectCanMarkStalled}
          canRetryFailed={adminSelectedProjectCanRetryFailed}
          deepHealth={adminSelectedProjectDeepHealth}
          failedItems={adminSelectedProjectFailedItems}
          formatAdminShortDate={formatAdminShortDate}
          getAdminFailureProviderLabel={getAdminFailureProviderLabel}
          getAdminFailureTaskLabel={getAdminFailureTaskLabel}
          getAdminRepairActionLabel={getAdminRepairActionLabel}
          getHdrItemStatusLabel={getHdrItemStatusLabel}
          getProjectHealthLabel={getProjectHealthLabel}
          getProjectHealthTagClass={getProjectHealthTagClass}
          getProjectStatusLabel={getProjectStatusLabel}
          getSelectedExposure={getSelectedExposure}
          locale={locale}
          missingItems={adminSelectedProjectMissingItems}
          onDeleteProject={(projectId) => void handleAdminDeleteProject(projectId)}
          onRecoverProject={() => void handleAdminRecoverSelectedProject()}
          onRecommendedAction={(action) => void handleAdminRecommendedProjectAction(action)}
          onRepairProject={(action) => void handleAdminRepairSelectedProject(action)}
          onRunDeepHealth={() => void handleAdminRunDeepHealth()}
          processingItems={adminSelectedProjectProcessingItems}
          project={adminSelectedProject}
          resolveMediaUrl={resolveMediaUrl}
          results={adminSelectedProjectResults}
          tagClassForStatus={tagClassForStatus}
        />
      </div>
    ),
    orders: (
      <AdminOrdersPage
        adminOrdersBusy={adminOrdersBusy}
        adminOrdersSearch={adminOrdersSearch}
        adminOrdersStatusFilter={adminOrdersStatusFilter}
        adminPageTitle={adminPageTitle}
        adminRefundBusy={adminRefundBusy}
        formatAdminDate={formatAdminDate}
        formatAdminShortDate={formatAdminShortDate}
        formatPaymentOrderStatus={formatPaymentOrderStatus}
        getAdminInitials={getAdminInitials}
        kpi={kpi}
        onExportOrdersCSV={exportAdminOrdersCSV}
        onLoadOrders={() => void handleAdminLoadOrders()}
        onOpenRefund={(order) => void handleAdminOpenRefund(order)}
        onSearchChange={setAdminOrdersSearch}
        onStatusFilterChange={setAdminOrdersStatusFilter}
        orders={adminOrders}
        paidOrderRevenue={paidOrderRevenue}
        paidOrders={paidOrders}
        planToneClass={planToneClass}
        tagClassForStatus={tagClassForStatus}
        userAvatarClass={userAvatarClass}
      />
    ),
    billing: (
      <AdminBillingLedgerPage
        adminBillingLedgerSearch={adminBillingLedgerSearch}
        adminBillingUserTotal={adminBillingUserTotal}
        adminBillingUserTotals={adminBillingUserTotals}
        adminBillingUserUnitUsd={adminBillingUserUnitUsd}
        adminBillingUsers={adminBillingUsers}
        adminBillingUsersBusy={adminBillingUsersBusy}
        adminPageTitle={adminPageTitle}
        getAdminInitials={getAdminInitials}
        kpi={kpi}
        onExportUsersCSV={() => void exportAdminBillingUsersCSV()}
        onLoadBillingUsers={() => void handleAdminLoadBillingUsers()}
        onOpenUserBilling={(userId) => void handleAdminOpenUserBilling(userId)}
        onSearchChange={(value) => {
          setAdminBillingLedgerSearch(value);
          setAdminBillingUsersLoaded(false);
        }}
        userAvatarClass={userAvatarClass}
      />
    ),
    costs: (
      <AdminProjectCostsPage
        adminPageTitle={adminPageTitle}
        adminProjectCostDatePreset={adminProjectCostDatePreset}
        adminProjectCostEndDate={adminProjectCostEndDate}
        adminProjectCostSearch={adminProjectCostSearch}
        adminProjectCostStartDate={adminProjectCostStartDate}
        adminProjectCostTotal={adminProjectCostTotal}
        adminProjectCostTotals={adminProjectCostTotals}
        adminProjectCostUnitUsd={adminProjectCostUnitUsd}
        adminProjectCosts={adminProjectCosts}
        adminProjectCostsBusy={adminProjectCostsBusy}
        formatAdminShortDate={formatAdminShortDate}
        getAdminInitials={getAdminInitials}
        kpi={kpi}
        onDatePresetChange={(value) => {
          setAdminProjectCostDatePreset(value);
          setAdminProjectCostsLoaded(false);
        }}
        onEndDateChange={(value) => {
          setAdminProjectCostEndDate(value);
          setAdminProjectCostsLoaded(false);
        }}
        onLoadProjectCosts={() => void handleAdminLoadProjectCosts()}
        onSearchChange={(value) => {
          setAdminProjectCostSearch(value);
          setAdminProjectCostsLoaded(false);
        }}
        onStartDateChange={(value) => {
          setAdminProjectCostStartDate(value);
          setAdminProjectCostsLoaded(false);
        }}
        userAvatarClass={userAvatarClass}
      />
    ),
    regenerationAudit: (
      <AdminRegenerationAuditPage
        adminPageTitle={adminPageTitle}
        adminRegenerationAudit={adminRegenerationAudit}
        adminRegenerationAuditBusy={adminRegenerationAuditBusy}
        adminRegenerationAuditMode={adminRegenerationAuditMode}
        adminRegenerationAuditSearch={adminRegenerationAuditSearch}
        adminRegenerationAuditTotal={adminRegenerationAuditTotal}
        adminRegenerationAuditTotals={adminRegenerationAuditTotals}
        formatAdminShortDate={formatAdminShortDate}
        getAdminInitials={getAdminInitials}
        kpi={kpi}
        onLoadRegenerationAudit={() => void handleAdminLoadRegenerationAudit()}
        onModeChange={(value) => {
          setAdminRegenerationAuditMode(value);
          setAdminRegenerationAuditLoaded(false);
        }}
        onSearchChange={(value) => {
          setAdminRegenerationAuditSearch(value);
          setAdminRegenerationAuditLoaded(false);
        }}
        userAvatarClass={userAvatarClass}
      />
    ),
    plans: (
      <AdminPlansConfigPage
        adminOrders={adminOrders}
        adminPageTitle={adminPageTitle}
        adminPlanDraft={adminPlanDraft}
        adminPlanEditorOpen={adminPlanEditorOpen}
        adminSystemBusy={adminSystemBusy}
        adminTotals={adminTotals}
        onClosePlanEditor={() => setAdminPlanEditorOpen(false)}
        onEditPlanPackage={handleAdminEditPlanPackage}
        onLoadSystemSettings={() => void handleAdminLoadSystemSettings()}
        onOpenNewPlanPackage={handleAdminOpenNewPlanPackage}
        onPlanDraftChange={setAdminPlanDraft}
        onSavePlanPackage={() => void handleAdminSavePlanPackage()}
        paidOrders={paidOrders}
        planPackages={planPackages}
      />
    ),
    codes: (
      <AdminActivationCodesPage
        adminActivationBusy={adminActivationBusy}
        adminActivationCodes={adminActivationCodes}
        adminActivationDraft={adminActivationDraft}
        adminBatchCodeDraft={adminBatchCodeDraft}
        adminBatchCodeOpen={adminBatchCodeOpen}
        adminCodesStatusFilter={adminCodesStatusFilter}
        adminPageTitle={adminPageTitle}
        adminSingleCodeOpen={adminSingleCodeOpen}
        availableCodeCount={availableCodeCount}
        codeUsageRate={codeUsageRate}
        formatAdminDate={formatAdminDate}
        maxBatchCodes={ADMIN_MAX_BATCH_CODES}
        onActivationDraftChange={setAdminActivationDraft}
        onBatchCodeDraftChange={setAdminBatchCodeDraft}
        onCloseBatchCode={() => setAdminBatchCodeOpen(false)}
        onCloseSingleCode={() => setAdminSingleCodeOpen(false)}
        onCreateActivationCode={() => void handleAdminCreateActivationCode()}
        onCreateBatchActivationCodes={() => void handleAdminCreateBatchActivationCodes()}
        onDeleteActivationCode={(item) => void handleAdminDeleteActivationCode(item)}
        onLoadActivationCodes={() => void handleAdminLoadActivationCodes()}
        onOpenBatchActivationCodes={handleAdminOpenBatchActivationCodes}
        onOpenSingleCode={() => {
          setAdminSingleCodeOpen(true);
          setAdminActivationDraft({ code: '', label: '', packageId: '', discountPercentOverride: '', bonusPoints: '0', maxRedemptions: '', expiresAt: '', active: true });
        }}
        onStatusFilterChange={setAdminCodesStatusFilter}
        onToggleActivationCode={(item) => void handleAdminToggleActivationCode(item)}
        planPackages={planPackages}
        usedCodeCount={usedCodeCount}
      />
    ),
    engine: (
      <AdminEnginePage
        adminPageTitle={adminPageTitle}
        adminSystemSettings={adminSystemSettings}
        adminWorkflowBusy={adminWorkflowBusy}
        adminWorkflowSummary={adminWorkflowSummary}
        enabledWorkflowCount={enabledWorkflowCount}
        kpi={kpi}
        onLoadWorkflows={() => void handleAdminLoadWorkflows()}
        totalProjectPhotos={totalProjectPhotos}
        workflowItems={workflowItems}
      />
    ),
    prompts: (
      <AdminPromptsPage
        adminPageTitle={adminPageTitle}
        adminWorkflowBusy={adminWorkflowBusy}
        onLoadWorkflows={() => void handleAdminLoadWorkflows()}
        workflowItems={workflowItems}
      />
    ),
    content: (
      <AdminContentPage
        adminExpandedFeatureIds={adminExpandedFeatureIds}
        adminFeatureDrafts={adminFeatureDrafts}
        adminFeatureImageBusy={adminFeatureImageBusy}
        adminPageTitle={adminPageTitle}
        adminSystemBusy={adminSystemBusy}
        adminSystemSettings={adminSystemSettings}
        categoryOptions={ADMIN_FEATURE_CATEGORY_OPTIONS}
        getAdminFeaturePublishIssues={getAdminFeaturePublishIssues}
        getAdminFeatureWorkflowDisplay={getAdminFeatureWorkflowDisplay}
        onAddFeatureCard={handleAddAdminFeatureCard}
        onDeleteFeatureCard={data.handleDeleteAdminFeatureCard}
        onFeatureImageUpload={(featureId, field, file) => void handleAdminFeatureImageUpload(featureId, field, file)}
        onLoadSystemSettings={() => void handleAdminLoadSystemSettings()}
        onMoveFeatureCard={handleAdminMoveFeatureCard}
        onSaveSystemSettings={() => void handleAdminSaveSystemSettings()}
        onToggleFeatureExpanded={(featureId, isOpen) => {
          setAdminExpandedFeatureIds((current: any) => ({ ...current, [featureId]: isOpen }));
        }}
        planToneClass={planToneClass}
        statusOptions={ADMIN_FEATURE_STATUS_OPTIONS}
        toneOptions={ADMIN_FEATURE_TONE_OPTIONS}
        updateAdminFeatureDraft={updateAdminFeatureDraft}
      />
    ),
    logs: (
      <AdminLogsPage
        adminActionBusy={adminActionBusy}
        adminAuditLogs={adminAuditLogs}
        adminLogsSearch={adminLogsSearch}
        adminPageTitle={adminPageTitle}
        formatAdminDate={formatAdminDate}
        getAdminInitials={getAdminInitials}
        onLoadAuditLogs={() => void data.handleAdminLoadAuditLogs()}
        onSearchChange={setAdminLogsSearch}
        userAvatarClass={userAvatarClass}
      />
    ),
    maintenance: (
      <AdminMaintenancePage
        adminMaintenanceBusy={adminMaintenanceBusy}
        adminMaintenanceReports={adminMaintenanceReports}
        adminPageTitle={adminPageTitle}
        formatAdminShortDate={formatAdminShortDate}
        onLoadMaintenanceReports={() => void handleAdminLoadMaintenanceReports()}
      />
    ),
    settings: (
      <AdminSettingsPage
        adminFeatureDrafts={adminFeatureDrafts}
        adminPageTitle={adminPageTitle}
        adminSettingsTab={adminSettingsTab}
        adminSystemBusy={adminSystemBusy}
        adminSystemDraft={adminSystemDraft}
        adminSystemSettings={adminSystemSettings}
        adminWorkflowSummary={adminWorkflowSummary}
        maxHdrBatchSize={MAX_RUNPOD_HDR_BATCH_SIZE}
        maxWorkflowInFlight={MAX_RUNNINGHUB_MAX_IN_FLIGHT}
        minHdrBatchSize={MIN_RUNPOD_HDR_BATCH_SIZE}
        minWorkflowInFlight={MIN_RUNNINGHUB_MAX_IN_FLIGHT}
        onLoadSystemSettings={() => void handleAdminLoadSystemSettings()}
        onLoadWorkflows={() => void handleAdminLoadWorkflows()}
        onSaveSystemSettings={() => void handleAdminSaveSystemSettings()}
        onSetConsolePage={(page) => setAdminConsolePage(page)}
        onSetSystemDraft={setAdminSystemDraft}
        onSetTab={setAdminSettingsTab}
        planPackages={planPackages}
        session={session}
        signOut={() => void signOut()}
      />
    )
  };

  const refundDialog = adminRefundOrder && adminRefundPreview ? (
    <AdminRefundDialog
      order={adminRefundOrder}
      preview={adminRefundPreview}
      busy={adminRefundBusy}
      locale={locale}
      onClose={closeAdminRefundDialog}
      onConfirm={() => void handleAdminConfirmRefund()}
    />
  ) : null;

  return (
    <AdminConsole
      adminConsolePage={adminConsolePage}
      adminMessage={adminMessage}
      page={pages[adminConsolePage] ?? pages.dashboard}
      pendingProjectCount={pendingProjectCount}
      refundDialog={refundDialog}
      session={session}
      onNavigateStudio={() => navigateToRoute('studio')}
      onSetPage={setAdminConsolePage}
      onSignOut={() => void signOut()}
    />
  );
}
