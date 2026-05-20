import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, AlertTriangle, Trash2, CheckCircle, XCircle } from 'lucide-react';
import { Modal, Button, Input, Badge } from './ui';
import useChat from '../state/chatStore';
import { Provider } from '../lib/db';
import { PROVIDER_NAMES, getModelsForProvider, getDefaultModelForProvider } from '../constants/models';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { 
    settings, 
    saveSettings, 
    getApiKey, 
    setApiKey, 
    testApiKey,
    loadSettings
  } = useChat();
  
  const [selectedProvider, setSelectedProvider] = useState<Provider>('openai');
  const [selectedModel, setSelectedModel] = useState('');
  const [currentApiKey, setCurrentApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(4000);
  const [webEnabled, setWebEnabled] = useState(false);
  const [mode, setMode] = useState<'direct' | 'research' | 'coach'>('direct');
  // Local Ollama specific fields
  const [baseURL, setBaseURL] = useState('http://localhost:11434');
  const [numCtx, setNumCtx] = useState(512);   // Ultra-fast context
  const [performanceMode, setPerformanceMode] = useState(true);
  const [numPredict, setNumPredict] = useState(64);   // Very short for speed
  const [topP, setTopP] = useState(0.7);   // Lower sampling
  const [topK, setTopK] = useState(10);    // Much fewer tokens
  const [numThread, setNumThread] = useState(2);  // Only 2 threads
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Load current settings when modal opens
  useEffect(() => {
    if (isOpen && settings) {
      setSelectedProvider(settings.selectedProvider);
      setCurrentApiKey(getApiKey(settings.selectedProvider));
      setSelectedModel(getDefaultModelForProvider(settings.selectedProvider));
      setTemperature(settings.temperature);
      setMaxTokens(settings.max_tokens);
      setWebEnabled(settings.web_enabled);
      setMode(settings.mode);
      setBaseURL(settings.baseURL || 'http://localhost:11434');
      setNumCtx(settings.num_ctx || 512);   // Ultra-fast context
      setPerformanceMode(settings.performanceMode !== false);
      setNumPredict(settings.numPredict || 64);   // Very short for speed
      setTopP(settings.topP || 0.7);   // Lower sampling
      setTopK(settings.topK || 10);    // Much fewer tokens
      setNumThread(settings.numThread || 2);  // Only 2 threads
    } else if (isOpen) {
      loadSettings();
    }
  }, [isOpen, settings, getApiKey, loadSettings]);

  // Update API key when provider changes
  useEffect(() => {
    if (settings) {
      setCurrentApiKey(getApiKey(selectedProvider));
      setSelectedModel(getDefaultModelForProvider(selectedProvider));
      setTestResult(null);
    }
  }, [selectedProvider, settings, getApiKey]);

  if (!isOpen) return null;

  const handleSave = async () => {
    // Save API key for current provider
    await setApiKey(selectedProvider, currentApiKey);
    
    // Save other settings
    await saveSettings({
      selectedProvider,
      temperature,
      max_tokens: maxTokens,
      web_enabled: webEnabled,
      mode,
      baseURL,
      num_ctx: numCtx,
      performanceMode,
      numPredict,
      topP,
      topK,
      numThread
    });
    
    // Update active conversation to use the selected model and provider
    const { activeConversation, updateConversationSettings } = useChat.getState();
    const currentConv = activeConversation();
    if (currentConv) {
      await updateConversationSettings(currentConv.id, {
        provider: selectedProvider,
        model: selectedModel,
        temperature,
        max_tokens: maxTokens,
        web_enabled: webEnabled
      });
    }
    
    onClose();
  };

  // Helper function to check if model exists in Ollama
  const ensureLocalModelExists = async (baseURL: string, model: string) => {
    try {
      const response = await fetch(`${baseURL.replace(/\/+$/, '')}/api/tags`);
      const data = await response.json();
      const models = data.models || [];
      return models.some((m: any) => m.model === model || m.name === model);
    } catch {
      return false;
    }
  };

  const handleTestKey = async () => {
    if (selectedProvider === 'local-ollama') {
      // For local-ollama, test connection and model availability
      setIsTestingKey(true);
      setTestResult(null);
      
      try {
        // First test connection
        const response = await fetch(`/v1/ping?provider=local-ollama&baseURL=${encodeURIComponent(baseURL)}`);
        const result = await response.json();
        
        if (!result.ok) {
          setTestResult(result);
          return;
        }

        // Then check if selected model exists
        const modelExists = await ensureLocalModelExists(baseURL, selectedModel);
        if (!modelExists) {
          setTestResult({ 
            ok: false, 
            message: `Model not installed: ${selectedModel}. Install with: ollama pull ${selectedModel}` 
          });
          return;
        }

        setTestResult({ ok: true, message: `Connected successfully. Model ${selectedModel} is available.` });
      } catch (error) {
        setTestResult({ ok: false, message: 'Connection test failed: ' + (error as Error).message });
      } finally {
        setIsTestingKey(false);
      }
    } else {
      // For API key based providers
      if (!currentApiKey.trim()) {
        setTestResult({ ok: false, message: 'Please enter an API key first' });
        return;
      }
      
      setIsTestingKey(true);
      setTestResult(null);
      
      // Temporarily save the key for testing
      await setApiKey(selectedProvider, currentApiKey);
      
      try {
        const result = await testApiKey(selectedProvider, selectedModel);
        setTestResult(result);
      } catch (error) {
        setTestResult({ ok: false, message: 'Test failed: ' + (error as Error).message });
      } finally {
        setIsTestingKey(false);
      }
    }
  };

  const maskKey = (key: string): string => {
    if (!key) return '';
    if (key.length <= 8) return '••••••••';
    return key.slice(0, 4) + '••••••••' + key.slice(-4);
  };

  const clearAllData = () => {
    if (confirm('Are you sure you want to clear all data? This will remove all API keys, settings, and chat history.')) {
      localStorage.clear();
      window.location.reload();
    }
  };

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title="Keys & Settings"
      size="xl"
    >
      <div className="space-y-6">
          {/* Security Warning */}
          <div className="panel bg-amber-900/20 border-amber-700">
            <div className="p-4 flex items-start gap-3">
              <AlertTriangle size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="heading-sm text-amber-200 mb-2">Security Notice</div>
                <div className="body-sm text-amber-300 leading-relaxed">
                  API keys are stored locally in your browser only. They are never sent anywhere except to AI providers directly. 
                  Git push is disabled to prevent accidental key exposure.
                </div>
              </div>
            </div>
          </div>
          
          {/* Section 1: API Keys */}
          <div className="space-y-4">
            <h3 className="heading-sm text-neutral-100 flex items-center gap-2">
              API Keys
              <span className="text-xs bg-blue-900/30 text-blue-400 px-2 py-1 rounded-full">Cloud Providers</span>
            </h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* OpenAI */}
              <div className="p-4 bg-neutral-800/50 rounded-xl border border-neutral-700">
                <div className="flex items-center justify-between mb-3">
                  <label className="font-medium text-neutral-200">OpenAI</label>
                  {getApiKey('openai') && getApiKey('openai').length > 10 && (
                    <Badge variant="success" size="sm">CONFIGURED</Badge>
                  )}
                </div>
                <div className="relative">
                  <Input
                    type={showKey && selectedProvider === 'openai' ? 'text' : 'password'}
                    value={showKey && selectedProvider === 'openai' 
                      ? getApiKey('openai') 
                      : (getApiKey('openai') ? maskKey(getApiKey('openai')) : '')
                    }
                    onChange={(e) => {
                      setSelectedProvider('openai');
                      setCurrentApiKey(e.target.value);
                    }}
                    placeholder="sk-..."
                    className="pr-12 font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedProvider('openai');
                      setShowKey(!showKey);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-neutral-600 rounded transition-colors text-neutral-400 hover:text-neutral-200"
                  >
                    {showKey && selectedProvider === 'openai' ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <div className="text-xs text-neutral-400 mt-2">GPT-4, GPT-3.5 models</div>
              </div>

              {/* Anthropic */}
              <div className="p-4 bg-neutral-800/50 rounded-xl border border-neutral-700">
                <div className="flex items-center justify-between mb-3">
                  <label className="font-medium text-neutral-200">Anthropic</label>
                  {getApiKey('anthropic') && getApiKey('anthropic').length > 10 && (
                    <Badge variant="success" size="sm">CONFIGURED</Badge>
                  )}
                </div>
                <div className="relative">
                  <Input
                    type={showKey && selectedProvider === 'anthropic' ? 'text' : 'password'}
                    value={showKey && selectedProvider === 'anthropic' 
                      ? getApiKey('anthropic') 
                      : (getApiKey('anthropic') ? maskKey(getApiKey('anthropic')) : '')
                    }
                    onChange={(e) => {
                      setSelectedProvider('anthropic');
                      setCurrentApiKey(e.target.value);
                    }}
                    placeholder="sk-ant-..."
                    className="pr-12 font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedProvider('anthropic');
                      setShowKey(!showKey);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-neutral-600 rounded transition-colors text-neutral-400 hover:text-neutral-200"
                  >
                    {showKey && selectedProvider === 'anthropic' ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <div className="text-xs text-neutral-400 mt-2">Claude 3.5 Sonnet, Haiku</div>
              </div>

              {/* Google Gemini */}
              <div className="p-4 bg-neutral-800/50 rounded-xl border border-neutral-700">
                <div className="flex items-center justify-between mb-3">
                  <label className="font-medium text-neutral-200">Google Gemini</label>
                  {getApiKey('gemini') && getApiKey('gemini').length > 10 && (
                    <Badge variant="success" size="sm">CONFIGURED</Badge>
                  )}
                </div>
                <div className="relative">
                  <Input
                    type={showKey && selectedProvider === 'gemini' ? 'text' : 'password'}
                    value={showKey && selectedProvider === 'gemini' 
                      ? getApiKey('gemini') 
                      : (getApiKey('gemini') ? maskKey(getApiKey('gemini')) : '')
                    }
                    onChange={(e) => {
                      setSelectedProvider('gemini');
                      setCurrentApiKey(e.target.value);
                    }}
                    placeholder="AI..."
                    className="pr-12 font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedProvider('gemini');
                      setShowKey(!showKey);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-neutral-600 rounded transition-colors text-neutral-400 hover:text-neutral-200"
                  >
                    {showKey && selectedProvider === 'gemini' ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <div className="text-xs text-neutral-400 mt-2">Gemini Pro, Flash models</div>
              </div>

              {/* DeepSeek */}
              <div className="p-4 bg-neutral-800/50 rounded-xl border border-neutral-700">
                <div className="flex items-center justify-between mb-3">
                  <label className="font-medium text-neutral-200">DeepSeek</label>
                  {getApiKey('deepseek') && getApiKey('deepseek').length > 10 && (
                    <Badge variant="success" size="sm">CONFIGURED</Badge>
                  )}
                </div>
                <div className="relative">
                  <Input
                    type={showKey && selectedProvider === 'deepseek' ? 'text' : 'password'}
                    value={showKey && selectedProvider === 'deepseek' 
                      ? getApiKey('deepseek') 
                      : (getApiKey('deepseek') ? maskKey(getApiKey('deepseek')) : '')
                    }
                    onChange={(e) => {
                      setSelectedProvider('deepseek');
                      setCurrentApiKey(e.target.value);
                    }}
                    placeholder="sk-..."
                    className="pr-12 font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedProvider('deepseek');
                      setShowKey(!showKey);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-neutral-600 rounded transition-colors text-neutral-400 hover:text-neutral-200"
                  >
                    {showKey && selectedProvider === 'deepseek' ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <div className="text-xs text-neutral-400 mt-2">DeepSeek Chat, Coder, R1</div>
              </div>
            </div>

            {/* Test API Key Button */}
            {selectedProvider !== 'local-ollama' && (
              <div className="flex items-center gap-3 pt-2">
                <Button
                  onClick={handleTestKey}
                  disabled={isTestingKey || !currentApiKey.trim()}
                  variant="primary"
                  size="sm"
                >
                  {isTestingKey ? 'Testing...' : `Test ${PROVIDER_NAMES[selectedProvider]} Key`}
                </Button>
                
                {testResult && (
                  <div className={`flex items-center gap-2 body-sm ${testResult.ok ? 'text-nerdplexity-400' : 'text-red-400'}`}>
                    {testResult.ok ? <CheckCircle size={16} /> : <XCircle size={16} />}
                    <span>{testResult.message}</span>
                  </div>
                )}
              </div>
            )}
          </div>
          
          {/* Section 2: Local Models */}
          <div className="space-y-4">
            <h3 className="heading-sm text-neutral-100 flex items-center gap-2">
              Local Models
              <span className="text-xs bg-nerdplexity-950/40 text-nerdplexity-400 px-2 py-1 rounded-full">Ollama</span>
            </h3>
            
            <div className="p-6 bg-gradient-to-br from-neutral-800/80 to-neutral-900/80 rounded-xl border border-neutral-600">
              {/* Active Provider/Model Selection */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block body-sm font-medium mb-3 text-neutral-200">
                    Active Provider
                  </label>
                  <select
                    value={selectedProvider}
                    onChange={(e) => setSelectedProvider(e.target.value as Provider)}
                    className="w-full p-3 bg-neutral-700 text-neutral-100 border border-neutral-600 rounded-xl focus-ring text-lg"
                  >
                    {Object.entries(PROVIDER_NAMES).map(([key, name]) => (
                      <option key={key} value={key}>{name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block body-sm font-medium mb-3 text-neutral-200">
                    Model
                  </label>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full p-3 bg-neutral-700 text-neutral-100 border border-neutral-600 rounded-xl focus-ring text-lg"
                  >
                    {getModelsForProvider(selectedProvider).map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                  {selectedProvider === 'local-ollama' && (
                    <div className="muted mt-2">
                      See installed models: <code className="bg-neutral-700 px-1 rounded">ollama list</code>
                    </div>
                  )}
                </div>
              </div>
            
            {/* Local Ollama Configuration */}
            {selectedProvider === 'local-ollama' && (
              <div className="space-y-4">
                <div>
                  <label className="block body-sm font-medium mb-3 text-neutral-200">
                    Base URL
                  </label>
                  <Input
                    type="text"
                    value={baseURL}
                    onChange={(e) => setBaseURL(e.target.value)}
                    placeholder="http://localhost:11434"
                    className="font-mono text-sm"
                  />
                  <div className="muted mt-2">
                    URL to your local Ollama server
                  </div>
                </div>
                
                <div>
                  <label className="block body-sm font-medium mb-3 text-neutral-200">
                    Context Size (num_ctx): {performanceMode ? Math.min(numCtx, 512) : numCtx}
                  </label>
                  <input
                    type="range"
                    min="256"
                    max="2048" 
                    step="256"
                    value={numCtx}
                    onChange={(e) => setNumCtx(parseInt(e.target.value))}
                    className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer slider"
                    disabled={performanceMode}
                  />
                  <div className="muted mt-2">
                    {performanceMode ? 'Limited to 512 in Performance Mode for INSTANT responses' : 'Context window size for the model'}
                  </div>
                </div>
                
                <div className="flex items-center gap-3 p-4 bg-blue-900/20 border border-blue-800 rounded-xl">
                  <input
                    type="checkbox"
                    id="performance_mode"
                    checked={performanceMode}
                    onChange={(e) => setPerformanceMode(e.target.checked)}
                    className="w-4 h-4 text-blue-600 bg-neutral-800 border-neutral-600 rounded focus:ring-blue-500 focus:ring-2"
                  />
                  <div className="flex-1">
                    <label htmlFor="performance_mode" className="body-sm font-medium text-neutral-200">
                      Performance Mode (Recommended)
                    </label>
                    <div className="muted mt-1">
                      ULTRA-FAST settings: 512 context, 64 output, 2 threads - instant responses, minimal lag
                    </div>
                  </div>
                </div>
                
                <div>
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="flex items-center gap-2 text-neutral-400 hover:text-neutral-200 body-sm"
                  >
                    <span>Advanced Settings</span>
                    <span className={`transform transition-transform ${showAdvanced ? 'rotate-90' : 'rotate-0'}`}>›</span>
                  </button>
                  
                  {showAdvanced && (
                    <div className="mt-4 space-y-4 p-4 bg-neutral-900/50 rounded-xl border border-neutral-700">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block body-sm font-medium mb-2 text-neutral-200">
                            Max Output (num_predict): {performanceMode ? Math.min(numPredict, 64) : numPredict}
                          </label>
                          <input
                            type="range"
                            min="32"
                            max="512"
                            step="32"
                            value={numPredict}
                            onChange={(e) => setNumPredict(parseInt(e.target.value))}
                            className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer slider"
                            disabled={performanceMode}
                          />
                        </div>
                        
                        <div>
                          <label className="block body-sm font-medium mb-2 text-neutral-200">
                            Threads: {performanceMode ? Math.min(numThread, 2) : numThread}
                          </label>
                          <input
                            type="range"
                            min="1"
                            max="4"
                            step="1"
                            value={numThread}
                            onChange={(e) => setNumThread(parseInt(e.target.value))}
                            className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer slider"
                            disabled={performanceMode}
                          />
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block body-sm font-medium mb-2 text-neutral-200">
                            Top P: {performanceMode ? Math.min(topP, 0.7) : topP}
                          </label>
                          <input
                            type="range"
                            min="0.1"
                            max="1.0"
                            step="0.1"
                            value={topP}
                            onChange={(e) => setTopP(parseFloat(e.target.value))}
                            className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer slider"
                            disabled={performanceMode}
                          />
                        </div>
                        
                        <div>
                          <label className="block body-sm font-medium mb-2 text-neutral-200">
                            Top K: {performanceMode ? Math.min(topK, 10) : topK}
                          </label>
                          <input
                            type="range"
                            min="5"
                            max="20"
                            step="1"
                            value={topK}
                            onChange={(e) => setTopK(parseInt(e.target.value))}
                            className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer slider"
                            disabled={performanceMode}
                          />
                        </div>
                      </div>
                      
                      {performanceMode && (
                        <div className="text-yellow-400 body-sm flex items-center gap-2">
                          <AlertTriangle size={14} />
                          Performance Mode enabled - some settings are capped for optimal speed
                        </div>
                      )}
                    </div>
                  )}
                </div>
                
                <div className="flex items-center gap-3">
                  <Button
                    onClick={handleTestKey}
                    disabled={isTestingKey}
                    variant="primary"
                    size="sm"
                  >
                    {isTestingKey ? 'Testing...' : 'Test Connection'}
                  </Button>
                  
                  {testResult && (
                    <div className={`flex items-center gap-2 body-sm ${testResult.ok ? 'text-nerdplexity-400' : 'text-red-400'}`}>
                      {testResult.ok ? <CheckCircle size={16} /> : <XCircle size={16} />}
                      <span>{testResult.message || (testResult.ok ? 'Ollama server connected successfully' : 'Failed to connect to Ollama server')}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            </div>
          </div>
          
          {/* App Settings */}
          <div className="space-y-4">
            <h3 className="heading-sm text-neutral-100">App Settings</h3>
            
            <div>
              <label className="block body-sm font-medium mb-3 text-neutral-200">Mode</label>
              <select 
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
                className="w-full p-3 bg-neutral-800 text-neutral-100 border border-neutral-700 rounded-xl focus-ring text-lg"
              >
                <option value="direct">Direct Chat</option>
                <option value="research">Research Mode</option>
                <option value="coach">Prompt Coach</option>
              </select>
              <div className="muted mt-2">
                {mode === 'research' && 'Provides structured research with plans and citations'}
                {mode === 'coach' && 'Helps optimize prompts and asks clarifying questions'}
                {mode === 'direct' && 'Standard conversational chat interface'}
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="web_enabled"
                checked={webEnabled}
                onChange={(e) => setWebEnabled(e.target.checked)}
                className="w-4 h-4 text-blue-600 bg-neutral-800 border-neutral-600 rounded focus:ring-blue-500 focus:ring-2"
              />
              <label htmlFor="web_enabled" className="body-sm font-medium text-neutral-200">
                Web Search Enabled (Beta)
              </label>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block body-sm font-medium mb-3 text-neutral-200">
                  Temperature: {temperature}
                </label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer slider"
                />
              </div>
              
              <div>
                <label className="block body-sm font-medium mb-3 text-neutral-200">Max Tokens</label>
                <Input
                  type="number"
                  min="100"
                  max="8000"
                  value={maxTokens.toString()}
                  onChange={(e) => setMaxTokens(parseInt(e.target.value) || 1000)}
                />
              </div>
            </div>
          </div>
          
          {/* Actions */}
          <div className="flex justify-between items-center pt-6 border-t border-neutral-700">
            <Button
              onClick={clearAllData}
              variant="ghost"
              size="md"
              className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
            >
              <Trash2 size={16} />
              Clear All Data
            </Button>
            
            <div className="flex gap-3">
              <Button 
                onClick={onClose}
                variant="secondary"
                size="md"
              >
                Cancel
              </Button>
              <Button 
                onClick={handleSave}
                variant="primary"
                size="md"
              >
                Save Settings
              </Button>
            </div>
          </div>
      </div>
    </Modal>
  );
};