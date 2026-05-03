import type { ReactNode } from 'react';

interface AdminActivationCodesPageProps {
  adminActivationBusy: boolean;
  adminActivationCodes: any[];
  adminActivationDraft: any;
  adminBatchCodeDraft: any;
  adminBatchCodeOpen: boolean;
  adminCodesStatusFilter: string;
  adminPageTitle: (title: string, subtitle?: ReactNode, actions?: ReactNode) => ReactNode;
  adminSingleCodeOpen: boolean;
  availableCodeCount: number;
  codeUsageRate: number;
  formatAdminDate: (value: string | null) => string;
  maxBatchCodes: number;
  onActivationDraftChange: (updater: any) => void;
  onBatchCodeDraftChange: (updater: any) => void;
  onCloseBatchCode: () => void;
  onCloseSingleCode: () => void;
  onCreateActivationCode: () => void | Promise<void>;
  onCreateBatchActivationCodes: () => void | Promise<void>;
  onDeleteActivationCode: (item: any) => void | Promise<void>;
  onLoadActivationCodes: () => void | Promise<void>;
  onOpenBatchActivationCodes: () => void;
  onOpenSingleCode: () => void;
  onStatusFilterChange: (value: string) => void;
  onToggleActivationCode: (item: any) => void | Promise<void>;
  planPackages: any[];
  usedCodeCount: number;
}

export function AdminActivationCodesPage({
  adminActivationBusy,
  adminActivationCodes,
  adminActivationDraft,
  adminBatchCodeDraft,
  adminBatchCodeOpen,
  adminCodesStatusFilter,
  adminPageTitle,
  adminSingleCodeOpen,
  availableCodeCount,
  codeUsageRate,
  formatAdminDate,
  maxBatchCodes,
  onActivationDraftChange,
  onBatchCodeDraftChange,
  onCloseBatchCode,
  onCloseSingleCode,
  onCreateActivationCode,
  onCreateBatchActivationCodes,
  onDeleteActivationCode,
  onLoadActivationCodes,
  onOpenBatchActivationCodes,
  onOpenSingleCode,
  onStatusFilterChange,
  onToggleActivationCode,
  planPackages,
  usedCodeCount
}: AdminActivationCodesPageProps) {
  const visibleCodes = adminActivationCodes.filter((item) => {
    const search = adminActivationDraft.code.trim().toUpperCase();
    if (search && !item.code.includes(search) && !item.label.toUpperCase().includes(search)) return false;
    const isExpired = !!item.expiresAt && new Date(item.expiresAt) < new Date();
    const isUsedUp = !item.available && item.active && !isExpired && item.maxRedemptions !== null && item.redemptionCount >= item.maxRedemptions;
    if (adminCodesStatusFilter === 'available') return item.available;
    if (adminCodesStatusFilter === 'used') return isUsedUp;
    if (adminCodesStatusFilter === 'expired') return isExpired;
    if (adminCodesStatusFilter === 'inactive') return !item.active;
    return true;
  });

  return (
    <div className="page-content active">
      {adminPageTitle(
        '兑换码',
        '生成与管理积分兑换码、活动促销码、合作伙伴码',
        <>
          <button className="btn btn-ghost" type="button" onClick={() => void onLoadActivationCodes()} disabled={adminActivationBusy}>
            {adminActivationBusy ? '刷新中...' : '刷新兑换码'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={onOpenBatchActivationCodes}>批量生成</button>
          <button className="btn btn-primary" type="button" onClick={onOpenSingleCode}>+ 新建兑换码</button>
        </>
      )}
      <div className="code-grid">
        <div className="code-stat"><div className="label">已生成 / 可用</div><div className="value">{adminActivationCodes.length.toLocaleString()} / {availableCodeCount}</div></div>
        <div className="code-stat"><div className="label">已使用</div><div className="value accent-text">{usedCodeCount.toLocaleString()}</div></div>
        <div className="code-stat"><div className="label">使用率</div><div className="value success-text">{codeUsageRate}%</div></div>
      </div>

      {adminBatchCodeOpen ? (
        <div className="card admin-inline-editor">
          <div className="card-header">
            <h3>批量生成兑换码</h3>
            <button className="tbl-icon" type="button" onClick={onCloseBatchCode}>×</button>
          </div>
          <div className="admin-form-grid">
            <label><span>前缀</span><input value={adminBatchCodeDraft.prefix} onChange={(event) => onBatchCodeDraftChange((current: any) => ({ ...current, prefix: event.target.value.toUpperCase() }))} /></label>
            <label><span>数量</span><input type="number" min="1" max={maxBatchCodes} value={adminBatchCodeDraft.count} onChange={(event) => onBatchCodeDraftChange((current: any) => ({ ...current, count: event.target.value }))} /></label>
            <label><span>显示名称</span><input value={adminBatchCodeDraft.label} onChange={(event) => onBatchCodeDraftChange((current: any) => ({ ...current, label: event.target.value }))} /></label>
            <label>
              <span>绑定套餐</span>
              <select value={adminBatchCodeDraft.packageId} onChange={(event) => onBatchCodeDraftChange((current: any) => ({ ...current, packageId: event.target.value }))}>
                <option value="">不绑定套餐</option>
                {planPackages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label><span>覆盖优惠 %</span><input type="number" min="0" max="100" value={adminBatchCodeDraft.discountPercentOverride} onChange={(event) => onBatchCodeDraftChange((current: any) => ({ ...current, discountPercentOverride: event.target.value }))} /></label>
            <label><span>额外积分</span><input type="number" min="0" value={adminBatchCodeDraft.bonusPoints} onChange={(event) => onBatchCodeDraftChange((current: any) => ({ ...current, bonusPoints: event.target.value }))} /></label>
            <label><span>每码次数</span><input type="number" min="1" value={adminBatchCodeDraft.maxRedemptions} onChange={(event) => onBatchCodeDraftChange((current: any) => ({ ...current, maxRedemptions: event.target.value }))} /></label>
            <label><span>到期时间</span><input type="datetime-local" value={adminBatchCodeDraft.expiresAt} onChange={(event) => onBatchCodeDraftChange((current: any) => ({ ...current, expiresAt: event.target.value }))} /></label>
            <label className="admin-check-field">
              <input type="checkbox" checked={adminBatchCodeDraft.active} onChange={(event) => onBatchCodeDraftChange((current: any) => ({ ...current, active: event.target.checked }))} />
              <span>生成后立即启用</span>
            </label>
          </div>
          <div className="admin-form-actions">
            <button className="btn btn-ghost" type="button" onClick={onCloseBatchCode}>取消</button>
            <button className="btn btn-primary" type="button" onClick={() => void onCreateBatchActivationCodes()} disabled={adminActivationBusy}>
              {adminActivationBusy ? '生成中...' : '确认生成'}
            </button>
          </div>
        </div>
      ) : null}

      {adminSingleCodeOpen ? (
        <div className="card admin-inline-editor">
          <div className="card-header">
            <h3>新建单个兑换码</h3>
            <button className="tbl-icon" type="button" onClick={onCloseSingleCode}>×</button>
          </div>
          <div className="admin-form-grid">
            <label><span>兑换码（留空自动生成）</span><input value={adminActivationDraft.code} onChange={(event) => onActivationDraftChange((current: any) => ({ ...current, code: event.target.value.toUpperCase() }))} placeholder="自动生成" /></label>
            <label><span>显示名称</span><input value={adminActivationDraft.label} onChange={(event) => onActivationDraftChange((current: any) => ({ ...current, label: event.target.value }))} placeholder="例：双十一活动码" /></label>
            <label>
              <span>绑定套餐</span>
              <select value={adminActivationDraft.packageId} onChange={(event) => onActivationDraftChange((current: any) => ({ ...current, packageId: event.target.value }))}>
                <option value="">不绑定套餐（通用）</option>
                {planPackages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label><span>覆盖优惠 %（留空使用套餐默认）</span><input type="number" min="0" max="100" value={adminActivationDraft.discountPercentOverride} onChange={(event) => onActivationDraftChange((current: any) => ({ ...current, discountPercentOverride: event.target.value }))} placeholder="不覆盖" /></label>
            <label><span>额外赠送积分</span><input type="number" min="0" value={adminActivationDraft.bonusPoints} onChange={(event) => onActivationDraftChange((current: any) => ({ ...current, bonusPoints: event.target.value }))} /></label>
            <label><span>最大兑换次数（留空无限）</span><input type="number" min="1" value={adminActivationDraft.maxRedemptions} onChange={(event) => onActivationDraftChange((current: any) => ({ ...current, maxRedemptions: event.target.value }))} placeholder="无限" /></label>
            <label><span>到期时间（留空永不过期）</span><input type="datetime-local" value={adminActivationDraft.expiresAt} onChange={(event) => onActivationDraftChange((current: any) => ({ ...current, expiresAt: event.target.value }))} /></label>
            <label className="admin-check-field">
              <input type="checkbox" checked={adminActivationDraft.active} onChange={(event) => onActivationDraftChange((current: any) => ({ ...current, active: event.target.checked }))} />
              <span>创建后立即启用</span>
            </label>
          </div>
          <div className="admin-form-actions">
            <button className="btn btn-ghost" type="button" onClick={onCloseSingleCode}>取消</button>
            <button className="btn btn-primary" type="button" onClick={() => void onCreateActivationCode()} disabled={adminActivationBusy}>
              {adminActivationBusy ? '创建中...' : '确认创建'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="toolbar">
          <input value={adminActivationDraft.code} onChange={(event) => onActivationDraftChange((current: any) => ({ ...current, code: event.target.value.toUpperCase() }))} placeholder="搜索兑换码" />
          <select value={adminCodesStatusFilter} onChange={(event) => onStatusFilterChange(event.target.value)}>
            <option value="all">所有状态</option>
            <option value="available">活跃可用</option>
            <option value="used">已用完</option>
            <option value="expired">已过期</option>
            <option value="inactive">已停用</option>
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>兑换码</th><th>类型</th><th>面值</th><th>剩余 / 总量</th><th>有效期</th><th>使用情况</th><th>状态</th><th></th></tr></thead>
            <tbody>
              {visibleCodes.map((item) => (
                <tr key={item.id}>
                  <td className="mono code-text">{item.code}</td>
                  <td><span className={`tag ${item.packageName ? 'tag-purple' : 'tag-cyan'}`}>{item.packageName ? '套餐优惠' : '积分'}</span></td>
                  <td className="mono">{item.discountPercentOverride !== null ? `${item.discountPercentOverride} 折` : item.bonusPoints ? `+${item.bonusPoints} 积分` : '默认'}</td>
                  <td className="mono">{item.maxRedemptions ? `${Math.max(0, item.maxRedemptions - item.redemptionCount)} / ${item.maxRedemptions}` : '无限'}</td>
                  <td className="cell-id">{item.expiresAt ? formatAdminDate(item.expiresAt) : '永久'}</td>
                  <td className="mono">{item.redemptionCount}{item.maxRedemptions ? ` / ${item.maxRedemptions}` : ' 次'}</td>
                  <td><span className={item.available ? 'tag tag-green' : item.active ? 'tag tag-orange' : 'tag tag-gray'}>{item.available ? '活跃' : item.active ? '不可用' : '已停用'}</span></td>
                  <td>
                    <div className="tbl-actions">
                      <button className="tbl-icon" type="button" title={item.active ? '停用' : '启用'} onClick={() => void onToggleActivationCode(item)} disabled={adminActivationBusy}>{item.active ? '⏸' : '▶'}</button>
                      <button className="tbl-icon" type="button" title={item.redemptionCount > 0 ? '已兑换，无法删除' : '删除'} onClick={() => void onDeleteActivationCode(item)} disabled={adminActivationBusy || item.redemptionCount > 0}>✕</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!adminActivationCodes.length && <div className="empty-tip">{adminActivationBusy ? '正在读取兑换码...' : '暂无兑换码'}</div>}
      </div>
    </div>
  );
}
