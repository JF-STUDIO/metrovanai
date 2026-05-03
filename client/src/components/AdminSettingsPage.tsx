import type { ReactNode } from 'react';

interface AdminSettingsPageProps {
  adminFeatureDrafts: any[];
  adminPageTitle: (title: string, subtitle?: ReactNode, actions?: ReactNode) => ReactNode;
  adminSettingsTab: 'basic' | 'api' | 'account';
  adminSystemBusy: boolean;
  adminSystemDraft: any;
  adminSystemSettings: any | null;
  adminWorkflowSummary: any | null;
  maxHdrBatchSize: number;
  maxWorkflowInFlight: number;
  minHdrBatchSize: number;
  minWorkflowInFlight: number;
  onLoadSystemSettings: () => void | Promise<void>;
  onLoadWorkflows: () => void | Promise<void>;
  onSaveSystemSettings: () => void | Promise<void>;
  onSetConsolePage: (page: 'plans' | 'content' | 'engine') => void;
  onSetSystemDraft: (updater: any) => void;
  onSetTab: (tab: 'basic' | 'api' | 'account') => void;
  planPackages: any[];
  session: any | null;
  signOut: () => void | Promise<void>;
}

export function AdminSettingsPage({
  adminFeatureDrafts,
  adminPageTitle,
  adminSettingsTab,
  adminSystemBusy,
  adminSystemDraft,
  adminSystemSettings,
  adminWorkflowSummary,
  maxHdrBatchSize,
  maxWorkflowInFlight,
  minHdrBatchSize,
  minWorkflowInFlight,
  onLoadSystemSettings,
  onLoadWorkflows,
  onSaveSystemSettings,
  onSetConsolePage,
  onSetSystemDraft,
  onSetTab,
  planPackages,
  session,
  signOut
}: AdminSettingsPageProps) {
  return (
    <div className="page-content active">
      {adminPageTitle('系统设置', '站点配置、AI 引擎、管理员账号', <button className="btn btn-ghost" type="button" onClick={() => void onLoadSystemSettings()} disabled={adminSystemBusy}>{adminSystemBusy ? '读取中...' : '刷新配置'}</button>)}
      <div className="settings-tabs">
        <button type="button" className={`settings-tab${adminSettingsTab === 'basic' ? ' active' : ''}`} onClick={() => onSetTab('basic')}>基础</button>
        <button type="button" className={`settings-tab${adminSettingsTab === 'api' ? ' active' : ''}`} onClick={() => { onSetTab('api'); void onLoadWorkflows(); }}>AI &amp; API</button>
        <button type="button" className={`settings-tab${adminSettingsTab === 'account' ? ' active' : ''}`} onClick={() => onSetTab('account')}>管理员账号</button>
      </div>
      {adminSettingsTab === 'basic' && (
        <div className="card">
          <div className="card-body">
            <div className="settings-row">
              <div className="label-side"><div className="name">云处理 HDR 批量</div><div className="desc">每个基础处理任务包含的 HDR 组数，支持 {minHdrBatchSize}–{maxHdrBatchSize}，新任务即时生效</div></div>
              <div className="admin-inline-form">
                <input value={adminSystemDraft.runpodHdrBatchSize} onChange={(event) => onSetSystemDraft((current: any) => ({ ...current, runpodHdrBatchSize: event.target.value }))} inputMode="numeric" min={minHdrBatchSize} max={maxHdrBatchSize} />
                <button className="btn btn-primary" type="button" onClick={() => void onSaveSystemSettings()} disabled={adminSystemBusy}>{adminSystemBusy ? '保存中...' : '保存'}</button>
              </div>
            </div>
            <div className="settings-row">
              <div className="label-side"><div className="name">精修并发</div><div className="desc">后续修图工作流同时提交的照片数，建议 48；支持 {minWorkflowInFlight}–{maxWorkflowInFlight}，新任务即时生效</div></div>
              <div className="admin-inline-form">
                <input value={adminSystemDraft.runningHubMaxInFlight} onChange={(event) => onSetSystemDraft((current: any) => ({ ...current, runningHubMaxInFlight: event.target.value }))} inputMode="numeric" min={minWorkflowInFlight} max={maxWorkflowInFlight} />
                <button className="btn btn-primary" type="button" onClick={() => void onSaveSystemSettings()} disabled={adminSystemBusy}>{adminSystemBusy ? '保存中...' : '保存'}</button>
              </div>
            </div>
            <SettingsRow name="当前生效设置" desc="最近从服务器读取的批量和并发值">
              <span className="tag tag-cyan">{adminSystemSettings?.runpodHdrBatchSize ?? '未读取'} 组 / 基础处理批量</span>
              <span className="tag tag-gray admin-inline-gap">{adminSystemSettings?.runningHubMaxInFlight ?? '未读取'} 张 / 精修并发</span>
            </SettingsRow>
            <SettingsRow name="套餐数量" desc="前台 Plans 页展示的充值档位数">
              <span className="tag tag-gray">{adminSystemSettings?.billingPackages?.length ?? planPackages.length} 档</span>
              <button className="btn btn-ghost admin-inline-gap" type="button" onClick={() => onSetConsolePage('plans')}>管理套餐 →</button>
            </SettingsRow>
            <SettingsRow name="功能卡片" desc="前台 Studio 展示的 AI 功能卡片数">
              <span className="tag tag-gray">{adminSystemSettings?.studioFeatures?.length ?? adminFeatureDrafts.length} 个</span>
              <button className="btn btn-ghost admin-inline-gap" type="button" onClick={() => onSetConsolePage('content')}>管理卡片 →</button>
            </SettingsRow>
          </div>
        </div>
      )}
      {adminSettingsTab === 'api' && (
        <div className="card">
          <div className="card-body">
            <SettingsRow name="API 密钥状态" desc="云端处理和工作流 API 配置">
              <span className={adminWorkflowSummary?.apiKeyConfigured ? 'tag tag-green' : 'tag tag-orange'}>{adminWorkflowSummary?.apiKeyConfigured ? '已配置' : '未配置'}</span>
            </SettingsRow>
            <SettingsRow name="执行器" desc="当前 AI 工作流执行状态">
              <span className="tag tag-cyan">{adminWorkflowSummary?.executor.provider ? '已连接' : '未读取'}</span>
            </SettingsRow>
            <SettingsRow name="当前主流程" desc="活跃的工作流名称">
              <span className="mono">{adminWorkflowSummary?.active ?? '—'}</span>
            </SettingsRow>
            <SettingsRow name="工作流并发" desc="后台最大同时运行任务数">
              <span className="tag tag-gray">{adminSystemSettings?.runningHubMaxInFlight ?? adminWorkflowSummary?.settings.workflowMaxInFlight ?? '—'} 张</span>
            </SettingsRow>
            <SettingsRow name="引擎数量" desc="已加载的工作流条目数">
              <button className="btn btn-ghost" type="button" onClick={() => onSetConsolePage('engine')}>查看 AI 引擎 →</button>
            </SettingsRow>
          </div>
        </div>
      )}
      {adminSettingsTab === 'account' && (
        <div className="card">
          <div className="card-body">
            <SettingsRow name="当前管理员账号" desc="已登录的超级管理员">
              <div className="name">{session?.displayName ?? '—'}</div>
              <div className="email admin-account-email">{session?.email ?? '—'}</div>
            </SettingsRow>
            <SettingsRow name="角色" desc="账号权限等级">
              <span className={session?.role === 'admin' ? 'tag tag-purple' : 'tag tag-gray'}>{session?.role === 'admin' ? '超级管理员' : '普通用户'}</span>
            </SettingsRow>
            <SettingsRow name="活跃会话" desc="当前已登录设备数量">
              <span className="tag tag-cyan">{session ? '1 个活跃会话' : '未登录'}</span>
            </SettingsRow>
            <SettingsRow name="退出登录" desc="结束当前管理员会话">
              <button className="btn btn-ghost" type="button" onClick={() => void signOut()}>退出后台</button>
            </SettingsRow>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsRow({ children, desc, name }: { children: ReactNode; desc: string; name: string }) {
  return (
    <div className="settings-row">
      <div className="label-side"><div className="name">{name}</div><div className="desc">{desc}</div></div>
      <div>{children}</div>
    </div>
  );
}
