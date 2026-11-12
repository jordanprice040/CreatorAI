import {
  ApiKeyRemoveSchema,
  ApiKeySaveSchema,
  ApiKeyStatusSchema,
  ContractError,
  OPENAI_KEY_PATTERN,
  parse,
  type ApiKeyStatus,
} from '@creator/contracts';
import type { CommandContext, ConnectionStore } from '@creator/db';
import type { ModelAdapter } from './adapters.js';
import { OpenAIAdapter } from './openai.js';
import { newApiKeyRef, type PlanVault } from './plan-vault.js';

/**
 * ADR-0093 (P28): a workspace's own OpenAI API key, added, replaced and removed in Models and
 * connections. The key is sealed in the studio's protected vault (DPAPI on Windows) before its
 * record is written; the database, audit log, responses and logs hold only its last four
 * characters. The studio process's own key (CREATOR_LIVE_PROVIDER=openai) keeps working and wins
 * when both exist. A key is not permission to spend: every call still needs a grant, a funded
 * budget and room under the overall ceiling, which the broker checks as for any paid call.
 */
export class ApiKeyService {
  /** Adapters by vault reference; a replaced key has a new reference, so nothing goes stale. */
  readonly #adapters = new Map<string, Promise<ModelAdapter | null>>();
  constructor(
    private readonly deps: {
      store: Pick<
        ConnectionStore,
        | 'workspaceApiKey'
        | 'workspaceApiKeyRef'
        | 'saveWorkspaceApiKey'
        | 'removeWorkspaceApiKey'
      >;
      vault: PlanVault | null;
      /** The studio process's own key, from the environment. */
      environment: ModelAdapter | null;
      /** Loopback base for contract tests; the official API otherwise. */
      baseUrl?: string;
    },
  ) {}

  async status(ctx: CommandContext, ws: string): Promise<ApiKeyStatus> {
    const saved = await this.deps.store.workspaceApiKey(ctx, ws);
    const env = this.deps.environment;
    return parse(ApiKeyStatusSchema, {
      provider: 'openai',
      environment: env ? { model_id: env.model_id } : null,
      saved,
      in_use: env ? 'environment' : saved ? 'saved' : 'none',
      model_id: env?.model_id ?? saved?.model_id ?? null,
      can_save: this.deps.vault !== null,
      note:
        env && saved
          ? `The studio was started with its own OpenAI key, which is used instead of the saved one (…${saved.last_four}) until it is started without it.`
          : !this.deps.vault
            ? 'This studio has no protected store for keys, so a key cannot be saved here. The desktop app has one.'
            : null,
    });
  }

  async save(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<ApiKeyStatus> {
    const b = parse(ApiKeySaveSchema, raw);
    const key = b.api_key.trim();
    // Never echo the value: the refusal names only what is wrong with it.
    if (!OPENAI_KEY_PATTERN.test(key))
      throw new ContractError(
        'INVALID_CONTRACT',
        'That does not look like an OpenAI API key (20 to 300 letters, digits, - or _). Copy it again from the OpenAI dashboard.',
      );
    const vault = this.#vault();
    // Fail on the key's shape before anything is stored (also checks the base URL).
    this.#adapter(key, b.model_id);
    const ref = newApiKeyRef();
    await vault.putApiKey(ref, key);
    let replaced: string | null;
    try {
      replaced = (
        await this.deps.store.saveWorkspaceApiKey(ctx, ws, {
          model_id: b.model_id,
          last_four: key.slice(-4),
          credential_ref: ref,
          expected_version: b.expected_version,
        })
      ).replaced_credential_ref;
    } catch (e) {
      await vault.delete(ref).catch(() => {});
      throw e;
    }
    if (replaced) {
      this.#adapters.delete(replaced);
      // The record already points at the new key; a leftover file is unreadable to calls.
      await vault.delete(replaced).catch(() => {});
    }
    return this.status(ctx, ws);
  }

  async remove(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<ApiKeyStatus> {
    const b = parse(ApiKeyRemoveSchema, raw);
    const { credential_ref } = await this.deps.store.removeWorkspaceApiKey(
      ctx,
      ws,
      b.expected_version,
    );
    this.#adapters.delete(credential_ref);
    await this.deps.vault?.delete(credential_ref).catch(() => {});
    return this.status(ctx, ws);
  }

  /**
   * The live adapter a real workspace's call uses: the studio's own key first, then the
   * workspace's saved key, else none (the broker then denies the call, never fakes it).
   */
  async liveFor(ctx: CommandContext, ws: string): Promise<ModelAdapter | null> {
    if (this.deps.environment) return this.deps.environment;
    if (!this.deps.vault) return null;
    const rec = await this.deps.store.workspaceApiKeyRef(ctx, ws);
    if (!rec) return null;
    const vault = this.deps.vault;
    let pending = this.#adapters.get(rec.credential_ref);
    if (!pending) {
      pending = vault
        .getApiKey(rec.credential_ref)
        .then((key) => (key ? this.#adapter(key, rec.model_id) : null));
      // A failed unlock is retried on the next call rather than remembered.
      pending.catch(() => this.#adapters.delete(rec.credential_ref));
      this.#adapters.set(rec.credential_ref, pending);
    }
    return pending.catch(() => null);
  }

  #adapter(key: string, model_id: string): ModelAdapter {
    try {
      return new OpenAIAdapter({
        apiKey: key,
        model_id,
        ...(this.deps.baseUrl ? { baseUrl: this.deps.baseUrl } : {}),
      });
    } catch (e) {
      throw new ContractError('INVALID_CONFIG', (e as Error).message);
    }
  }

  #vault(): PlanVault {
    if (!this.deps.vault)
      throw new ContractError(
        'INVALID_CONFIG',
        'This studio has no protected store for keys, so a key cannot be saved here.',
      );
    return this.deps.vault;
  }
}
