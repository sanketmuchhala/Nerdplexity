import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

const tabs = [
  { path: '/app/analytics',           label: 'Overview'  },
  { path: '/app/analytics/dashboard', label: 'Dashboard' },
  { path: '/app/analytics/events',    label: 'Events'    },
  { path: '/app/analytics/benchmark', label: 'Benchmark' },
];

export default function AnalyticsNav({ title }: { title: string }) {
  const { pathname } = useLocation();

  return (
    <div className="mb-8" style={{ borderBottom: '1px solid var(--b)' }}>
      <div className="flex items-end justify-between">
        <div className="flex items-center gap-2 pb-4">
          <Link to="/app" className="flex items-center gap-1.5 text-xs transition-colors" style={{ color: 'var(--t3)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--t1)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--t3)'}>
            <ArrowLeft size={12} /> Back to chat
          </Link>
          <span className="text-xs" style={{ color: 'var(--t4)' }}>›</span>
          <span className="text-sm font-semibold" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', color: 'var(--t1)' }}>{title}</span>
        </div>
        <div className="flex items-end">
          {tabs.map(t => {
            const active = pathname === t.path || (t.path !== '/app/analytics' && pathname.startsWith(t.path));
            return (
              <Link key={t.path} to={t.path}
                className="relative px-4 pb-4 text-xs font-medium transition-colors"
                style={{ color: active ? 'var(--blue-bright)' : 'var(--t3)' }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--t2)'; }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--t3)'; }}>
                {t.label}
                {active && <span className="absolute bottom-0 left-4 right-4 h-[2px] rounded-full" style={{ background: 'var(--blue)' }} />}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
