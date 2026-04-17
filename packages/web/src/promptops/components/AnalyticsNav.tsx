import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

interface AnalyticsNavProps {
  title: string;
}

const AnalyticsNav: React.FC<AnalyticsNavProps> = ({ title }) => {
  const location = useLocation();

  const navItems = [
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/events', label: 'All Events' }
  ];

  return (
    <nav className="mb-6 p-4 bg-neutral-900 rounded-xl border border-neutral-700 nerdplexity-border">
      <div className="flex items-center justify-between">
        {/* Back to Chat */}
        <Link
          to="/"
          className="flex items-center gap-2 text-neutral-400 hover:text-nerdplexity-300 transition-colors"
        >
          <ArrowLeft size={16} />
          <span className="text-sm">Back to Nerdplexity</span>
        </Link>

        {/* Current Page Title */}
        <h2 className="text-lg font-semibold text-nerdplexity-300">{title}</h2>

        {/* Navigation Links */}
        <div className="flex gap-2">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                location.pathname === item.path
                  ? 'bg-nerdplexity-600 text-white nerdplexity-glow-strong'
                  : 'text-neutral-400 hover:text-nerdplexity-300 hover:bg-neutral-800 hover:border-nerdplexity-600'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
};

export default AnalyticsNav;