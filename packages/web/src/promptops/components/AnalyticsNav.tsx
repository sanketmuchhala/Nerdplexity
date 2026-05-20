import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

interface AnalyticsNavProps { title: string; }

const tabs = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/events',    label: 'Events' },
  { path: '/benchmark', label: 'Benchmark' },
];

const AnalyticsNav: React.FC<AnalyticsNavProps> = ({ title }) => {
  const { pathname } = useLocation();

  return (
    <nav
      className="mb-8"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      <div className="flex items-center justify-between px-0 pb-0">
        {/* Left: back + title */}
        <div className="flex items-center gap-4">
          <Link
            to="/promptops"
            className="flex items-center gap-1.5 text-[11px] text-neutral-600 hover:text-neutral-300 transition-colors pb-4"
          >
            <ArrowLeft size={12} />
            PromptOps
          </Link>
          <span className="text-[11px] text-neutral-700 pb-4">›</span>
          <span className="text-[13px] font-semibold text-neutral-300 pb-4">{title}</span>
        </div>

        {/* Right: tabs */}
        <div className="flex items-end gap-0">
          {tabs.map(tab => {
            const active = pathname === tab.path;
            return (
              <Link
                key={tab.path}
                to={tab.path}
                className="relative px-4 pb-3.5 text-[12px] font-medium transition-colors"
                style={{ color: active ? '#fb7185' : '#57534e' }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = '#a8a29e'; }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = '#57534e'; }}
              >
                {tab.label}
                {active && (
                  <span
                    className="absolute bottom-0 left-4 right-4 h-[2px] rounded-full"
                    style={{ background: '#f43f5e' }}
                  />
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
};

export default AnalyticsNav;
