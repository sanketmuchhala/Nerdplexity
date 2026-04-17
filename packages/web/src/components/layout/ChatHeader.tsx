import React, { useState, useRef, useEffect } from 'react';
import { Settings, ChevronDown } from 'lucide-react';
import { Badge, Button } from '../ui';
import { sanitizeDisplayText } from '../../lib/stripEmojis';
import { PROVIDER_NAMES, getModelsForProvider } from '../../constants/models';
import type { Provider } from '../../lib/db';
import type { Conversation } from '../../lib/db';

interface ChatHeaderProps {
  conversation: Conversation | null;
  onOpenSettings: () => void;
  onProviderChange?: (provider: Provider) => void;
  onModelChange?: (model: string) => void;
  availableProviders?: string[];
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  conversation,
  onOpenSettings,
  onProviderChange,
  onModelChange,
  availableProviders = []
}) => {
  const [showProviderDropdown, setShowProviderDropdown] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const providerDropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (providerDropdownRef.current && !providerDropdownRef.current.contains(event.target as Node)) {
        setShowProviderDropdown(false);
      }
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setShowModelDropdown(false);
      }
    };

    if (showProviderDropdown || showModelDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showProviderDropdown, showModelDropdown]);

  if (!conversation) {
    return (
      <div className="border-b border-neutral-700 p-4">
        <div className="flex items-center justify-between">
          <div className="heading-sm">Nerdplexity</div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenSettings}
            aria-label="Open settings (Cmd+K)"
          >
            <Settings size={18} />
          </Button>
        </div>
      </div>
    );
  }

  const availableModels = getModelsForProvider(conversation.provider);
  
  const handleProviderClick = (provider: Provider) => {
    onProviderChange?.(provider);
    setShowProviderDropdown(false);
  };

  const handleModelClick = (model: string) => {
    onModelChange?.(model);
    setShowModelDropdown(false);
  };

  return (
    <div className="border-b border-neutral-700 p-4">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <h1 className="heading-sm text-neutral-100 truncate">
            {sanitizeDisplayText(conversation.title)}
          </h1>
          
          {/* Provider and Model badges */}
          <div className="flex items-center gap-2 mt-1">
            {/* Provider dropdown */}
            <div className="relative" ref={providerDropdownRef}>
              <button
                onClick={() => availableProviders.length > 1 && setShowProviderDropdown(!showProviderDropdown)}
                disabled={availableProviders.length <= 1}
                className="flex items-center gap-1"
              >
                <Badge variant="primary" size="sm">
                  {PROVIDER_NAMES[conversation.provider as keyof typeof PROVIDER_NAMES]}
                  {availableProviders.length > 1 && <ChevronDown size={12} />}
                </Badge>
              </button>
              
              {showProviderDropdown && availableProviders.length > 1 && (
                <div className="absolute top-full left-0 mt-1 panel z-50 min-w-36">
                  {availableProviders.map((provider) => (
                    <button
                      key={provider}
                      onClick={() => handleProviderClick(provider as Provider)}
                      className={`w-full text-left px-3 py-2 body-sm hover:bg-neutral-800 transition-colors first:rounded-t-xl last:rounded-b-xl ${
                        provider === conversation.provider 
                          ? 'text-blue-400 bg-neutral-800' 
                          : 'text-neutral-200'
                      }`}
                    >
                      {PROVIDER_NAMES[provider as keyof typeof PROVIDER_NAMES]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Model dropdown */}
            <div className="relative" ref={modelDropdownRef}>
              <button
                onClick={() => availableModels.length > 1 && setShowModelDropdown(!showModelDropdown)}
                disabled={availableModels.length <= 1}
                className="flex items-center gap-1"
              >
                <Badge variant="default" size="sm">
                  {conversation.model}
                  {availableModels.length > 1 && <ChevronDown size={12} />}
                </Badge>
              </button>
              
              {showModelDropdown && availableModels.length > 1 && (
                <div className="absolute top-full left-0 mt-1 panel z-50 min-w-48">
                  {availableModels.map((model) => (
                    <button
                      key={model}
                      onClick={() => handleModelClick(model)}
                      className={`w-full text-left px-3 py-2 body-sm hover:bg-neutral-800 transition-colors first:rounded-t-xl last:rounded-b-xl ${
                        model === conversation.model 
                          ? 'text-blue-400 bg-neutral-800' 
                          : 'text-neutral-200'
                      }`}
                    >
                      {model}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenSettings}
          aria-label="Open settings (Cmd+K)"
        >
          <Settings size={18} />
        </Button>
      </div>
    </div>
  );
};