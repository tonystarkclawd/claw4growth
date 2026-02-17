/**
 * Available AI models for OpenClaw instances.
 */

export interface ModelConfig {
    id: string;
    name: string;
    provider: string;
    openClawId?: string;
    default?: boolean;
}

export const DEFAULT_MODEL_ID = 'minimax/minimax-latest';

export const availableModels: ModelConfig[] = [
    {
        id: 'minimax/minimax-latest',
        name: 'MiniMax Latest',
        provider: 'minimax',
        openClawId: 'minimax-latest',
        default: true,
    },
    {
        id: 'openai/gpt-4o',
        name: 'GPT-4o',
        provider: 'openai',
        openClawId: 'gpt-4o',
    },
    {
        id: 'anthropic/claude-sonnet',
        name: 'Claude Sonnet',
        provider: 'anthropic',
        openClawId: 'claude-sonnet-4-20250514',
    },
];

export function getDefaultModel(): ModelConfig {
    return availableModels.find(m => m.default) || availableModels[0];
}

export function getModelById(id: string): ModelConfig | undefined {
    return availableModels.find(m => m.id === id);
}

export function getOpenClawModelId(modelId: string): string {
    const model = getModelById(modelId);
    return model?.openClawId || modelId;
}
