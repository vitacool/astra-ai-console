import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  BookOpenText,
  ChevronDown,
  ChevronsUpDown,
  CircleHelp,
  Command,
  Database,
  Gauge,
  LayoutDashboard,
  LogOut,
  Menu,
  MessagesSquare,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import type { SettingsData } from '../types';
import { Avatar } from './Avatar';
import { Logo } from './Logo';
import { Modal } from './Modal';
import { Kbd } from './ui';

interface NavItem {
  label: string;
  path: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
  hint?: string;
}

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: '工作台',
    items: [
      { label: '总览', path: '/', icon: LayoutDashboard, hint: '工作区概览与实时动态' },
      { label: '对话工作台', path: '/chat', icon: MessagesSquare, hint: '与 AI 助手协作' },
    ],
  },
  {
    label: '构建',
    items: [
      { label: 'AI 助手', path: '/assistants', icon: Sparkles, hint: '配置角色与提示词' },
      { label: '知识库', path: '/knowledge', icon: BookOpenText, hint: '沉淀团队资料' },
      { label: '模型供应商', path: '/providers', icon: Database, hint: '接入模型服务' },
    ],
  },
  {
    label: '洞察',
    items: [
      { label: '用量分析', path: '/usage', icon: Activity, hint: 'Token、成本与延迟' },
    ],
  },
  {
    label: '管理',
    items: [
      { label: '成员', path: '/team', icon: Users, adminOnly: true, hint: '成员与角色权限' },
      { label: '审计日志', path: '/audit', icon: ShieldCheck, adminOnly: true, hint: '操作留痕' },
      { label: '设置', path: '/settings', icon: Settings, hint: '工作区与个人偏好' },
    ],
  },
];

const PAGE_META: Record<string, { title: string; parent: string }> = {
  '/': { title: '总览', parent: '工作台' },
  '/chat': { title: '对话工作台', parent: '工作台' },
  '/assistants': { title: 'AI 助手', parent: '构建' },
  '/knowledge': { title: '知识库', parent: '构建' },
  '/providers': { title: '模型供应商', parent: '构建' },
  '/usage': { title: '用量分析', parent: '洞察' },
  '/team': { title: '成员', parent: '管理' },
  '/audit': { title: '审计日志', parent: '管理' },
  '/settings': { title: '设置', parent: '管理' },
};

function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();

  useEffect(() => {
    if (open) {
      setQuery('');
      window.setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  const items = useMemo(() => {
    const filtered = NAV_GROUPS.flatMap((group) =>
      group.items.map((item) => ({ ...item, group: group.label })),
    ).filter((item) => !item.adminOnly || user?.role !== 'MEMBER');
    if (!query.trim()) return filtered;
    const q = query.toLowerCase();
    return filtered.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.group.toLowerCase().includes(q) ||
        item.hint?.toLowerCase().includes(q),
    );
  }, [query, user?.role]);

  const go = (path: string) => {
    navigate(path);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} size="md">
      <div className="palette">
        <div className="palette-input">
          <Search size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索页面或功能…"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && items[0]) go(items[0].path);
            }}
          />
          <Kbd>ESC</Kbd>
        </div>
        <div className="palette-list">
          {items.length === 0 && (
            <div className="palette-empty">没有找到匹配的功能</div>
          )}
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                className="palette-item"
                onClick={() => go(item.path)}
              >
                <span className="palette-icon">
                  <Icon size={17} />
                </span>
                <span className="palette-copy">
                  <span>{item.label}</span>
                  <small>{item.hint}</small>
                </span>
                <span className="palette-group">{item.group}</span>
              </button>
            );
          })}
        </div>
        <div className="palette-foot">
          <span>
            <Kbd>↵</Kbd> 打开
          </span>
          <span>
            <Kbd>⌘</Kbd> <Kbd>K</Kbd> 随时唤起
          </span>
        </div>
      </div>
    </Modal>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<SettingsData>('/api/settings'),
    staleTime: 60_000,
  });

  const meta = PAGE_META[location.pathname] ?? { title: '控制台', parent: 'ASTRA' };
  const isChat = location.pathname === '/chat';

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(event.target as Node)
      ) {
        setUserMenu(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const navGroups = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter(
          (item) => !item.adminOnly || user?.role !== 'MEMBER',
        ),
      })).filter((group) => group.items.length > 0),
    [user?.role],
  );

  return (
    <div className="app-shell">
      {mobileOpen && (
        <button
          className="sidebar-scrim"
          onClick={() => setMobileOpen(false)}
          aria-label="关闭导航"
        />
      )}
      <aside className={cn('sidebar', mobileOpen && 'is-open')}>
        <div className="sidebar-top">
          <Logo />
          <button
            className="sidebar-mobile-close"
            onClick={() => setMobileOpen(false)}
            aria-label="关闭导航"
          >
            <X size={18} />
          </button>
        </div>

        <button className="workspace-switcher" onClick={() => navigate('/settings')}>
          <span className="workspace-avatar">星</span>
          <span className="workspace-copy">
            <strong>{settings?.workspaceName || '星枢 AI 实验室'}</strong>
            <small>{settings?.plan || 'Team'} 工作区</small>
          </span>
          <ChevronsUpDown size={14} />
        </button>

        <nav className="sidebar-nav">
          {navGroups.map((group) => (
            <div key={group.label} className="nav-group">
              <div className="nav-label">{group.label}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === '/'}
                    className={({ isActive }) =>
                      cn('nav-item', isActive && 'is-active')
                    }
                  >
                    <Icon size={17} strokeWidth={1.8} />
                    <span>{item.label}</span>
                    {item.path === '/chat' && <i className="nav-live-dot" />}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-help">
            <div className="help-icon">
              <CircleHelp size={16} />
            </div>
            <div>
              <strong>需要帮助？</strong>
              <span>查看快速上手指南</span>
            </div>
            <ChevronDown size={14} className="help-arrow" />
          </div>

          <div className="sidebar-user" ref={userMenuRef}>
            <button
              className="user-button"
              onClick={() => setUserMenu((value) => !value)}
            >
              <Avatar
                name={user?.name || '用户'}
                color={user?.avatarColor}
                size={34}
              />
              <span className="user-copy">
                <strong>{user?.name}</strong>
                <small>{user?.email}</small>
              </span>
              <ChevronDown
                size={14}
                className={cn('user-chevron', userMenu && 'is-open')}
              />
            </button>
            {userMenu && (
              <div className="user-menu">
                <button
                  onClick={() => {
                    setUserMenu(false);
                    navigate('/settings');
                  }}
                >
                  <Settings size={15} /> 个人设置
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    logout();
                    navigate('/login');
                  }}
                >
                  <LogOut size={15} /> 退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="app-body">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu"
              onClick={() => setMobileOpen(true)}
              aria-label="打开导航"
            >
              <Menu size={20} />
            </button>
            <div className="breadcrumbs">
              <span>{meta.parent}</span>
              <i>/</i>
              <strong>{meta.title}</strong>
            </div>
          </div>

          <div className="topbar-right">
            <button
              className="search-trigger"
              onClick={() => setPaletteOpen(true)}
            >
              <Search size={15} />
              <span>搜索或跳转</span>
              <Kbd>
                <Command size={10} /> K
              </Kbd>
            </button>
            <div className="system-status">
              <span className="pulse-dot" />
              系统正常
            </div>
            <button
              className="topbar-avatar"
              onClick={() => navigate('/settings')}
              aria-label="打开个人设置"
            >
              <Avatar
                name={user?.name || '用户'}
                color={user?.avatarColor}
                size={30}
              />
            </button>
          </div>
        </header>

        <main className={cn('app-main', isChat && 'app-main-chat')}>
          <Outlet />
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  );
}
