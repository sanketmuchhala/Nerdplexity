import React, { useState } from 'react';
import { Play, Loader2, CheckCircle, XCircle } from 'lucide-react';
import AnalyticsNav from './components/AnalyticsNav';

interface BenchmarkResult {
  prompt: string;
  ttft_ms: number;
  latency_ms: number;
  tokens: number;
  status: 'success' | 'error';
  error?: string;
}

interface BenchmarkStats {
  ttft_p50: number;
  ttft_p95: number;
  latency_p50: number;
  latency_p95: number;
  success_rate: number;
  avg_tokens: number;
}

const BENCHMARK_PROMPTS = [
  "Hi",
  "What is 2 + 2?",
  "Explain quantum computing in simple terms."
];

const BenchmarkPage: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [stats, setStats] = useState<BenchmarkStats | null>(null);

  const calculatePercentile = (values: number[], percentile: number): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.floor((percentile / 100) * (sorted.length - 1));
    return sorted[index] || 0;
  };

  const calculateStats = (results: BenchmarkResult[]): BenchmarkStats => {
    const successful = results.filter(r => r.status === 'success');
    const ttfts = successful.map(r => r.ttft_ms);
    const latencies = successful.map(r => r.latency_ms);

    return {
      ttft_p50: calculatePercentile(ttfts, 50),
      ttft_p95: calculatePercentile(ttfts, 95),
      latency_p50: calculatePercentile(latencies, 50),
      latency_p95: calculatePercentile(latencies, 95),
      success_rate: (successful.length / results.length) * 100,
      avg_tokens: successful.reduce((acc, r) => acc + r.tokens, 0) / successful.length || 0
    };
  };

  const runBenchmark = async (prompt: string): Promise<BenchmarkResult> => {
    const startTime = Date.now();
    let ttft_ms = 0;
    let firstTokenReceived = false;

    try {
      // Get current settings from localStorage or default
      const settings = JSON.parse(localStorage.getItem('byok-settings') || '{}');
      const model = settings.currentModel || 'gemma2:2b';

      const response = await fetch('/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          provider: 'local-ollama',
          model: model,
          temperature: 0.2,
          max_tokens: 128,
          baseURL: 'http://localhost:11434',
          performanceMode: true
        })
      });

      if (!firstTokenReceived) {
        ttft_ms = Date.now() - startTime;
        firstTokenReceived = true;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const latency_ms = Date.now() - startTime;
      const tokens = Math.floor((data.message?.content?.length || 0) / 4); // Rough estimate

      return {
        prompt,
        ttft_ms,
        latency_ms,
        tokens,
        status: 'success'
      };

    } catch (error: any) {
      return {
        prompt,
        ttft_ms: ttft_ms || Date.now() - startTime,
        latency_ms: Date.now() - startTime,
        tokens: 0,
        status: 'error',
        error: error.message
      };
    }
  };

  const runAllBenchmarks = async () => {
    setIsRunning(true);
    setResults([]);
    setStats(null);

    const allResults: BenchmarkResult[] = [];

    for (const prompt of BENCHMARK_PROMPTS) {
      console.log(`Running benchmark: "${prompt}"`);
      const result = await runBenchmark(prompt);
      allResults.push(result);
      setResults([...allResults]); // Update results incrementally

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const benchmarkStats = calculateStats(allResults);
    setStats(benchmarkStats);
    setIsRunning(false);
  };

  const formatMs = (ms: number): string => {
    return `${Math.round(ms)}ms`;
  };

  const getStatusIcon = (status: string) => {
    return status === 'success' ?
      <CheckCircle className="w-4 h-4 text-green-400" /> :
      <XCircle className="w-4 h-4 text-red-400" />;
  };

  return (
    <div className="min-h-screen font-sans" style={{ background: 'var(--bg)', color: 'var(--t1)' }}><div className="max-w-4xl mx-auto px-6 py-6">
      <AnalyticsNav title="Performance Benchmark" />

      <header className="mb-8">
        <h1 className="text-[22px] font-bold tracking-tight style-replaced mb-1">Performance Benchmark</h1>
        <p className="text-[13px] style-replaced">
          Test TTFT and latency performance for local Ollama models
        </p>
      </header>

      {/* Controls */}
      <div className="mb-8">
        <button
          onClick={runAllBenchmarks}
          disabled={isRunning}
          className="flex items-center gap-3 bg-blue-600 hover:bg-nerdplexity-700 disabled:bg-neutral-700
                     text-white font-medium px-6 py-3 rounded-lg transition-all duration-200
                     nerdplexity-glow disabled:cursor-not-allowed"
        >
          {isRunning ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Running Benchmarks...
            </>
          ) : (
            <>
              <Play className="w-5 h-5" />
              Run Performance Test
            </>
          )}
        </button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-blue-400">{formatMs(stats.ttft_p50)}</div>
            <div className="text-xs style-replaced uppercase tracking-wide">TTFT p50</div>
          </div>
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-blue-400">{formatMs(stats.ttft_p95)}</div>
            <div className="text-xs style-replaced uppercase tracking-wide">TTFT p95</div>
          </div>
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-blue-400">{formatMs(stats.latency_p50)}</div>
            <div className="text-xs style-replaced uppercase tracking-wide">Latency p50</div>
          </div>
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-blue-400">{formatMs(stats.latency_p95)}</div>
            <div className="text-xs style-replaced uppercase tracking-wide">Latency p95</div>
          </div>
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-blue-400">{Math.round(stats.success_rate)}%</div>
            <div className="text-xs style-replaced uppercase tracking-wide">Success Rate</div>
          </div>
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-blue-400">{Math.round(stats.avg_tokens)}</div>
            <div className="text-xs style-replaced uppercase tracking-wide">Avg Tokens</div>
          </div>
        </div>
      )}

      {/* Results Table */}
      {results.length > 0 && (
        <div className="bg-neutral-900 border border-neutral-700 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-neutral-800">
            <h3 className="text-lg font-semibold text-blue-400">Benchmark Results</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-neutral-800 text-blue-400">
                <tr>
                  <th className="text-left py-3 px-4 font-semibold">Status</th>
                  <th className="text-left py-3 px-4 font-semibold">Prompt</th>
                  <th className="text-right py-3 px-4 font-semibold">TTFT</th>
                  <th className="text-right py-3 px-4 font-semibold">Latency</th>
                  <th className="text-right py-3 px-4 font-semibold">Tokens</th>
                  <th className="text-left py-3 px-4 font-semibold">Error</th>
                </tr>
              </thead>
              <tbody className="style-replaced">
                {results.map((result, index) => (
                  <tr key={index} className="border-t border-neutral-800 hover:bg-neutral-800/50">
                    <td className="py-3 px-4">
                      {getStatusIcon(result.status)}
                    </td>
                    <td className="py-3 px-4 max-w-xs truncate">
                      {result.prompt}
                    </td>
                    <td className="py-3 px-4 text-right font-mono">
                      {formatMs(result.ttft_ms)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono">
                      {formatMs(result.latency_ms)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono">
                      {result.tokens}
                    </td>
                    <td className="py-3 px-4 text-red-400 max-w-xs truncate">
                      {result.error || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="mt-8 bg-neutral-900 border border-neutral-700 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-blue-400 mb-4">Performance Tips</h3>
        <div className="space-y-2 style-replaced">
          <p>• Ensure <code className="text-blue-400">OLLAMA_NUM_PARALLEL=1</code> is set</p>
          <p>• Start Ollama with <code className="text-blue-400">ollama serve</code></p>
          <p>• Target: TTFT &lt; 1500ms, Latency &lt; 3500ms for optimal performance</p>
          <p>• Close other heavy applications for best results</p>
        </div>
      </div>
    </div>
    </div>
  );
};

export default BenchmarkPage;