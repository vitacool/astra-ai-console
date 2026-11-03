import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../lib/api';
import { Logo } from '../components/Logo';
import { Button, Field, Input } from '../components/ui';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('admin@astra.local');
  const [password, setPassword] = useState('Astra@2026');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const from =
    (location.state as { from?: { pathname?: string } } | null)?.from
      ?.pathname || '/';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : '登录失败，请稍后再试',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <section className="login-visual">
        <div className="login-glow" />
        <div className="login-grid" />
        <div className="login-visual-inner">
          <Logo />
          <div className="login-hero">
            <div className="login-kicker">
              <span className="pulse-dot" />
              AI OPERATIONS PLATFORM
            </div>
            <h1>
              让 AI 真正进入
              <br />
              <span>工作流</span>，而不只是
              <br />
              停留在对话框。
            </h1>
            <p>
              在一个控制台里管理模型、助手、知识与团队用量。
              为每一次 AI 调用建立秩序、成本与信任。
            </p>
          </div>

          <div className="login-console">
            <div className="console-head">
              <div className="console-dots">
                <i />
                <i />
                <i />
              </div>
              <span>astra / workflow</span>
              <span className="console-live">LIVE</span>
            </div>
            <div className="console-body">
              <div className="console-row">
                <span className="console-tag mint">assistant</span>
                <span>客户成功助手</span>
                <span className="console-value">已连接知识库</span>
              </div>
              <div className="console-row">
                <span className="console-tag blue">provider</span>
                <span>DeepSeek · deepseek-chat</span>
                <span className="console-value">320ms</span>
              </div>
              <div className="console-row">
                <span className="console-tag amber">usage</span>
                <span>本月 Token</span>
                <span className="console-value">1,284,920</span>
              </div>
              <div className="console-chart">
                {[32, 48, 38, 62, 55, 78, 70, 92, 84, 100].map((height, i) => (
                  <span
                    key={i}
                    style={{
                      height: `${height}%`,
                      animationDelay: `${i * 80}ms`,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="login-proof">
            <div>
              <strong>2.4M</strong>
              <span>本月 Token</span>
            </div>
            <div>
              <strong>99.2%</strong>
              <span>请求成功率</span>
            </div>
            <div>
              <strong>8</strong>
              <span>活跃工作流</span>
            </div>
          </div>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-form-wrap">
          <div className="login-mobile-brand">
            <Logo />
          </div>
          <div className="login-heading">
            <div className="login-badge">
              <ShieldCheck size={14} />
              安全登录
            </div>
            <h2>欢迎回来</h2>
            <p>登录你的 ASTRA 工作区，继续构建 AI 工作流。</p>
          </div>

          <form onSubmit={submit} className="login-form">
            <Field label="工作邮箱">
              <div className="input-with-icon">
                <Mail size={16} />
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
                  required
                />
              </div>
            </Field>

            <Field label="密码">
              <div className="input-with-icon">
                <LockKeyhole size={16} />
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="输入登录密码"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="input-eye"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>

            {error && (
              <div className="form-error">
                <Zap size={15} />
                {error}
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={loading}
              className="login-submit"
            >
              进入控制台
              {!loading && <ArrowRight size={17} />}
            </Button>
          </form>

          <div className="demo-card">
            <div className="demo-card-head">
              <span>
                <Sparkles size={14} /> 演示账号
              </span>
              <button
                onClick={() => {
                  setEmail('admin@astra.local');
                  setPassword('Astra@2026');
                }}
              >
                一键填入
              </button>
            </div>
            <div className="demo-credentials">
              <code>admin@astra.local</code>
              <span>/</span>
              <code>Astra@2026</code>
            </div>
            <p>内置模拟引擎已就绪，无需配置 API Key 即可体验完整对话。</p>
          </div>

          <div className="login-foot">
            <span>© 2026 ASTRA Labs</span>
            <span className="login-foot-links">
              <a href="#privacy">隐私</a>
              <a href="#security">安全</a>
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
