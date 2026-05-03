import type { ReactNode } from 'react';

interface AdminContentPageProps {
  adminExpandedFeatureIds: Record<string, boolean>;
  adminFeatureDrafts: any[];
  adminFeatureImageBusy: string | null;
  adminPageTitle: (title: string, subtitle?: ReactNode, actions?: ReactNode) => ReactNode;
  adminSystemBusy: boolean;
  adminSystemSettings: any | null;
  categoryOptions: Array<{ label: string; value: string }>;
  getAdminFeaturePublishIssues: (feature: any) => string[];
  getAdminFeatureWorkflowDisplay: (feature: any) => { inputNodeId?: string; outputNodeId?: string; workflowId?: string };
  onAddFeatureCard: () => void;
  onDeleteFeatureCard: (featureId: string) => void;
  onFeatureImageUpload: (featureId: string, field: 'beforeImageUrl' | 'afterImageUrl', file: File) => void | Promise<void>;
  onLoadSystemSettings: () => void | Promise<void>;
  onMoveFeatureCard: (featureId: string, direction: 1 | -1) => void;
  onSaveSystemSettings: () => void | Promise<void>;
  onToggleFeatureExpanded: (featureId: string, isOpen: boolean) => void;
  planToneClass: (index: number) => string;
  statusOptions: Array<{ label: string; value: string }>;
  toneOptions: Array<{ label: string; value: string }>;
  updateAdminFeatureDraft: (featureId: string, patch: any) => void;
}

export function AdminContentPage({
  adminExpandedFeatureIds,
  adminFeatureDrafts,
  adminFeatureImageBusy,
  adminPageTitle,
  adminSystemBusy,
  adminSystemSettings,
  categoryOptions,
  getAdminFeaturePublishIssues,
  getAdminFeatureWorkflowDisplay,
  onAddFeatureCard,
  onDeleteFeatureCard,
  onFeatureImageUpload,
  onLoadSystemSettings,
  onMoveFeatureCard,
  onSaveSystemSettings,
  onToggleFeatureExpanded,
  planToneClass,
  statusOptions,
  toneOptions,
  updateAdminFeatureDraft
}: AdminContentPageProps) {
  return (
    <div className="page-content active">
      {adminPageTitle(
        '内容运营',
        '前台功能卡片、对比图、输入输出节点、每张积分',
        <>
          <button className="btn btn-ghost" type="button" onClick={() => void onLoadSystemSettings()} disabled={adminSystemBusy}>
            {adminSystemBusy ? '刷新中...' : '刷新卡片'}
          </button>
          <button className="btn btn-primary" type="button" onClick={onAddFeatureCard}>+ 添加功能卡片</button>
        </>
      )}
      <div className="card">
        <div className="card-header">
          <div>
            <h3>功能卡片配置</h3>
            <div className="card-sub">只有“前台显示”且发布前检查通过的卡片会出现在用户端。</div>
          </div>
          <button className="btn btn-ghost" type="button" onClick={() => void onSaveSystemSettings()} disabled={adminSystemBusy || !adminSystemSettings}>
            {adminSystemBusy ? '保存中...' : '保存全部并发布到前台'}
          </button>
        </div>
        <div className="card-body feature-admin-grid">
          {adminFeatureDrafts.length ? adminFeatureDrafts.map((feature, index) => {
            const workflowDisplay = getAdminFeatureWorkflowDisplay(feature);
            const publishIssues = getAdminFeaturePublishIssues(feature);
            const beforeImageBusy = adminFeatureImageBusy === `${feature.id}:beforeImageUrl`;
            const afterImageBusy = adminFeatureImageBusy === `${feature.id}:afterImageUrl`;
            return (
              <details
                key={feature.id}
                className="feature-admin-card"
                open={Boolean(adminExpandedFeatureIds[feature.id])}
                onToggle={(event) => {
                  const isOpen = event.currentTarget.open;
                  onToggleFeatureExpanded(feature.id, isOpen);
                }}
              >
                <summary>
                  <span className={`tag ${planToneClass(index)}`}>{feature.status}</span>
                  <span className={feature.enabled ? 'tag tag-green' : 'tag-red tag'}>{feature.enabled ? '前台显示' : '前台隐藏'}</span>
                  {feature.enabled && publishIssues.length ? <span className="tag tag-orange">缺配置</span> : null}
                  <strong>{feature.titleZh}</strong>
                  <small>Workflow: {workflowDisplay.workflowId || '未配置'} · 输入 {workflowDisplay.inputNodeId || '—'} · 输出 {workflowDisplay.outputNodeId || '—'} · {feature.pointsPerPhoto} pts/张</small>
                  <div className="feature-admin-order-actions" onClick={(event) => event.preventDefault()}>
                    <button className="btn btn-ghost btn-xs" type="button" onClick={() => onMoveFeatureCard(feature.id, -1)} disabled={index === 0}>上移</button>
                    <button className="btn btn-ghost btn-xs" type="button" onClick={() => onMoveFeatureCard(feature.id, 1)} disabled={index === adminFeatureDrafts.length - 1}>下移</button>
                  </div>
                </summary>
                <div className="feature-admin-form">
                  <div className="feature-admin-preview">
                    <span className="feature-admin-preview-label">前台预览</span>
                    <article className={`studio-feature-card admin-feature-preview-card tone-${feature.tone}${feature.enabled ? '' : ' locked'}`}>
                      <div className="studio-feature-visual">
                        {feature.beforeImageUrl && feature.afterImageUrl ? (
                          <>
                            <img className="studio-feature-before" src={feature.beforeImageUrl} alt="" loading="lazy" decoding="async" />
                            <img className="studio-feature-after" src={feature.afterImageUrl} alt="" loading="lazy" decoding="async" />
                            <span className="studio-feature-scanline" aria-hidden="true" />
                          </>
                        ) : (
                          <span className="studio-feature-gradient" aria-hidden="true" />
                        )}
                        <span className="studio-feature-tag">{feature.tagZh || '功能标签'}</span>
                        {!feature.enabled ? <span className="studio-feature-lock">未启用</span> : null}
                      </div>
                      <div className="studio-feature-body">
                        <strong>{feature.titleZh || '功能名称'}</strong>
                        <p>{feature.descriptionZh || '这里会显示前台功能卡片的短描述。'}</p>
                        <div className="studio-feature-meta">
                          <em>{feature.pointsPerPhoto} 积分 / 张</em>
                          <span className="studio-feature-use">去使用</span>
                        </div>
                      </div>
                    </article>
                  </div>
                  <div className="feature-admin-actions">
                    <button className="btn btn-danger" type="button" onClick={() => onDeleteFeatureCard(feature.id)}>删除卡片</button>
                    <small>删除后需要点击保存全部才会同步到前台。</small>
                  </div>
                  {publishIssues.length ? (
                    <div className={`feature-admin-publish-check${feature.enabled ? ' warning' : ''}`}>
                      <strong>{feature.enabled ? '前台启用前需要补齐' : '发布前检查'}</strong>
                      <span>{publishIssues.join('、')}</span>
                    </div>
                  ) : (
                    <div className="feature-admin-publish-check ready">
                      <strong>发布前检查通过</strong>
                      <span>这张卡片已具备前台展示和创建项目所需配置。</span>
                    </div>
                  )}
                  <div className="feature-admin-save-row">
                    <small>{feature.enabled ? '保存成功后会进入用户端功能卡片。' : '当前为前台隐藏，保存后用户端不会显示。'}</small>
                    <button className="btn btn-primary" type="button" onClick={() => void onSaveSystemSettings()} disabled={adminSystemBusy || !adminSystemSettings}>
                      {adminSystemBusy ? '保存中...' : '保存全部并发布到前台'}
                    </button>
                  </div>
                  <label className="admin-check-field">
                    <input type="checkbox" checked={feature.enabled} onChange={(event) => updateAdminFeatureDraft(feature.id, { enabled: event.target.checked })} />
                    <span>前台启用（关闭时保存成功也不会在前台显示）</span>
                  </label>
                  <input value={feature.id} onChange={(event) => updateAdminFeatureDraft(feature.id, { id: event.target.value })} placeholder="功能 ID（英文 / 数字）" />
                  <select value={feature.category} onChange={(event) => updateAdminFeatureDraft(feature.id, { category: event.target.value })}>
                    {categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <select value={feature.status} onChange={(event) => updateAdminFeatureDraft(feature.id, { status: event.target.value })}>
                    {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <select value={feature.tone} onChange={(event) => updateAdminFeatureDraft(feature.id, { tone: event.target.value })}>
                    {toneOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <input value={feature.titleZh} onChange={(event) => updateAdminFeatureDraft(feature.id, { titleZh: event.target.value })} placeholder="中文功能名称" />
                  <input value={feature.titleEn} onChange={(event) => updateAdminFeatureDraft(feature.id, { titleEn: event.target.value })} placeholder="英文功能名称" />
                  <input value={feature.tagZh} onChange={(event) => updateAdminFeatureDraft(feature.id, { tagZh: event.target.value })} placeholder="中文标签" />
                  <input value={feature.tagEn} onChange={(event) => updateAdminFeatureDraft(feature.id, { tagEn: event.target.value })} placeholder="英文标签" />
                  <textarea value={feature.descriptionZh} onChange={(event) => updateAdminFeatureDraft(feature.id, { descriptionZh: event.target.value })} placeholder="中文描述" />
                  <textarea value={feature.descriptionEn} onChange={(event) => updateAdminFeatureDraft(feature.id, { descriptionEn: event.target.value })} placeholder="英文描述" />
                  <textarea value={feature.detailZh} onChange={(event) => updateAdminFeatureDraft(feature.id, { detailZh: event.target.value })} placeholder="中文详情" />
                  <textarea value={feature.detailEn} onChange={(event) => updateAdminFeatureDraft(feature.id, { detailEn: event.target.value })} placeholder="英文详情" />
                  <input value={feature.workflowId ?? ''} onChange={(event) => updateAdminFeatureDraft(feature.id, { workflowId: event.target.value })} placeholder="流程 ID" />
                  <input value={feature.inputNodeId ?? ''} onChange={(event) => updateAdminFeatureDraft(feature.id, { inputNodeId: event.target.value })} placeholder="输入节点" />
                  <input value={feature.outputNodeId ?? ''} onChange={(event) => updateAdminFeatureDraft(feature.id, { outputNodeId: event.target.value })} placeholder="输出节点" />
                  <input value={feature.pointsPerPhoto} onChange={(event) => updateAdminFeatureDraft(feature.id, { pointsPerPhoto: Number(event.target.value) || 0 })} inputMode="numeric" placeholder="每张积分" />
                  <FeatureImageUploadRow busy={beforeImageBusy} feature={feature} field="beforeImageUrl" label="对比图 Before" onFeatureImageUpload={onFeatureImageUpload} updateAdminFeatureDraft={updateAdminFeatureDraft} />
                  <FeatureImageUploadRow busy={afterImageBusy} feature={feature} field="afterImageUrl" label="对比图 After" onFeatureImageUpload={onFeatureImageUpload} updateAdminFeatureDraft={updateAdminFeatureDraft} />
                </div>
              </details>
            );
          }) : (
            <div className="empty-tip">{adminSystemBusy ? '正在读取功能卡片...' : '功能卡片未载入，请刷新卡片。'}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function FeatureImageUploadRow({
  busy,
  feature,
  field,
  label,
  onFeatureImageUpload,
  updateAdminFeatureDraft
}: {
  busy: boolean;
  feature: any;
  field: 'beforeImageUrl' | 'afterImageUrl';
  label: string;
  onFeatureImageUpload: (featureId: string, field: 'beforeImageUrl' | 'afterImageUrl', file: File) => void | Promise<void>;
  updateAdminFeatureDraft: (featureId: string, patch: any) => void;
}) {
  return (
    <div className="feature-upload-row">
      <span>{label}</span>
      <input value={feature[field]} onChange={(event) => updateAdminFeatureDraft(feature.id, { [field]: event.target.value })} placeholder={field === 'beforeImageUrl' ? 'Before URL' : 'After URL'} />
      <input
        type="file"
        accept="image/*"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void onFeatureImageUpload(feature.id, field, file);
          event.currentTarget.value = '';
        }}
      />
      {busy ? <small>上传中...</small> : null}
    </div>
  );
}
