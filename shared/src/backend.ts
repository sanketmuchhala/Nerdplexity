// What the backend reports about itself at GET /v1/health. Type-only.

export interface BackendHealth {
  status: 'ok';
  timestamp: string;
  /** Deployed for others to reach (NERDPLEXITY_HOSTED): models on the user's computer are unavailable. */
  hosted: boolean;
  /** Whether the page that asked may use the API; false means its origin is not in ALLOWED_ORIGINS. */
  originAllowed: boolean;
  /** Accounts are on: data requests need a signed-in user (hosted servers). */
  authRequired: boolean;
  /** New accounts can be created (NERDPLEXITY_SIGNUPS, or no account exists yet). */
  signupsOpen: boolean;
  features: {
    /** Install and remove Ollama models (local servers only). */
    ollamaManagement: boolean;
  };
}
