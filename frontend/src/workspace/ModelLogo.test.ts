import { describe, expect, it } from 'vitest';
import { brandFor, formatModelName } from './ModelLogo';

describe('model logos', () => {
  it.each([
    ['anthropic/claude-opus-5', '', 'claude'],
    ['claude-opus-5', 'anthropic', 'claude'],
    ['openai/gpt-5-mini', '', 'openai'],
    ['gpt-4o', '', 'openai'],
    ['google/gemma-4-31b-it:free', 'openrouter', 'gemma'],
    ['nvidia/nemotron-3-super-120b-a12b:free', 'openrouter', 'nvidia'],
    ['qwen2.5-coder:7b', 'ollama', 'qwen'],
    ['meta-llama/llama-3.3-70b-instruct', '', 'meta'],
    ['llama3.2:3b', 'ollama', 'meta'],
    ['my-finetune', 'ollama', 'ollama'],
    ['~anthropic/claude-sonnet-latest', 'openrouter', 'claude'],
    ['~moonshotai/some-new-model', 'openrouter', 'moonshot'],
  ])('%s on %s uses the %s logo', (id, provider, brand) => {
    expect(brandFor(id, provider)).toBe(brand);
  });

  it('has no logo for unknown names, including object built-ins', () => {
    expect(brandFor('mystery/model-x', 'custom-endpoint')).toBeNull();
    expect(brandFor('constructor', 'toString')).toBeNull();
  });

  it('prefers the catalog name and otherwise formats the model ID', () => {
    expect(formatModelName('Google: Gemma 4 31B (free)', 'google/gemma-4-31b-it:free')).toBe('Google: Gemma 4 31B (free)');
    expect(formatModelName(undefined, 'google/gemma-4-31b-it:free')).toBe('Gemma 4 31b It (free)');
    expect(formatModelName('openai/gpt-5-mini', 'openai/gpt-5-mini')).toBe('GPT 5 Mini');
    expect(formatModelName(undefined, 'glm-4.6')).toBe('GLM 4.6');
  });
});
