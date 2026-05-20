import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

const tabs = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/events',    label: 'Events' },
  { path: '/benchmark', label: 'Benchmark' },
];

const AnalyticsNav: React.FC<{ title: string }> = ({ title }) => {
  const { pathname } = useLocation();

  return (
    <div className="mb-8" style={{ borderBottom: '1px solid var(--b)' }}>
      <div className="flex items-end justify-between pb-0">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 pb-3.5">
          <Link
            to="/promptops"
            className="flex items-center gap-1.5 text-xs transition-colors"
            style={{ color: 'var(--t3)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--t1)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--t3)'}
          >
            <ArrowLeft size={12} />
            PromptOps
          </Link>
          <span className="text-xs" style={{ color: 'var(--t4)' }}>›</span>
          <span className="text-sm font-semibold" style={{ color: 'var(--t1)', fontFamily: 'Syne, sans-serif' }}>
            {title}
          </span>
        </div>

        {/* Tabs */}
        <div className="flex items-end gap-0">
          {tabs.map(tab => {
            const active = pathname === tab.path;
            return (
              <Link
                key={tab.path}
                to={tab.path}
                className="relative px-4 pb-3.5 text-[13px] font-medium transition-colors"
                style={{ color: active ? 'var(--blue-hi)' : 'var(--t3)' }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--t2)'; }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--t3)'; }}
              >
                {tab.label}
                {active && (
                  <span
                    className="absolute bottom-0 left-4 right-4 h-[2px] rounded-full"
                    style={{ background: 'var(--blue)' }}
                  />
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default AnalyticsNav;
