import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Copy,
  Crown,
  Mail,
  Plus,
  Search,
  Shield,
  UserPlus,
  Users,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { Member, Role } from '../types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { AccessDenied } from '../components/AccessDenied';
import { PageHeader } from '../components/PageHeader';
import { Avatar } from '../components/Avatar';
import { Modal } from '../components/Modal';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
} from '../components/ui';
import {
  cn,
  formatCompact,
  formatDateTime,
  relativeTime,
  roleLabel,
} from '../lib/utils';

export function TeamPage() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('Astra@2026');
  const [role, setRole] = useState<Role>('MEMBER');
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<{
    email: string;
    password: string;
  } | null>(null);

  const membersQuery = useQuery({
    queryKey: ['members'],
    queryFn: () => api<Member[]>('/api/users'),
    enabled: user?.role !== 'MEMBER',
  });

  const members = membersQuery.data ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return members;
    const q = search.toLowerCase();
    return members.filter(
      (member) =>
        member.name.toLowerCase().includes(q) ||
        member.email.toLowerCase().includes(q),
    );
  }, [members, search]);

  const stats = useMemo(
    () => ({
      total: members.length,
      active: members.filter((member) => member.status === 'active').length,
      admins: members.filter((member) => member.role !== 'MEMBER').length,
      tokens: members.reduce((sum, member) => sum + member.tokens, 0),
    }),
    [members],
  );

  if (user?.role === 'MEMBER') return <AccessDenied />;

  const invite = async () => {
    if (!name.trim() || !email.trim() || password.length < 8) {
      toast.error('请填写姓名、邮箱，并设置至少 8 位初始密码');
      return;
    }
    setSaving(true);
    try {
      await api('/api/users', {
        method: 'POST',
        body: JSON.stringify({ name, email, password, role }),
      });
      setCreatedCredentials({ email, password });
      setInviteOpen(false);
      setName('');
      setEmail('');
      setPassword('Astra@2026');
      setRole('MEMBER');
      void queryClient.invalidateQueries({ queryKey: ['members'] });
      toast.success('成员已加入工作区');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '邀请失败');
    } finally {
      setSaving(false);
    }
  };

  const updateMember = async (
    member: Member,
    payload: { role?: Role; status?: 'active' | 'disabled' },
  ) => {
    setUpdatingId(member.id);
    try {
      await api(`/api/users/${member.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      void queryClient.invalidateQueries({ queryKey: ['members'] });
      toast.success('成员权限已更新');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '更新失败');
    } finally {
      setUpdatingId(null);
    }
  };

  const copyCredentials = async () => {
    if (!createdCredentials) return;
    await navigator.clipboard.writeText(
      `ASTRA 登录信息\n邮箱：${createdCredentials.email}\n初始密码：${createdCredentials.password}`,
    );
    toast.success('登录信息已复制');
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="TEAM & PERMISSIONS"
        title="成员与权限"
        description="让合适的人访问合适的资源。角色决定管理权限，工作区数据始终隔离。"
        actions={
          <Button
            variant="primary"
            icon={<UserPlus size={16} />}
            onClick={() => setInviteOpen(true)}
          >
            邀请成员
          </Button>
        }
      />

      <div className="team-stats">
        <Card className="team-stat">
          <span className="team-stat-icon mint">
            <Users size={18} />
          </span>
          <div>
            <span>成员总数</span>
            <strong>{stats.total}</strong>
          </div>
        </Card>
        <Card className="team-stat">
          <span className="team-stat-icon blue">
            <Shield size={18} />
          </span>
          <div>
            <span>管理员</span>
            <strong>{stats.admins}</strong>
          </div>
        </Card>
        <Card className="team-stat">
          <span className="team-stat-icon violet">
            <Check size={18} />
          </span>
          <div>
            <span>启用中</span>
            <strong>{stats.active}</strong>
          </div>
        </Card>
        <Card className="team-stat">
          <span className="team-stat-icon amber">
            <Crown size={18} />
          </span>
          <div>
            <span>累计 Token</span>
            <strong>{formatCompact(stats.tokens)}</strong>
          </div>
        </Card>
      </div>

      <div className="toolbar">
        <div className="toolbar-tabs-simple">
          <span className="is-active">全部成员</span>
        </div>
        <div className="toolbar-right">
          <div className="search-box">
            <Search size={15} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索姓名或邮箱"
            />
          </div>
        </div>
      </div>

      {membersQuery.isLoading ? (
        <Skeleton style={{ height: 360, borderRadius: 18 }} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Users size={28} />}
          title="没有找到成员"
          description="换一个关键词，或邀请新的团队成员。"
        />
      ) : (
        <Card className="team-card">
          <div className="table-wrap">
            <table className="data-table team-table">
              <thead>
                <tr>
                  <th>成员</th>
                  <th>角色</th>
                  <th>状态</th>
                  <th className="align-right">对话</th>
                  <th className="align-right">Token</th>
                  <th>最近登录</th>
                  <th className="align-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((member) => {
                  const isSelf = member.id === user?.id;
                  const isOwner = member.role === 'OWNER';
                  const canManage =
                    !isSelf && (user?.role === 'OWNER' || !isOwner) &&
                    !(user?.role === 'ADMIN' && member.role === 'ADMIN');
                  return (
                    <tr key={member.id} className={cn(isSelf && 'is-self')}>
                      <td>
                        <div className="member-cell">
                          <Avatar
                            name={member.name}
                            color={member.avatarColor}
                            size={36}
                          />
                          <div>
                            <strong>
                              {member.name}
                              {isSelf && <span className="self-tag">你</span>}
                            </strong>
                            <span>{member.email}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        {canManage ? (
                          <Select
                            className="select-inline"
                            value={member.role}
                            disabled={updatingId === member.id}
                            onChange={(event) =>
                              void updateMember(member, {
                                role: event.target.value as Role,
                              })
                            }
                          >
                            <option value="OWNER">负责人</option>
                            <option value="ADMIN">管理员</option>
                            <option value="MEMBER">成员</option>
                          </Select>
                        ) : (
                          <Badge
                            tone={
                              member.role === 'OWNER'
                                ? 'amber'
                                : member.role === 'ADMIN'
                                  ? 'violet'
                                  : 'neutral'
                            }
                          >
                            {member.role === 'OWNER' && <Crown size={11} />}
                            {member.role === 'ADMIN' && <Shield size={11} />}
                            {roleLabel(member.role)}
                          </Badge>
                        )}
                      </td>
                      <td>
                        <Badge
                          tone={member.status === 'active' ? 'mint' : 'rose'}
                          dot
                        >
                          {member.status === 'active' ? '启用' : '已停用'}
                        </Badge>
                      </td>
                      <td className="align-right mono">
                        {member.conversations}
                      </td>
                      <td className="align-right mono">
                        {formatCompact(member.tokens)}
                      </td>
                      <td className="subtle">
                        {member.lastLoginAt
                          ? relativeTime(member.lastLoginAt)
                          : '从未登录'}
                        <div className="stacked-sub">
                          加入于 {formatDateTime(member.createdAt)}
                        </div>
                      </td>
                      <td className="align-right">
                        {canManage ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={updatingId === member.id}
                            onClick={() =>
                              void updateMember(member, {
                                status:
                                  member.status === 'active'
                                    ? 'disabled'
                                    : 'active',
                              })
                            }
                          >
                            {member.status === 'active' ? '停用' : '启用'}
                          </Button>
                        ) : (
                          <span className="subtle">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="role-guide">
        <div className="role-guide-head">
          <Shield size={16} />
          角色权限说明
        </div>
        <div className="role-guide-grid">
          <div>
            <strong>负责人 · Owner</strong>
            <p>完全控制工作区，包括成员、模型供应商、预算与所有内容。</p>
          </div>
          <div>
            <strong>管理员 · Admin</strong>
            <p>管理助手、知识库、模型供应商与普通成员，不能修改负责人。</p>
          </div>
          <div>
            <strong>成员 · Member</strong>
            <p>使用助手与对话工作台，查看知识库，不能修改工作区配置。</p>
          </div>
        </div>
      </div>

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="邀请成员"
        description="为成员创建账号并分配角色。请通过安全渠道发送初始密码。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setInviteOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              icon={<Mail size={15} />}
              loading={saving}
              onClick={() => void invite()}
            >
              创建并邀请
            </Button>
          </>
        }
      >
        <div className="form-stack">
          <div className="form-grid-2">
            <Field label="姓名" required>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="成员姓名"
                maxLength={24}
              />
            </Field>
            <Field label="角色">
              <Select
                value={role}
                onChange={(event) => setRole(event.target.value as Role)}
              >
                <option value="MEMBER">成员</option>
                <option value="ADMIN">管理员</option>
                {user?.role === 'OWNER' && <option value="OWNER">负责人</option>}
              </Select>
            </Field>
          </div>
          <Field label="工作邮箱" required>
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.com"
            />
          </Field>
          <Field label="初始密码" required hint="至少 8 位，包含字母和数字。">
            <Input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Astra@2026"
            />
          </Field>
          <div className="inline-info">
            <Plus size={15} />
            成员加入后可立即使用工作区内的所有 AI 助手。
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(createdCredentials)}
        onClose={() => setCreatedCredentials(null)}
        title="成员已创建"
        description="请复制以下登录信息，并通过安全渠道发送给成员。"
        size="sm"
        footer={
          <Button
            variant="primary"
            icon={<Copy size={15} />}
            onClick={() => void copyCredentials()}
          >
            复制登录信息
          </Button>
        }
      >
        <div className="credential-card">
          <div>
            <span>邮箱</span>
            <code>{createdCredentials?.email}</code>
          </div>
          <div>
            <span>初始密码</span>
            <code>{createdCredentials?.password}</code>
          </div>
        </div>
      </Modal>
    </div>
  );
}
