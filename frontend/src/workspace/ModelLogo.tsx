import { Cpu } from 'lucide-react';
// Static brand SVGs (MIT, @lobehub/icons-static-svg). Only the files imported here are bundled.
// They sit on a white circle, so icons whose color version is white or pale use the one-color file.
import ai21 from '@lobehub/icons-static-svg/icons/ai21.svg?url';
import aionlabs from '@lobehub/icons-static-svg/icons/aionlabs-color.svg?url';
import alibaba from '@lobehub/icons-static-svg/icons/alibaba-color.svg?url';
import arcee from '@lobehub/icons-static-svg/icons/arcee-color.svg?url';
import aws from '@lobehub/icons-static-svg/icons/aws-color.svg?url';
import baseten from '@lobehub/icons-static-svg/icons/baseten.svg?url';
import bfl from '@lobehub/icons-static-svg/icons/bfl.svg?url';
import bytedance from '@lobehub/icons-static-svg/icons/bytedance-color.svg?url';
import claude from '@lobehub/icons-static-svg/icons/claude-color.svg?url';
import cloudflare from '@lobehub/icons-static-svg/icons/cloudflare-color.svg?url';
import cohere from '@lobehub/icons-static-svg/icons/cohere-color.svg?url';
import dbrx from '@lobehub/icons-static-svg/icons/dbrx-color.svg?url';
import deepseek from '@lobehub/icons-static-svg/icons/deepseek-color.svg?url';
import gemini from '@lobehub/icons-static-svg/icons/gemini-color.svg?url';
import gemma from '@lobehub/icons-static-svg/icons/gemma-color.svg?url';
import google from '@lobehub/icons-static-svg/icons/google-color.svg?url';
import groq from '@lobehub/icons-static-svg/icons/groq.svg?url';
import huggingface from '@lobehub/icons-static-svg/icons/huggingface-color.svg?url';
import ibm from '@lobehub/icons-static-svg/icons/ibm.svg?url';
import kimi from '@lobehub/icons-static-svg/icons/kimi.svg?url';
import kwaipilot from '@lobehub/icons-static-svg/icons/kwaipilot.svg?url';
import liquid from '@lobehub/icons-static-svg/icons/liquid.svg?url';
import lmstudio from '@lobehub/icons-static-svg/icons/lmstudio.svg?url';
import meta from '@lobehub/icons-static-svg/icons/meta-color.svg?url';
import microsoft from '@lobehub/icons-static-svg/icons/microsoft-color.svg?url';
import minimax from '@lobehub/icons-static-svg/icons/minimax-color.svg?url';
import mistral from '@lobehub/icons-static-svg/icons/mistral-color.svg?url';
import moonshot from '@lobehub/icons-static-svg/icons/moonshot.svg?url';
import morph from '@lobehub/icons-static-svg/icons/morph-color.svg?url';
import nousresearch from '@lobehub/icons-static-svg/icons/nousresearch.svg?url';
import nvidia from '@lobehub/icons-static-svg/icons/nvidia-color.svg?url';
import ollama from '@lobehub/icons-static-svg/icons/ollama.svg?url';
import openai from '@lobehub/icons-static-svg/icons/openai.svg?url';
import openrouter from '@lobehub/icons-static-svg/icons/openrouter.svg?url';
import perplexity from '@lobehub/icons-static-svg/icons/perplexity-color.svg?url';
import poolside from '@lobehub/icons-static-svg/icons/poolside-color.svg?url';
import qwen from '@lobehub/icons-static-svg/icons/qwen-color.svg?url';
import relace from '@lobehub/icons-static-svg/icons/relace.svg?url';
import stepfun from '@lobehub/icons-static-svg/icons/stepfun-color.svg?url';
import tencent from '@lobehub/icons-static-svg/icons/tencent-color.svg?url';
import together from '@lobehub/icons-static-svg/icons/together-color.svg?url';
import upstage from '@lobehub/icons-static-svg/icons/upstage-color.svg?url';
import xai from '@lobehub/icons-static-svg/icons/xai.svg?url';
import xiaomimimo from '@lobehub/icons-static-svg/icons/xiaomimimo.svg?url';
import yi from '@lobehub/icons-static-svg/icons/yi-color.svg?url';
import zhipu from '@lobehub/icons-static-svg/icons/zhipu-color.svg?url';

const LOGOS = {
  ai21, aionlabs, alibaba, arcee, aws, baseten, bfl, bytedance, claude, cloudflare, cohere, dbrx, deepseek,
  gemini, gemma, google, groq, huggingface, ibm, kimi, kwaipilot, liquid, lmstudio, meta, microsoft, minimax,
  mistral, moonshot, morph, nousresearch, nvidia, ollama, openai, openrouter, perplexity, poolside, qwen,
  relace, stepfun, tencent, together, upstage, xai, xiaomimimo, yi, zhipu,
};
type Brand = keyof typeof LOGOS;

/** Provider, family, and model-name words mapped to a brand logo. A Map, so names like "constructor" never match. */
const ALIASES = new Map<string, Brand>(Object.entries({
  openai: 'openai', gpt: 'openai', o1: 'openai', o3: 'openai', o4: 'openai', chatgpt: 'openai',
  anthropic: 'claude', claude: 'claude',
  google: 'google', gemini: 'gemini', gemma: 'gemma',
  meta: 'meta', 'meta-llama': 'meta', llama: 'meta',
  mistralai: 'mistral', mistral: 'mistral', mixtral: 'mistral', mathstral: 'mistral', pixtral: 'mistral', codestral: 'mistral', devstral: 'mistral',
  deepseek: 'deepseek',
  xai: 'xai', 'x-ai': 'xai', grok: 'xai',
  cohere: 'cohere', command: 'cohere',
  perplexity: 'perplexity', sonar: 'perplexity',
  qwen: 'qwen', qwq: 'qwen', alibaba: 'alibaba',
  microsoft: 'microsoft', phi: 'microsoft', wizardlm: 'microsoft',
  nvidia: 'nvidia', nemotron: 'nvidia',
  amazon: 'aws', aws: 'aws', nova: 'aws', bedrock: 'aws',
  moonshotai: 'moonshot', moonshot: 'moonshot', kimi: 'kimi',
  minimax: 'minimax',
  'z-ai': 'zhipu', zai: 'zhipu', glm: 'zhipu', zhipu: 'zhipu', zhipuai: 'zhipu',
  nousresearch: 'nousresearch', nous: 'nousresearch', hermes: 'nousresearch',
  ai21: 'ai21', jamba: 'ai21',
  '01-ai': 'yi', '01ai': 'yi', yi: 'yi',
  databricks: 'dbrx', dbrx: 'dbrx',
  liquid: 'liquid', lfm: 'liquid',
  'black-forest-labs': 'bfl', flux: 'bfl',
  bytedance: 'bytedance', 'bytedance-seed': 'bytedance', seed: 'bytedance',
  tencent: 'tencent', hunyuan: 'tencent',
  stepfun: 'stepfun', 'stepfun-ai': 'stepfun',
  'arcee-ai': 'arcee', arcee: 'arcee',
  openrouter: 'openrouter',
  huggingface: 'huggingface', 'huggingface-api': 'huggingface',
  together: 'together', togetherai: 'together',
  ollama: 'ollama', lmstudio: 'lmstudio', 'lm-studio': 'lmstudio',
  groq: 'groq', baseten: 'baseten', cloudflare: 'cloudflare',
  'aion-labs': 'aionlabs', aionlabs: 'aionlabs',
  'ibm-granite': 'ibm', ibm: 'ibm', granite: 'ibm',
  kwaipilot: 'kwaipilot', poolside: 'poolside', laguna: 'poolside', relace: 'relace', upstage: 'upstage', solar: 'upstage',
  xiaomi: 'xiaomimimo', mimo: 'xiaomimimo', morph: 'morph',
}));

/**
 * The brand for a model: the model family (first word of the name, so "google/gemma" shows Gemma),
 * then the provider prefix, then the other words, then the connection's provider.
 */
export function brandFor(modelId: string, provider = ''): Brand | null {
  // OpenRouter alias IDs start with '~' (for example '~anthropic/claude-sonnet-latest').
  const [prefix, ...rest] = modelId.toLowerCase().replace(/^~/, '').split('/');
  const nameWords = (rest.length ? rest.join('/') : prefix).split(/[-_:.\s]+/);
  const words = rest.length ? [nameWords[0], prefix, ...nameWords.slice(1)] : nameWords;
  // Families like "gpt-4o" or "qwen2.5" carry version digits; also try the letters alone.
  const candidates = words.flatMap(word => [word, word.replace(/\d.*$/, '')]).concat(provider.toLowerCase());
  for (const candidate of candidates) {
    const brand = candidate && ALIASES.get(candidate);
    if (brand) return brand;
  }
  return null;
}

/** A readable name from a model ID when the catalog has no display name. */
export function formatModelName(displayName: string | undefined, id: string) {
  if (displayName && displayName !== id && !displayName.includes('/')) return displayName;
  const withoutProvider = id.includes('/') ? id.split('/').slice(1).join('/') : id;
  const [name, variant] = withoutProvider.split(':');
  const words = name.split(/[-_]/).filter(Boolean).map(w => {
    const lower = w.toLowerCase();
    if (lower === 'gpt' || lower === 'llm' || lower === 'glm') return lower.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  });
  return `${words.join(' ')}${variant ? ` (${variant})` : ''}`;
}

export default function ModelLogo({ modelId, provider, local, size = 32 }: { modelId: string; provider: string; local?: boolean; size?: number }) {
  const brand = brandFor(modelId, provider);
  const style = { width: size, height: size };
  if (brand) {
    return (
      <span className="np-logo-avatar" style={style} aria-hidden>
        <img src={LOGOS[brand]} alt="" width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} loading="lazy" />
      </span>
    );
  }
  if (local) {
    return <span className="np-logo-container np-bg-dark" style={style} aria-hidden><Cpu size={Math.round(size * 0.55)} /></span>;
  }
  const source = modelId.includes('/') ? modelId.split('/')[0] : provider && !['openrouter', 'custom'].includes(provider.toLowerCase()) ? provider : modelId;
  return <span className="np-logo-container np-bg-gradient" style={style} aria-hidden>{(source.charAt(0) || 'M').toUpperCase()}</span>;
}
