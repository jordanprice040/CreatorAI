import { ContractError } from '@creator/contracts';
import { OpenAIAdapter } from './openai.js';

/**
 * A live adapter exists only when the owner opts in explicitly and supplies a key. The key
 * stays in this process; it is not an authorization to spend (grants and envelopes are).
 */
export function liveAdapterFromEnv(env: Record<string, string | undefined>) {
  const provider = env.CREATOR_LIVE_PROVIDER ?? 'none';
  if (provider === 'none') return null;
  if (provider !== 'openai')
    throw new ContractError(
      'INVALID_CONFIG',
      'CREATOR_LIVE_PROVIDER must be none or openai.',
    );
  if (!env.OPENAI_API_KEY)
    throw new ContractError(
      'INVALID_CONFIG',
      'CREATOR_LIVE_PROVIDER=openai needs OPENAI_API_KEY on the API process.',
    );
  try {
    return new OpenAIAdapter({
      apiKey: env.OPENAI_API_KEY,
      model_id: env.CREATOR_OPENAI_MODEL ?? 'gpt-6-astra',
      ...(env.CREATOR_OPENAI_BASE_URL
        ? { baseUrl: env.CREATOR_OPENAI_BASE_URL }
        : {}),
    });
  } catch (e) {
    throw new ContractError('INVALID_CONFIG', (e as Error).message);
  }
}
