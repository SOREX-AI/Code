export type ProviderMode = 'lmstudio' | 'ollama' | 'jan' | 'custom' | 'openai' | 'anthropic' | 'google' | 'openrouter';

export interface ProviderDefinition {
  mode: ProviderMode;
  label: string;
  kind: 'local' | 'cloud' | 'custom';
  defaultEndpoint: string;
  modelConfigKey: 'model' | 'openaiModel' | 'anthropicModel' | 'googleModel' | 'openrouterModel';
  endpointConfigKey: 'endpoint' | 'openaiEndpoint' | 'anthropicEndpoint' | 'googleEndpoint' | 'openrouterEndpoint';
  secretKey?: string;
  openAiCompatible: boolean;
  supportsEmbeddings: boolean;
}

export const PROVIDERS: Record<ProviderMode, ProviderDefinition> = {
  lmstudio: {
    mode: 'lmstudio',
    label: 'LM Studio',
    kind: 'local',
    defaultEndpoint: 'http://localhost:1234/v1',
    modelConfigKey: 'model',
    endpointConfigKey: 'endpoint',
    openAiCompatible: true,
    supportsEmbeddings: true
  },
  ollama: {
    mode: 'ollama',
    label: 'Ollama',
    kind: 'local',
    defaultEndpoint: 'http://localhost:11434/v1',
    modelConfigKey: 'model',
    endpointConfigKey: 'endpoint',
    openAiCompatible: true,
    supportsEmbeddings: true
  },
  jan: {
    mode: 'jan',
    label: 'Jan',
    kind: 'local',
    defaultEndpoint: 'http://localhost:1337/v1',
    modelConfigKey: 'model',
    endpointConfigKey: 'endpoint',
    openAiCompatible: true,
    supportsEmbeddings: true
  },
  custom: {
    mode: 'custom',
    label: 'OpenAI-compatible',
    kind: 'custom',
    defaultEndpoint: 'http://localhost:1234/v1',
    modelConfigKey: 'model',
    endpointConfigKey: 'endpoint',
    openAiCompatible: true,
    supportsEmbeddings: true
  },
  openai: {
    mode: 'openai',
    label: 'OpenAI',
    kind: 'cloud',
    defaultEndpoint: 'https://api.openai.com/v1',
    modelConfigKey: 'openaiModel',
    endpointConfigKey: 'openaiEndpoint',
    secretKey: 'sorex.openaiApiKey',
    openAiCompatible: true,
    supportsEmbeddings: true
  },
  anthropic: {
    mode: 'anthropic',
    label: 'Anthropic',
    kind: 'cloud',
    defaultEndpoint: 'https://api.anthropic.com/v1',
    modelConfigKey: 'anthropicModel',
    endpointConfigKey: 'anthropicEndpoint',
    secretKey: 'sorex.anthropicApiKey',
    openAiCompatible: false,
    supportsEmbeddings: false
  },
  google: {
    mode: 'google',
    label: 'Google',
    kind: 'cloud',
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelConfigKey: 'googleModel',
    endpointConfigKey: 'googleEndpoint',
    secretKey: 'sorex.googleApiKey',
    openAiCompatible: true,
    supportsEmbeddings: true
  },
  openrouter: {
    mode: 'openrouter',
    label: 'OpenRouter',
    kind: 'cloud',
    defaultEndpoint: 'https://openrouter.ai/api/v1',
    modelConfigKey: 'openrouterModel',
    endpointConfigKey: 'openrouterEndpoint',
    secretKey: 'sorex.openrouterApiKey',
    openAiCompatible: true,
    supportsEmbeddings: true
  }
};

export const PROVIDER_MODES = Object.keys(PROVIDERS) as ProviderMode[];
export const CLOUD_PROVIDER_MODES = PROVIDER_MODES.filter(mode => PROVIDERS[mode].kind === 'cloud');

export function isProviderMode(value: string): value is ProviderMode {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, value);
}

export function providerDefinition(mode: ProviderMode): ProviderDefinition {
  return PROVIDERS[mode];
}
