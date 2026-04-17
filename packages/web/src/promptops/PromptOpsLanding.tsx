import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BarChart3, List, Zap } from 'lucide-react';

const PromptOpsLanding: React.FC = () => {
  return (
    <div className="mx-auto max-w-screen-xl p-6 bg-neutral-950 text-neutral-200 font-sans min-h-screen">
      {/* Header with back to chat */}
      <div className="mb-8">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-neutral-400 hover:text-nerdplexity-300 transition-colors mb-6"
        >
          <ArrowLeft size={16} />
          <span className="text-sm">Back to Nerdplexity</span>
        </Link>

        <div className="text-center">
          <h1 className="text-4xl font-bold text-white mb-4">PromptOps Analytics</h1>
          <p className="text-xl text-neutral-400 max-w-2xl mx-auto">
            Monitor, analyze, and optimize your AI assistant's performance with comprehensive analytics and insights
          </p>
        </div>
      </div>

      {/* Main Navigation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
        {/* Dashboard Card */}
        <Link
          to="/dashboard"
          className="group bg-neutral-900 border border-neutral-700 rounded-2xl p-8 hover:border-nerdplexity-600 transition-all duration-300 nerdplexity-glow hover:nerdplexity-glow-strong"
        >
          <div className="flex items-center gap-4 mb-6">
            <div className="p-3 bg-nerdplexity-600 rounded-xl nerdplexity-glow-strong">
              <BarChart3 size={32} className="text-white" />
            </div>
            <h2 className="text-2xl font-bold text-white">Metrics Dashboard</h2>
          </div>

          <p className="text-neutral-400 mb-6 leading-relaxed">
            View comprehensive performance metrics, KPIs, and visualizations. Monitor latency, success rates, token usage, and system health in real-time.
          </p>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="text-center p-3 bg-neutral-800 rounded-lg">
              <div className="text-lg font-bold text-nerdplexity-300">13</div>
              <div className="text-xs text-neutral-500">Key Metrics</div>
            </div>
            <div className="text-center p-3 bg-neutral-800 rounded-lg">
              <div className="text-lg font-bold text-nerdplexity-300">8</div>
              <div className="text-xs text-neutral-500">Visualizations</div>
            </div>
          </div>

          <div className="flex items-center text-nerdplexity-400 group-hover:text-nerdplexity-300 transition-colors">
            <span className="font-medium">View Dashboard</span>
            <span className="ml-2 transform group-hover:translate-x-1 transition-transform">→</span>
          </div>
        </Link>

        {/* All Events Card */}
        <Link
          to="/events"
          className="group bg-neutral-900 border border-neutral-700 rounded-2xl p-8 hover:border-nerdplexity-600 transition-all duration-300 nerdplexity-glow hover:nerdplexity-glow-strong"
        >
          <div className="flex items-center gap-4 mb-6">
            <div className="p-3 bg-nerdplexity-600 rounded-xl nerdplexity-glow-strong">
              <List size={32} className="text-white" />
            </div>
            <h2 className="text-2xl font-bold text-white">All Events</h2>
          </div>

          <p className="text-neutral-400 mb-6 leading-relaxed">
            Detailed event logs of all LLM interactions. Analyze individual requests, responses, performance data, and troubleshoot issues.
          </p>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="text-center p-3 bg-neutral-800 rounded-lg">
              <div className="text-lg font-bold text-nerdplexity-300">19</div>
              <div className="text-xs text-neutral-500">Data Columns</div>
            </div>
            <div className="text-center p-3 bg-neutral-800 rounded-lg">
              <div className="text-lg font-bold text-nerdplexity-300">∞</div>
              <div className="text-xs text-neutral-500">Event History</div>
            </div>
          </div>

          <div className="flex items-center text-nerdplexity-400 group-hover:text-nerdplexity-300 transition-colors">
            <span className="font-medium">View Events</span>
            <span className="ml-2 transform group-hover:translate-x-1 transition-transform">→</span>
          </div>
        </Link>

        {/* Performance Benchmark Card */}
        <Link
          to="/benchmark"
          className="group bg-neutral-900 border border-neutral-700 rounded-2xl p-8 hover:border-nerdplexity-600 transition-all duration-300 nerdplexity-glow hover:nerdplexity-glow-strong"
        >
          <div className="flex items-center gap-4 mb-6">
            <div className="p-3 bg-nerdplexity-600 rounded-xl nerdplexity-glow-strong">
              <Zap size={32} className="text-white" />
            </div>
            <h2 className="text-2xl font-bold text-white">Performance Benchmark</h2>
          </div>

          <p className="text-neutral-400 mb-6 leading-relaxed">
            Test TTFT and latency performance for your local Ollama models. Run standardized benchmarks to optimize settings.
          </p>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="text-center p-3 bg-neutral-800 rounded-lg">
              <div className="text-lg font-bold text-nerdplexity-300">3</div>
              <div className="text-xs text-neutral-500">Test Prompts</div>
            </div>
            <div className="text-center p-3 bg-neutral-800 rounded-lg">
              <div className="text-lg font-bold text-nerdplexity-300">p50/p95</div>
              <div className="text-xs text-neutral-500">Statistics</div>
            </div>
          </div>

          <div className="flex items-center text-nerdplexity-400 group-hover:text-nerdplexity-300 transition-colors">
            <span className="font-medium">Run Benchmark</span>
            <span className="ml-2 transform group-hover:translate-x-1 transition-transform">→</span>
          </div>
        </Link>
      </div>

      {/* Feature Highlights */}
      <div className="mt-16 max-w-6xl mx-auto">
        <h3 className="text-2xl font-bold text-white text-center mb-12">What You Can Monitor</h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="text-center">
            <div className="w-12 h-12 bg-nerdplexity-900 rounded-xl flex items-center justify-center mx-auto mb-4 nerdplexity-glow">
              <span className="text-nerdplexity-300 font-bold">PERF</span>
            </div>
            <h4 className="font-semibold text-white mb-2">Performance</h4>
            <p className="text-sm text-neutral-400">Latency, TTFT, throughput, and response quality metrics</p>
          </div>

          <div className="text-center">
            <div className="w-12 h-12 bg-nerdplexity-900 rounded-xl flex items-center justify-center mx-auto mb-4 nerdplexity-glow">
              <span className="text-nerdplexity-300 font-bold">COST</span>
            </div>
            <h4 className="font-semibold text-white mb-2">Cost Efficiency</h4>
            <p className="text-sm text-neutral-400">Token usage, cost per conversation, and budget tracking</p>
          </div>

          <div className="text-center">
            <div className="w-12 h-12 bg-nerdplexity-900 rounded-xl flex items-center justify-center mx-auto mb-4 nerdplexity-glow">
              <span className="text-nerdplexity-300 font-bold">QUAL</span>
            </div>
            <h4 className="font-semibold text-white mb-2">Quality Insights</h4>
            <p className="text-sm text-neutral-400">Error rates, success metrics, and user satisfaction</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PromptOpsLanding;