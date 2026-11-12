import {
  ApiKeyModelSchema,
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
  /** Adapters by vault reference and model; a replaced key has a new reference. */
  readonly #adapters = new Map<string, Promise<ModelAdapter | null>>();
  /** The cache entry each workspace used last, so a key changed elsewhere is forgotten. */
  readonly #current = new Map<string, string>();
  /** Unused vault entries whose delete failed; retried at the next save or remove. */
  readonly #leftovers = new Set<string>();
  constructor(
    private readonly deps: {
      store: Pick<
        ConnectionStore,
        | 'workspaceApiKey'
        | 'workspaceApiKeyRef'
        | 'saveWorkspaceApiKey'
        | 'removeWorkspaceApiKey'
        | 'changeWorkspaceApiKeyModel'
      >;
      vault: PlanVault | null;
      /** The studio process's own key, from the environment. */
      environment: ModelAdapter | null;
      /** Loopback base for contract tests; the official API otherwise. */
      baseUrl?: string;
      /** Where unlock and delete failures are reported (references only, never a key). */
      log?: (m: string) => void;
    },
  ) {}

  async status(
    ctx: CommandContext,
    ws: string,
    leftover = false,
  ): Promise<ApiKeyStatus> {
    const saved = await this.deps.store.workspaceApiKey(ctx, ws);
    const env = this.deps.environment;
    // Review 1 L-1: a saved key counts as in use only if this studio can actually open it.
    const usable =
      !env && saved ? (await this.#resolve(ctx, ws)) !== null : false;
    const in_use = env
      ? 'environment'
      : !saved
        ? 'none'
        : usable
          ? 'saved'
          : 'saved_unavailable';
    const notes = [
      env && saved
        ? `The studio was started with its own OpenAI key, which is used instead of the saved one (…${saved.last_four}) until it is started without it.`
        : null,
      in_use === 'saved_unavailable'
        ? this.deps.vault
          ? `The saved key …${saved!.last_four} cannot be opened on this computer (its protected file is missing, damaged, or belongs to another Windows account), so calls are refused. Replace or remove it.`
          : `The saved key …${saved!.last_four} cannot be used: this studio has no protected store for keys. Remove it here, or open the desktop app.`
        : null,
      !this.deps.vault && in_use !== 'saved_unavailable'
        ? 'This studio has no protected store for keys, so a key cannot be saved here. The desktop app has one.'
        : null,
      leftover
        ? "The old key's protected file could not be deleted from this computer. It is no longer used by anything; it is removed the next time a key is saved or removed here."
        : null,
    ].filter((n): n is string => n !== null);
    return parse(ApiKeyStatusSchema, {
      provider: 'openai',
      environment: env ? { model_id: env.model_id } : null,
      saved,
      in_use,
      model_id: env?.model_id ?? saved?.model_id ?? null,
      can_save: this.deps.vault !== null,
      note: notes.length ? notes.join(' ').slice(0, 800) : null,
      unused_file_left: leftover,
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
      if (!(await this.#discard(ref))) this.#leftovers.add(ref);
      throw e;
    }
    // The record already points at the new key, so the old file is unused by any call.
    const leftover = replaced ? !(await this.#discard(replaced)) : false;
    await this.#retryLeftovers();
    return this.status(ctx, ws, leftover);
  }

  /** Review 1 N-6: point the saved key at another model without pasting the key again. */
  async changeModel(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<ApiKeyStatus> {
    const b = parse(ApiKeyModelSchema, raw);
    await this.deps.store.changeWorkspaceApiKeyModel(
      ctx,
      ws,
      b.model_id,
      b.expected_version,
    );
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
    const leftover = !(await this.#discard(credential_ref));
    await this.#retryLeftovers();
    return this.status(ctx, ws, leftover);
  }

  /**
   * The live adapter a real workspace's call uses: the studio's own key first, then the
   * workspace's saved key, else none (the broker then denies the call, never fakes it).
   */
  async liveFor(ctx: CommandContext, ws: string): Promise<ModelAdapter | null> {
    if (this.deps.environment) return this.deps.environment;
    return this.#resolve(ctx, ws);
  }

  async #resolve(
    ctx: CommandContext,
    ws: string,
  ): Promise<ModelAdapter | null> {
    if (!this.deps.vault) return null;
    const rec = await this.deps.store.workspaceApiKeyRef(ctx, ws);
    const id = ws.toLowerCase();
    const before = this.#current.get(id);
    const cacheKey = rec ? `${rec.credential_ref}#${rec.model_id}` : null;
    // Review 1 N-5: forget a key another process replaced or removed, not only our own.
    if (before && before !== cacheKey) this.#adapters.delete(before);
    if (!rec || !cacheKey) {
      this.#current.delete(id);
      return null;
    }
    this.#current.set(id, cacheKey);
    const vault = this.deps.vault;
    let pending = this.#adapters.get(cacheKey);
    if (!pending) {
      pending = vault
        .getApiKey(rec.credential_ref)
        .then((key) => (key ? this.#adapter(key, rec.model_id) : null));
      this.#adapters.set(cacheKey, pending);
    }
    try {
      const adapter = await pending;
      // A missing file is asked again next time (it may be restored), not remembered.
      if (!adapter) this.#adapters.delete(cacheKey);
      return adapter;
    } catch (e) {
      // A failed unlock is retried on the next call rather than remembered. The log names the
      // reference only, never the key.
      this.#adapters.delete(cacheKey);
      this.#log(
        `The saved OpenAI key ${rec.credential_ref} could not be opened (${e instanceof Error ? e.message : String(e)}).`,
      );
      return null;
    }
  }

  /** Deletes a vault entry; false (and a log line naming the reference) when that failed. */
  async #discard(ref: string): Promise<boolean> {
    for (const k of this.#adapters.keys())
      if (k.startsWith(`${ref}#`)) this.#adapters.delete(k);
    try {
      await this.deps.vault?.delete(ref);
      this.#leftovers.delete(ref);
      return true;
    } catch (e) {
      this.#leftovers.add(ref);
      this.#log(
        `The unused OpenAI key file ${ref} could not be deleted (${e instanceof Error ? e.message : String(e)}); it is retried at the next save or remove.`,
      );
      return false;
    }
  }
  async #retryLeftovers() {
    for (const ref of [...this.#leftovers]) await this.#discard(ref);
  }
  #log(m: string) {
    (this.deps.log ?? console.error)(m);
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
