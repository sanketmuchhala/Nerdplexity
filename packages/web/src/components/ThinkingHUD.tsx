import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, Brain, Zap, Target } from "lucide-react";

interface ThinkingHUDProps {
  running: boolean;
  elapsedMs: number;
  tokensPerSec?: number;
  phase?: "Planning" | "Drafting" | "Refining";
  summary?: string;
}

export default function ThinkingHUD({
  running,
  elapsedMs,
  tokensPerSec,
  phase = "Planning",
  summary
}: ThinkingHUDProps) {
  const [expanded, setExpanded] = useState(false);
  const [progressDots, setProgressDots] = useState(0);
  const [phaseProgress, setPhaseProgress] = useState(0);
  const [showingDetail, setShowingDetail] = useState("");

  // Progressive loading animation
  useEffect(() => {
    if (!running) return;

    const interval = setInterval(() => {
      setProgressDots(prev => (prev + 1) % 4);
    }, 500);

    return () => clearInterval(interval);
  }, [running]);

  // Phase progress simulation (makes time feel faster)
  useEffect(() => {
    if (!running) return;

    const progressInterval = setInterval(() => {
      setPhaseProgress(prev => {
        // Accelerate progress perception
        const increment = prev < 50 ? 8 : prev < 80 ? 4 : 2;
        return Math.min(prev + increment, 95);
      });
    }, 300);

    return () => clearInterval(progressInterval);
  }, [running, phase]);

  // Reset progress when phase changes
  useEffect(() => {
    setPhaseProgress(0);
  }, [phase]);

  // Rotating thinking details (gives impression of active processing)
  useEffect(() => {
    if (!running) return;

    const details = [
      "Analyzing context patterns...",
      "Processing semantic relationships...",
      "Optimizing response structure...",
      "Synthesizing key insights...",
      "Refining language patterns...",
      "Validating logical consistency..."
    ];

    let currentIndex = 0;
    const detailInterval = setInterval(() => {
      setShowingDetail(details[currentIndex]);
      currentIndex = (currentIndex + 1) % details.length;
    }, 1200);

    return () => clearInterval(detailInterval);
  }, [running]);

  if (!running) return null;

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const getPhaseIcon = () => {
    switch (phase) {
      case "Planning": return <Brain className="w-4 h-4 text-blue-400" />;
      case "Drafting": return <Zap className="w-4 h-4 text-yellow-400" />;
      case "Refining": return <Target className="w-4 h-4 text-green-400" />;
      default: return <Brain className="w-4 h-4 text-blue-400" />;
    }
  };

  const getPhaseColor = () => {
    switch (phase) {
      case "Planning": return "text-blue-400";
      case "Drafting": return "text-yellow-400";
      case "Refining": return "text-green-400";
      default: return "text-blue-400";
    }
  };

  const getProgressBarColor = () => {
    switch (phase) {
      case "Planning": return "bg-blue-500";
      case "Drafting": return "bg-yellow-500";
      case "Refining": return "bg-green-500";
      default: return "bg-blue-500";
    }
  };

  return (
    <div className="rounded-xl bg-neutral-900 border border-nerdplexity-700 p-4 mb-3 nerdplexity-glow">
      {/* Main thinking header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {/* Animated phase icon */}
          <div className="relative">
            <div className="animate-spin-slow">
              {getPhaseIcon()}
            </div>
            <div className="absolute inset-0 animate-ping">
              <div className="w-4 h-4 rounded-full bg-current opacity-20"></div>
            </div>
          </div>

          {/* Phase with progress dots */}
          <div className="flex items-center gap-2">
            <span className={`font-medium ${getPhaseColor()}`}>
              {phase}
            </span>
            <span className="text-neutral-400">
              {".".repeat(progressDots + 1)}
            </span>
          </div>

          <div className="text-neutral-500">•</div>
          <span className="text-neutral-300 font-mono text-sm">
            {formatTime(elapsedMs)}
          </span>

          {tokensPerSec != null && tokensPerSec > 0 && (
            <>
              <div className="text-neutral-500">•</div>
              <div className="flex items-center gap-1">
                <div className="w-1 h-1 rounded-full bg-nerdplexity-400 animate-pulse"></div>
                <span className="text-nerdplexity-300 text-sm font-mono">
                  {tokensPerSec.toFixed(1)} tok/s
                </span>
              </div>
            </>
          )}
        </div>

        {/* Summary toggle */}
        {summary && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-neutral-400 hover:text-nerdplexity-300 transition-colors px-2 py-1 rounded-lg hover:bg-neutral-800"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>Details</span>
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="w-full bg-neutral-800 rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ease-out ${getProgressBarColor()} relative`}
            style={{ width: `${phaseProgress}%` }}
          >
            <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
          </div>
        </div>
      </div>

      {/* Dynamic processing detail */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-neutral-400 italic animate-fade-in">
          {showingDetail}
        </div>

        {/* Visual activity indicator */}
        <div className="flex items-center gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-1 h-3 bg-nerdplexity-500 rounded-full animate-bounce opacity-60"
              style={{
                animationDelay: `${i * 0.15}s`,
                animationDuration: '1s'
              }}
            />
          ))}
        </div>
      </div>

      {/* Expandable summary */}
      {summary && expanded && (
        <div className="mt-3 pt-3 border-t border-neutral-700 animate-slideDown">
          <div className="text-sm text-neutral-300 leading-relaxed">
            {summary}
          </div>
        </div>
      )}
    </div>
  );
}