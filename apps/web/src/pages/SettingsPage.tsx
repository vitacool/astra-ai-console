import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Database as DatabaseIcon,
  HardDrive,
  KeyRound,
  Save,
  Server,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { Assistant, SettingsData } from '../types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { PageHeader } from '../components/PageHeader';
import { Avatar } from '../components/Avatar';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Progress,
  Select,
  Skeleton,
  Toggle,
} from '../components/ui';
import { colorOptions } from '../lib/icons';
import {
  cn,
  formatBytes,
  formatCompact,
  formatNumber,
  roleLabel,
} from '../lib/utils';

type Tab = 'workspace' | 'profile' | 'security';

export function SettingsPage() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const isAdmin = user?.role !== 'MEMBER';

  const [tab, setTab] = useState<Tab>(isAdmin ? 'workspace' : 'profile');
  const [workspaceName, setWorkspaceName] = useState('');
  const [tokenBudget, setTokenBudget] = useState('2000000');
  const [timezone, setTimezone] = useState('Asia/Shanghai');
  const [retentionDays, setRetentionDays] = useState('90');
  const [defaultAssistant, setDefaultAssistant] = useState('');
  const [savingWorkspace, setSavingWorkspace] = useState(false);

  const [profileName, setProfileName] = useState(user?.name ?? '');
  const [avatarColor, setAvatarColor] = useState(user?.avatarColor ?? '#5EEAD4');
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<SettingsData>('/api/settings'),
  });
  const assistantsQuery = useQuery({
    queryKey: ['assistants'],
    queryFn: () => api<Assistant[]>('/api/assistants'),
    staleTime: 60_000,
  });

  const data = settingsQuery.data;

  useEffect(() => {
    if (!data) return;
    setWorkspaceName(data.workspaceName);
    setTokenBudget(String(data.tokenBudget));
    setTimezone(data.timezone);
    setRetentionDays(String(data.retentionDays));
    setDefaultAssistant(data.defaultAssistant ?? '');
  }, [data]);

  useEffect(() => {
    if (!isAdmin && tab === 'workspace') setTab('profile');
  }, [isAdmin, tab]);

  useEffect(() => {
    if (user) {
      setProfileName(user.name);
      setAvatarColor(user.avatarColor);
    }
  }, [user]);

  const tabs = useMemo(
    () =>
      [
        ...(isAdmin
          ? [
              {
                id: 'workspace' as const,
                label: '工作区',
                icon: Sparkles,
                hint: '预算与默认配置',
              },
            ]
          : []),
        {
          id: 'profile' as const,
          label: '个人资料',
          icon: UserRound,
          hint: '昵称与头像',
        },
        {
          id: 'security' as const,
          label: '安全',
          icon: ShieldCheck,
          hint: '密码与会话',
        },
      ],
    [isAdmin],
  );

  const saveWorkspace = async () => {
    if (!workspaceName.trim()) {
      toast.error('工作区名称不能为空');
      return;
    }
    const budget = Number(tokenBudget);
    if (!Number.isFinite(budget) || budget < 10_000) {
      toast.error('Token 预算至少为 10,000');
      return;
    }
    setSavingWorkspace(true);
    try {
      await api('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          workspaceName: workspaceName.trim(),
          tokenBudget: Math.round(budget),
          timezone,
          retentionDays: Number(retentionDays),
          defaultAssistant: defaultAssistant || null,
        }),
      });
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('工作区设置已保存');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败');
    } finally {
      setSavingWorkspace(false);
    }
  };

  const saveProfile = async () => {
    if (!profileName.trim() || profileName.trim().length < 2) {
      toast.error('昵称至少 2 个字符');
      return;
    }
    setSavingProfile(true);
    try {
      const updated = await api<typeof user>('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          name: profileName.trim(),
          avatarColor,
        }),
      });
      if (updated) updateUser(updated);
      toast.success('个人资料已更新');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败');
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async () => {
    if (newPassword.length < 8) {
      toast.error('新密码至少 8 位');
      return;
    }
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      toast.error('新密码需要同时包含字母和数字');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('两次输入的新密码不一致');
      return;
    }
    setSavingPassword(true);
    try {
      await api('/api/auth/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('密码已更新，请妥善保管');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '密码修改失败');
    } finally {
      setSavingPassword(false);
    }
  };

  const counts = data?.system.counts;
  const budgetLimit = data?.tokenBudget ?? 2_000_000;
  const passwordStrength =
    (newPassword.length >= 8 ? 1 : 0) +
    (/[A-Z]/.test(newPassword) ? 1 : 0) +
    (/\d/.test(newPassword) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(newPassword) ? 1 : 0);

  return (
    <div className="page">
      <PageHeader
        eyebrow="WORKSPACE SETTINGS"
        title="设置"
        description="配置工作区、预算与个人偏好。所有更改都会写入审计日志。"
      />

      <div className="settings-layout">
        <aside className="settings-nav">
          {tabs.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={cn('settings-nav-item', tab === item.id && 'is-active')}
                onClick={() => setTab(item.id)}
              >
                <span>
                  <Icon size={17} />
                </span>
                <div>
                  <strong>{item.label}</strong>
                  <small>{item.hint}</small>
                </div>
              </button>
            );
          })}
          <div className="settings-nav-card">
            <div className="settings-plan-head">
              <span>
                <Wallet size={15} /> {data?.plan || 'Team'} 计划
              </span>
              <Badge tone="mint">Active</Badge>
            </div>
            <div className="settings-plan-count">
              {counts?.users ?? 0}
              <span>/ 10 成员</span>
            </div>
            <Progress value={((counts?.users ?? 0) / 10) * 100} />
            <p>需要更多成员或私有化部署？联系你的客户成功经理。</p>
          </div>
        </aside>

        <div className="settings-content">
          {settingsQuery.isLoading ? (
            <Skeleton style={{ height: 460, borderRadius: 18 }} />
          ) : tab === 'workspace' ? (
            <>
              <Card className="settings-card">
                <div className="settings-card-head">
                  <div>
                    <h2>工作区信息</h2>
                    <p>这些信息会展示在侧边栏和成员的工作台中。</p>
                  </div>
                  <Badge tone="neutral">仅管理员可见</Badge>
                </div>
                <div className="settings-form">
                  <div className="form-grid-2">
                    <Field label="工作区名称">
                      <Input
                        value={workspaceName}
                        onChange={(event) => setWorkspaceName(event.target.value)}
                        maxLength={40}
                      />
                    </Field>
                    <Field label="默认助手" hint="新成员进入对话工作台时的默认选择。">
                      <Select
                        value={defaultAssistant}
                        onChange={(event) => setDefaultAssistant(event.target.value)}
                      >
                        <option value="">不指定</option>
                        {(assistantsQuery.data ?? []).map((assistant) => (
                          <option key={assistant.id} value={assistant.id}>
                            {assistant.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <div className="form-grid-2">
                    <Field
                      label="每月 Token 预算"
                      hint={`当前 ${formatNumber(budgetLimit)} tokens · 约为 ${formatCompact(budgetLimit)}`}
                    >
                      <Input
                        type="number"
                        value={tokenBudget}
                        min={10000}
                        step={10000}
                        onChange={(event) => setTokenBudget(event.target.value)}
                      />
                    </Field>
                    <Field label="数据保留周期" hint="超出周期的调用明细会自动归档。">
                      <Select
                        value={retentionDays}
                        onChange={(event) => setRetentionDays(event.target.value)}
                      >
                        <option value="30">30 天</option>
                        <option value="90">90 天</option>
                        <option value="180">180 天</option>
                        <option value="365">365 天</option>
                      </Select>
                    </Field>
                  </div>
                  <Field label="时区">
                    <Select
                      value={timezone}
                      onChange={(event) => setTimezone(event.target.value)}
                    >
                      <option value="Asia/Shanghai">Asia/Shanghai (UTC+8)</option>
                      <option value="Asia/Tokyo">Asia/Tokyo (UTC+9)</option>
                      <option value="Europe/London">Europe/London (UTC+0)</option>
                      <option value="America/New_York">
                        America/New_York (UTC-5)
                      </option>
                      <option value="UTC">UTC</option>
                    </Select>
                  </Field>
                  <div className="settings-actions">
                    <Button
                      variant="primary"
                      icon={<Save size={15} />}
                      loading={savingWorkspace}
                      onClick={() => void saveWorkspace()}
                    >
                      保存更改
                    </Button>
                  </div>
                </div>
              </Card>

              <div className="settings-grid-2">
                <Card className="settings-card compact-card">
                  <div className="settings-card-head">
                    <div>
                      <h2>运行环境</h2>
                      <p>当前服务的版本与存储状态。</p>
                    </div>
                    <Server size={18} className="muted-icon" />
                  </div>
                  <div className="system-list">
                    <div>
                      <span>ASTRA 版本</span>
                      <strong>v{data?.system.version}</strong>
                    </div>
                    <div>
                      <span>Node.js</span>
                      <strong>{data?.system.node}</strong>
                    </div>
                    <div>
                      <span>数据库</span>
                      <strong>{data?.system.database}</strong>
                    </div>
                    <div>
                      <span>数据大小</span>
                      <strong>{formatBytes(data?.system.databaseSize ?? 0)}</strong>
                    </div>
                    <div>
                      <span>运行模式</span>
                      <Badge
                        tone={
                          data?.system.environment === 'production'
                            ? 'mint'
                            : 'amber'
                        }
                      >
                        {data?.system.environment}
                      </Badge>
                    </div>
                  </div>
                </Card>

                <Card className="settings-card compact-card">
                  <div className="settings-card-head">
                    <div>
                      <h2>工作区资产</h2>
                      <p>当前工作区沉淀的内容规模。</p>
                    </div>
                    <DatabaseIcon size={18} className="muted-icon" />
                  </div>
                  <div className="asset-grid">
                    <div>
                      <span>AI 助手</span>
                      <strong>{counts?.assistants ?? 0}</strong>
                    </div>
                    <div>
                      <span>知识文档</span>
                      <strong>{counts?.documents ?? 0}</strong>
                    </div>
                    <div>
                      <span>对话</span>
                      <strong>{counts?.conversations ?? 0}</strong>
                    </div>
                    <div>
                      <span>成员</span>
                      <strong>{counts?.users ?? 0}</strong>
                    </div>
                  </div>
                  <div className="asset-foot">
                    <HardDrive size={13} />
                    数据存储于本地 SQLite，可随时备份。
                  </div>
                </Card>
              </div>

              <Card className="settings-card">
                <div className="settings-card-head">
                  <div>
                    <h2>数据与安全</h2>
                    <p>工作区的安全基线设置。</p>
                  </div>
                  <ShieldCheck size={18} className="muted-icon" />
                </div>
                <div className="security-list">
                  <div className="security-item">
                    <div>
                      <strong>模型密钥加密</strong>
                      <span>AES-256-GCM，密钥由服务端环境变量派生</span>
                    </div>
                    <Badge tone="mint" dot>
                      已启用
                    </Badge>
                  </div>
                  <div className="security-item">
                    <div>
                      <strong>操作审计</strong>
                      <span>记录登录、配置变更与成员操作，不记录密钥明文</span>
                    </div>
                    <Badge tone="mint" dot>
                      已启用
                    </Badge>
                  </div>
                  <div className="security-item">
                    <div>
                      <strong>数据隔离</strong>
                      <span>对话按成员隔离，知识库按工作区隔离</span>
                    </div>
                    <Badge tone="mint" dot>
                      已启用
                    </Badge>
                  </div>
                  <div className="security-item">
                    <div>
                      <strong>自动保留策略</strong>
                      <span>调用明细保留 {data?.retentionDays} 天</span>
                    </div>
                    <Badge tone="neutral">可配置</Badge>
                  </div>
                </div>
              </Card>
            </>
          ) : tab === 'profile' ? (
            <Card className="settings-card">
              <div className="settings-card-head">
                <div>
                  <h2>个人资料</h2>
                  <p>你在工作区中的显示方式。</p>
                </div>
                <Badge tone="violet">{roleLabel(user?.role ?? 'MEMBER')}</Badge>
              </div>
              <div className="profile-preview">
                <Avatar name={profileName || '用户'} color={avatarColor} size={58} />
                <div>
                  <strong>{profileName || '你的昵称'}</strong>
                  <span>{user?.email}</span>
                </div>
              </div>
              <div className="settings-form">
                <div className="form-grid-2">
                  <Field label="昵称">
                    <Input
                      value={profileName}
                      onChange={(event) => setProfileName(event.target.value)}
                      maxLength={24}
                    />
                  </Field>
                  <Field label="邮箱" hint="邮箱由管理员维护，暂不支持自助修改。">
                    <Input value={user?.email ?? ''} disabled />
                  </Field>
                </div>
                <Field label="头像颜色">
                  <div className="color-picker">
                    {colorOptions.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={cn(
                          'color-option',
                          avatarColor === color && 'is-active',
                        )}
                        style={{ background: color }}
                        onClick={() => setAvatarColor(color)}
                        aria-label={color}
                      >
                        {avatarColor === color && <span />}
                      </button>
                    ))}
                  </div>
                </Field>
                <div className="settings-actions">
                  <Button
                    variant="primary"
                    icon={<Save size={15} />}
                    loading={savingProfile}
                    onClick={() => void saveProfile()}
                  >
                    保存资料
                  </Button>
                </div>
              </div>
            </Card>
          ) : (
            <>
              <Card className="settings-card">
                <div className="settings-card-head">
                  <div>
                    <h2>修改密码</h2>
                    <p>定期更新密码，并避免在多个服务间复用。</p>
                  </div>
                  <KeyRound size={18} className="muted-icon" />
                </div>
                <div className="settings-form narrow-form">
                  <Field label="当前密码">
                    <Input
                      type="password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      autoComplete="current-password"
                    />
                  </Field>
                  <Field label="新密码" hint="至少 8 位，同时包含字母与数字。">
                    <Input
                      type="password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      autoComplete="new-password"
                    />
                  </Field>
                  {newPassword && (
                    <div className="strength">
                      <div className="strength-bars">
                        {[0, 1, 2, 3].map((index) => (
                          <span
                            key={index}
                            className={cn(
                              index < passwordStrength && 'is-filled',
                              passwordStrength >= 3 && 'is-strong',
                            )}
                          />
                        ))}
                      </div>
                      <span>
                        {passwordStrength <= 1
                          ? '较弱'
                          : passwordStrength === 2
                            ? '一般'
                            : passwordStrength === 3
                              ? '良好'
                              : '很强'}
                      </span>
                    </div>
                  )}
                  <Field label="确认新密码">
                    <Input
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      autoComplete="new-password"
                    />
                  </Field>
                  <div className="settings-actions">
                    <Button
                      variant="primary"
                      icon={<ShieldCheck size={15} />}
                      loading={savingPassword}
                      onClick={() => void savePassword()}
                    >
                      更新密码
                    </Button>
                  </div>
                </div>
              </Card>

              <Card className="settings-card">
                <div className="settings-card-head">
                  <div>
                    <h2>当前会话</h2>
                    <p>你的登录状态与安全信息。</p>
                  </div>
                  <Users size={18} className="muted-icon" />
                </div>
                <div className="session-row">
                  <span className="session-dot" />
                  <div>
                    <strong>Web 控制台 · 当前设备</strong>
                    <span>登录令牌有效期 7 天 · 退出后需重新验证</span>
                  </div>
                  <Badge tone="mint" dot>
                    活跃
                  </Badge>
                </div>
                <div className="security-tip">
                  <Check size={14} />
                  建议在公共设备上使用后主动退出登录。
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
