import type { ReactNode } from 'react';

interface AdminEnginePageProps {
  adminPageTitle: (title: string, subtitle?: ReactNode, actions?: ReactNode) => ReactNode;
  adminSystemSettings: any | null;
  adminWorkflowBusy: boolean;
  adminWorkflowSummary: any | null;
  enabledWorkflowCount: number;
  kpi: (label: string, value: ReactNode, delta?: ReactNode, tone?: 'up' | 'down') => ReactNode;
  onLoadWorkflows: () => void | Promise<void>;
  totalProjectPhotos: number;
  workflowItems: any[];
}

interface AdminPromptsPageProps {
  adminPageTitle: (title: string, subtitle?: ReactNode, actions?: ReactNode) => ReactNode;
  adminWorkflowBusy: boolean;
  onLoadWorkflows: () => void | Promise<void>;
  workflowItems: any[];
}

export function AdminEnginePage({
  adminPageTitle,
  adminSystemSettings,
  adminWorkflowBusy,
  adminWorkflowSummary,
  enabledWorkflowCount,
  kpi,
  onLoadWorkflows,
  totalProjectPhotos,
  workflowItems
}: AdminEnginePageProps) {
  return (
    <div className="page-content active">
      {adminPageTitle(
        'AI 引擎',
        '只读监控 · 查看工作流、节点、API 状态和估算调用成本',
        <>
          <span className="tag tag-gray">只读</span>
          <button className="btn btn-primary" type="button" onClick={() => void onLoadWorkflows()} disabled={adminWorkflowBusy}>{adminWorkflowBusy ? '刷新中...' : '刷新引擎'}</button>
        </>
      )}
      <div className="kpi-grid">
        {kpi('总引擎数', <>{enabledWorkflowCount}<span className="unit">/ {Math.max(enabledWorkflowCount, 1)}</span></>, <span className="vs">{adminWorkflowSummary?.active ?? '未加载'}</span>)}
        {kpi('本月调用', totalProjectPhotos.toLocaleString(), <span>▲ 实时项目</span>)}
        {kpi('本月成本', `$${(totalProjectPhotos * 0.04).toFixed(0)}`, <span>▲ 估算</span>, 'down')}
        {kpi('处理批量', <>{adminSystemSettings?.runpodHdrBatchSize ?? 0}<span className="unit">组/批</span></>, <span>▼ 批量设置</span>)}
      </div>
      <div className="engine-grid">
        {workflowItems.length ? workflowItems.map((item, index) => {
          const isActive = adminWorkflowSummary?.active?.trim().toLowerCase() === item.name.trim().toLowerCase();
          const isMissingWorkflow = !item.workflowId;
          const isApiMissing = !adminWorkflowSummary?.apiKeyConfigured;
          const statusTag = isMissingWorkflow
            ? <span className="tag tag-orange">未配置</span>
            : isApiMissing
              ? <span className="tag tag-red">API 缺失</span>
              : isActive
                ? <span className="tag tag-purple">主流程</span>
                : <span className="tag tag-green">就绪</span>;
          return (
            <div key={`${item.name}-${item.workflowId ?? index}`} className={`engine-card${isMissingWorkflow || isApiMissing ? '' : ' live'}`}>
              <div className="engine-head">
                <div className="engine-icon">{['✨', '☁️', '🛋️', '🌿', '🧹', '🌅'][index % 6]}</div>
                <div>
                  <div className="engine-title">{item.name}</div>
                  <div className="engine-sub">流程 ID: {item.workflowId ?? '未配置'} · 类型: {item.type}</div>
                </div>
                {statusTag}
              </div>
              <div className="engine-stats">
                <div className="engine-stat"><div className="label">输入节点</div><div className="value">{item.inputCount}</div></div>
                <div className="engine-stat"><div className="label">输出节点</div><div className="value">{item.outputCount}</div></div>
                <div className="engine-stat"><div className="label">Prompt 节点</div><div className="value success-text">{item.promptNodeId ?? '—'}</div></div>
                <div className="engine-stat"><div className="label">颜色卡</div><div className="value">{item.colorCardNo ?? '—'}</div></div>
              </div>
            </div>
          );
        }) : (
          <div className="empty-tip">{adminWorkflowBusy ? '正在读取 AI 引擎...' : '暂无工作流数据'}</div>
        )}
      </div>
    </div>
  );
}

export function AdminPromptsPage({
  adminPageTitle,
  adminWorkflowBusy,
  onLoadWorkflows,
  workflowItems
}: AdminPromptsPageProps) {
  return (
    <div className="page-content active">
      {adminPageTitle(
        'Prompt 模板',
        '只读配置索引 · 当前后台展示 Prompt 节点和流程 ID',
        <>
          <span className="tag tag-gray">只读</span>
          <button className="btn btn-ghost" type="button" onClick={() => void onLoadWorkflows()} disabled={adminWorkflowBusy}>{adminWorkflowBusy ? '刷新中...' : '刷新模板'}</button>
        </>
      )}
      <div className="card">
        <div className="card-body prompt-grid">
          {workflowItems.length ? workflowItems.map((item) => (
            <article key={`${item.name}-prompt`} className="prompt-card">
              <span className="tag tag-purple">{item.type}</span>
              <h3>{item.name}</h3>
              <p>Prompt Node: <span className="mono">{item.promptNodeId ?? '未配置'}</span></p>
              <p>流程 ID: <span className="mono">{item.workflowId ?? '未配置'}</span></p>
            </article>
          )) : <div className="empty-tip">暂无 Prompt 模板数据</div>}
        </div>
      </div>
    </div>
  );
}
