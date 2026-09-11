import { Cpu } from 'lucide-react';
import * as Icons from '@lobehub/icons';
import { useMemo } from 'react';

// Common mapping from provider/family name to @lobehub/icons component names
const ALIAS_MAP: Record<string, string> = {
  'openai': 'OpenAI',
  'gpt': 'OpenAI',
  'o1': 'OpenAI',
  'o3': 'OpenAI',
  'anthropic': 'Anthropic',
  'claude': 'Anthropic',
  'google': 'Google',
  'gemini': 'Gemini',
  'gemma': 'Gemma',
  'meta': 'Meta',
  'meta-llama': 'Meta',
  'llama': 'Meta',
  'mistralai': 'Mistral',
  'mistral': 'Mistral',
  'mixtral': 'Mistral',
  'mathstral': 'Mistral',
  'pixtral': 'Mistral',
  'deepseek': 'DeepSeek',
  'xai': 'XAI',
  'x-ai': 'XAI',
  'grok': 'XAI',
  'cohere': 'Cohere',
  'command': 'Cohere',
  'perplexity': 'Perplexity',
  'sonar': 'Perplexity',
  'qwen': 'Qwen',
  'alibaba': 'Alibaba',
  'microsoft': 'Microsoft',
  'phi': 'Microsoft',
  'wizardlm': 'Microsoft',
  'nvidia': 'Nvidia',
  'amazon': 'Aws',
  'aws': 'Aws',
  'nova': 'Aws',
  'bedrock': 'Aws',
  'moonshotai': 'Moonshot',
  'moonshot': 'Moonshot',
  'kimi': 'Moonshot',
  'minimax': 'Minimax',
  'z-ai': 'Zhipu',
  'zai': 'Zhipu',
  'glm': 'Zhipu',
  'zhipu': 'Zhipu',
  'zhipuai': 'Zhipu',
  'nousresearch': 'NousResearch',
  'nous': 'NousResearch',
  'ai21': 'Ai21',
  'jamba': 'Ai21',
  '01-ai': 'ZeroOne',
  '01ai': 'ZeroOne',
  'yi': 'ZeroOne',
  'databricks': 'Databricks',
  'dbrx': 'Dbrx',
  'rekaai': 'Reka',
  'reka': 'Reka',
  'liquid': 'Liquid',
  'lfm': 'Liquid',
  'black-forest-labs': 'Bfl',
  'flux': 'Bfl',
  'bytedance': 'ByteDance',
  'bytedance-seed': 'ByteDance',
  'tencent': 'Tencent',
  'stepfun': 'Stepfun',
  'arcee-ai': 'Arcee',
  'arcee': 'Arcee',
  'openrouter': 'OpenRouter',
  'huggingface': 'HuggingFace',
  'together': 'Together',
  'ollama': 'Ollama',
  'lmstudio': 'LmStudio',
  'lm-studio': 'LmStudio',
  'groq': 'Groq',
  'baseten': 'Baseten',
  'cloudflare': 'Cloudflare',
  'huggingface-api': 'HuggingFace',
  'togetherai': 'Together',
  'aion-labs': 'AionLabs',
  'ibm-granite': 'IBM',
  'ibm': 'IBM',
  'kwaipilot': 'Kwaipilot',
  'poolside': 'Poolside',
  'relace': 'Relace',
  'upstage': 'Upstage',
  'xiaomi': 'XiaomiMiMo',
  'morph': 'Morph'
};

const resolveIcon = (idPart: string) => {
  const normalized = idPart.toLowerCase().trim();
  const mapped = ALIAS_MAP[normalized];
  if (mapped && Icons[mapped as keyof typeof Icons]) return Icons[mapped as keyof typeof Icons] as any;
  
  // Try pascal case (e.g. 'foo-bar' -> 'FooBar')
  const pascal = normalized
    .split(/[-_]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
    
  if (Icons[pascal as keyof typeof Icons]) return Icons[pascal as keyof typeof Icons] as any;
  
  // Try just uppercase first letter
  const simplePascal = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  if (Icons[simplePascal as keyof typeof Icons]) return Icons[simplePascal as keyof typeof Icons] as any;
  
  return null;
};

interface ModelLogoProps {
  modelId: string;
  provider: string;
  local?: boolean;
}

export default function ModelLogo({ modelId, provider, local }: ModelLogoProps) {
  const IconComponent = useMemo(() => {
    // 1. Try model specific, then model family, then provider
    // Model ID format is often "provider/model-family-details" e.g., "anthropic/claude-3-opus"
    
    let parts: string[] = [];
    if (modelId.includes('/')) {
      const [prov, ...rest] = modelId.split('/');
      parts.push(prov);
      // Split the model part by dashes to test components like "claude", "gpt"
      parts.push(...rest.join('/').split(/[-_:]/));
    } else {
      parts = modelId.split(/[-_:]/);
    }
    
    // We check from most specific to least specific
    // Actually, usually the model family (claude, gpt) or provider (anthropic, openai) are the best bets.
    // Provider passed as prop might be "anthropic" or "OpenAI".
    
    const candidates = [
      ...parts,
      provider.toLowerCase(),
    ];
    
    // Test each candidate
    for (const cand of candidates) {
      const Comp = resolveIcon(cand);
      if (Comp) return Comp;
    }
    
    return null;
  }, [modelId, provider]);

  // If local, maybe return an icon if it's Ollama or LMStudio, else generic CPU
  if (!IconComponent && local) {
    return (
      <div className="np-logo-container np-bg-dark">
        <Cpu size={24} color="#b5df98" />
      </div>
    );
  }

  if (IconComponent) {
    if (IconComponent.Avatar) {
      const Avatar = IconComponent.Avatar;
      return (
        <div className="np-logo-avatar">
          <Avatar size={32} />
        </div>
      );
    }
    const Comp = IconComponent.Color || IconComponent;
    return (
      <div className="np-logo-container">
        <Comp size={20} />
      </div>
    );
  }

  // Generic fallback
  let initial = 'M';
  if (provider && provider.toLowerCase() !== 'openrouter' && provider.toLowerCase() !== 'custom') {
    initial = provider.charAt(0).toUpperCase();
  } else if (modelId) {
    const parts = modelId.split('/');
    if (parts.length > 1) {
      initial = parts[0].charAt(0).toUpperCase();
    } else {
      initial = modelId.charAt(0).toUpperCase();
    }
  }

  if (process.env.NODE_ENV === 'development') {
    console.warn(`[ModelLogo] Missing icon mapping for modelId="${modelId}" provider="${provider}"`);
  }

  return (
    <div className="np-logo-container np-bg-gradient">
      <span>{initial}</span>
    </div>
  );
}
