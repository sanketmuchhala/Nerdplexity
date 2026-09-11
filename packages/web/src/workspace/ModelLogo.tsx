import { Cpu } from 'lucide-react';

interface ModelLogoProps {
  modelId: string;
  provider: string;
  local?: boolean;
}

export default function ModelLogo({ modelId, provider, local }: ModelLogoProps) {
  const p = provider.toLowerCase();
  const m = modelId.toLowerCase();

  // OpenAI
  if (p.includes('openai') || m.includes('gpt')) {
    return (
      <div className="np-logo-container np-bg-white">
        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
          <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A6.0651 6.0651 0 0 0 19.0192 19.82a5.9847 5.9847 0 0 0 3.9977-2.9 6.051 6.051 0 0 0-.735-7.0988zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.8956zm16.0993 3.8558L12.5973 8.3829 14.6174 7.2144a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.3927-.6813zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/>
        </svg>
      </div>
    );
  }

  // Anthropic
  if (p.includes('anthropic') || m.includes('claude')) {
    return (
      <div className="np-logo-container np-bg-cream">
        <svg viewBox="0 0 24 24" fill="#D3AA72" width="24" height="24">
          <path d="M17.15 4.5h2.9L12.2 19.5h-2.9l7.85-15zm-5.4 0h2.9l-2.1 4h-2.9l2.1-4zM6 4.5h2.9l-2.1 4H3.9l2.1-4zm4.2 8h2.9l-3.85 7h-2.9l3.85-7zM6 12.5h2.9l-2.1 4H3.9l2.1-4z"/>
        </svg>
      </div>
    );
  }

  // Google / Gemini
  if (p.includes('google') || m.includes('gemini') || p.includes('palm')) {
    return (
      <div className="np-logo-container np-bg-white">
        <svg viewBox="0 0 24 24" width="24" height="24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
      </div>
    );
  }

  // Meta
  if (p.includes('meta') || m.includes('llama')) {
    return (
      <div className="np-logo-container np-bg-blue">
        <svg viewBox="0 0 24 24" fill="white" width="24" height="24">
          <path d="M18.8 3c-1.3 0-2.6.4-3.7 1.1-.5.3-1 .6-1.4 1-1-1.3-2.6-2.1-4.3-2.1-3 0-5.4 2.4-5.4 5.4 0 3.7 3.4 5.9 5.8 7.1.5.3 1 .5 1.5.7 1 .4 2 .8 2.7 1.4.3.3.4.6.4.8 0 .4-.3.7-.7.7-1 0-1.8-1-2.2-1.7l-3.3 1.7c.9 1.7 2.6 2.9 4.6 2.9 2 0 3.8-1 4.7-2.5 1-1.6 1.4-3.5 1-5.3-.2-.8-.6-1.5-1.1-2.2-.4-.6-.8-1-1.3-1.5-.6-.5-1.2-1-1.9-1.4-.4-.2-.8-.4-1.2-.6-1.3-.6-2-1.1-2.4-1.5-.4-.4-.5-.9-.5-1.3 0-1.3 1-2.3 2.3-2.3.9 0 1.7.5 2 1.3L17 5.9c-.3-.8-1-1.4-1.9-1.4h-.3c1-.9 2.3-1.5 3.8-1.5 3 0 5.4 2.4 5.4 5.4S21.6 13.8 18.6 13.8c-1.7 0-3.3-.8-4.2-2.1L12 9c-.1-.1-.3-.1-.4-.2-.3-.1-.5-.2-.8-.3-.2.2-.4.5-.6.7-.1.1-.1.3-.2.4 1.2 1 2 2.6 2 4.3 0 1.7-.8 3.3-2 4.3 1.6.3 3.3.1 4.8-.8.6-.4 1.1-.9 1.5-1.5 1.6 1.2 3.6 1.9 5.7 1.9 4.7 0 8.5-3.8 8.5-8.5S23.5 3 18.8 3z"/>
        </svg>
      </div>
    );
  }

  // Mistral
  if (p.includes('mistral') || m.includes('mistral') || m.includes('mixtral')) {
    return (
      <div className="np-logo-container np-bg-orange">
        <svg viewBox="0 0 24 24" fill="white" width="24" height="24">
          <path d="M4 4h4v4H4V4zm6 0h4v4h-4V4zm6 0h4v4h-4V4zM4 10h4v4H4v-4zm12 0h4v4h-4v-4zM4 16h4v4H4v-4zm12 0h4v4h-4v-4z"/>
        </svg>
      </div>
    );
  }

  // Cohere
  if (p.includes('cohere') || m.includes('command')) {
    return (
      <div className="np-logo-container np-bg-white">
        <svg viewBox="0 0 24 24" fill="black" width="24" height="24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 17c-3.86 0-7-3.14-7-7s3.14-7 7-7 7 3.14 7 7-3.14 7-7 7zm3-7a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"/>
        </svg>
      </div>
    );
  }

  // Local fallback (Ollama, LMStudio, etc)
  if (local || p.includes('ollama') || p.includes('lmstudio')) {
    return (
      <div className="np-logo-container np-bg-dark">
        <Cpu size={24} color="#b5df98" />
      </div>
    );
  }

  // Generic Provider Fallback (Gradient with Initial)
  const initial = provider ? provider.charAt(0).toUpperCase() : 'M';
  return (
    <div className="np-logo-container np-bg-gradient">
      <span>{initial}</span>
    </div>
  );
}
