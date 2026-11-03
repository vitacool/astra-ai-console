import { cn } from '../lib/utils';

export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className="logo-mark"
    >
      <rect width="48" height="48" rx="13" fill="url(#astra-bg)" />
      <path
        d="M24 7.5 28.8 19.2 40.5 24 28.8 28.8 24 40.5 19.2 28.8 7.5 24 19.2 19.2Z"
        fill="url(#astra-star)"
      />
      <circle cx="24" cy="24" r="3.2" fill="#07100F" />
      <defs>
        <linearGradient id="astra-bg" x1="0" y1="0" x2="48" y2="48">
          <stop stopColor="#14201F" />
          <stop offset="1" stopColor="#0A0F14" />
        </linearGradient>
        <linearGradient id="astra-star" x1="10" y1="8" x2="40" y2="42">
          <stop stopColor="#9BF6E5" />
          <stop offset="1" stopColor="#2DD4BF" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function Logo({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('brand', className)}>
      <LogoMark size={compact ? 32 : 36} />
      {!compact && (
        <div className="brand-text">
          <div className="brand-name">
            ASTRA<span className="brand-dot">.</span>
          </div>
          <div className="brand-sub">星枢 AI 控制台</div>
        </div>
      )}
    </div>
  );
}
