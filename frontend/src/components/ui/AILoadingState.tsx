import './AILoadingState.css';

interface Props {
  phase?: string;
}

export function AILoadingState({ phase }: Props) {
  return (
    <div className="ai-loading-container" role="status">
      {/* 1. AI Glow Orb */}
      <div className="ai-glow-orb">
        <div className="ai-glow-orb-inner">
          <div className="orb-node color-magenta"></div>
          <div className="orb-node color-blue"></div>
          <div className="orb-node color-green"></div>
          <div className="orb-node color-yellow"></div>
          <div className="orb-node color-purple"></div>
        </div>
        <div className="ai-glow-orb-glass"></div>
      </div>
      
      {/* 2. Dynamic Status Text */}
      <div className="ai-status-text" key={phase}>
        {phase || 'Initializing AI...'}
      </div>
      
      {/* 3. Static Subtitle */}
      <div className="ai-static-subtitle">
        AI-Powered Search
      </div>
      
      {/* 4. Cycling Dot Indicator */}
      <div className="ai-cycling-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  );
}
