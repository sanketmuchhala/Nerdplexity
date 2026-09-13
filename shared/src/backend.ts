// What the backend reports about itself at GET /v1/health. Type-only.

export interface BackendHealth {
  status: 'ok';
  timestamp: string;
  /** Deployed for others to reach (NERDPLEXITY_HOSTED): models on the user's computer are unavailable. */
  hosted: boolean;
  /** Whether the page that asked may use the API; false means its origin is not in ALLOWED_ORIGINS. */
  originAllowed: boolean;
  features: {
    /** Install and remove Ollama models (local servers only). */
    ollamaManagement: boolean;
  };
}
