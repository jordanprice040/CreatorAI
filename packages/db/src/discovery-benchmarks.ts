import { readFileSync } from 'node:fs';
import {
  BenchmarkCheckSchema,
  BenchmarkManifestSchema,
  ContractError,
  DISCOVERY_TASK_CLASSES,
  type BenchmarkManifest,
  type DiscoveryBenchmark,
} from '@creator/contracts';
import {
  DISCOVERY_ROLE_VERSION,
  canonicalHash,
  discoveryRoleInput,
} from '@creator/domain';
import type { Row } from './store.js';

/** The discovery task classes: locate, propose/revise and skeptic. */
export const DISCOVERY_CLASSES = [
  ...new Set(Object.values(DISCOVERY_TASK_CLASSES)),
] as readonly string[];

/**
 * Same discovery prompt binding used for both admission and historical-result labels: every
 * case is a discovery check on the current role version whose system message is the role's
 * current prompt, and the manifest covers every task kind of its class.
 */
export function currentForDiscoveryRole(r: Row): boolean {
  if (!DISCOVERY_CLASSES.includes(String(r.task_class))) return true;
  const manifest = r.manifest as {
    cases?: { input?: { role: string; text: string }[]; check?: unknown }[];
  };
  const required =
    r.task_class === 'candidate_generation'
      ? ['propose', 'revise']
      : r.task_class === 'research_synthesis'
        ? ['locate']
        : ['skeptic'];
  const kinds = new Set<string>();
  if (!manifest.cases?.length || canonicalHash(manifest) !== r.manifest_hash)
    return false;
  for (const item of manifest.cases) {
    const parsed = BenchmarkCheckSchema.safeParse(item.check);
    if (!parsed.success || parsed.data.kind !== 'discovery_contract')
      return false;
    const check = parsed.data;
    if (
      check.context.role_version !== DISCOVERY_ROLE_VERSION ||
      check.context.packet_hash !== canonicalHash(check.packet)
    )
      return false;
    const expected = discoveryRoleInput(
      check.task_kind,
      check.context,
      check.packet,
      [],
    )[0]!.text;
    if (
      item.input
        ?.filter((m) => m.role === 'system')
        .map((m) => m.text)
        .join('\n\n') !== expected
    )
      return false;
    kinds.add(check.task_kind);
  }
  return required.every((k) => kinds.has(k));
}

/** True when the qualification row is a discovery-class one bound to the current role prompt. */
export const admitsDiscovery = (r: Row): boolean =>
  DISCOVERY_CLASSES.includes(String(r.task_class)) &&
  currentForDiscoveryRole(r);

/**
 * ADR-0089 (P34): the frozen discovery benchmark folders under config/connections/benchmarks,
 * NEWEST FIRST. For each discovery task class the app offers the first one here whose manifest
 * passes the role-currency check, so the offer follows the role prompts: when the discovery role
 * changes, older manifests drop out on their own and a newly frozen folder goes at the top. A
 * test keeps every discovery folder listed.
 */
export const DISCOVERY_BENCHMARK_DIRS = [
  'discovery-semantics-v2',
  'discovery-research14-v2',
  'discovery-semantics-v1',
  'discovery-research14-v1',
  'discovery-followup-v1',
  'discovery-synthetic-v5',
  'discovery-synthetic-v4',
  'discovery-synthetic-v3',
  'discovery-synthetic-v2',
  'discovery-synthetic-v1',
] as const;

/**
 * The benchmarks folder. The desktop bundle keeps the repository layout (service/app/dist ->
 * ../../../config), like config/spending.json.
 */
export const BENCHMARKS_ROOT = new URL(
  '../../../config/connections/benchmarks/',
  import.meta.url,
);

export interface OfferedBenchmark extends DiscoveryBenchmark {
  manifest: BenchmarkManifest;
}

const offeredCache = new Map<string, OfferedBenchmark[]>();

/**
 * The discovery benchmarks the app offers: per task class, the newest manifest that is real
 * (not a fixture) and current for the discovery role. A class with no current manifest is left
 * out rather than offered stale. The files are frozen, so one read per process is enough.
 */
export function offeredDiscoveryBenchmarks(
  root: URL = BENCHMARKS_ROOT,
  dirs: readonly string[] = DISCOVERY_BENCHMARK_DIRS,
): OfferedBenchmark[] {
  const key = `${root.href}|${dirs.join(',')}`;
  const hit = offeredCache.get(key);
  if (hit) return hit;
  const out: OfferedBenchmark[] = [];
  for (const task_class of DISCOVERY_CLASSES) {
    for (const dir of dirs) {
      let raw: unknown;
      try {
        raw = JSON.parse(
          readFileSync(new URL(`${dir}/${task_class}.json`, root), 'utf8'),
        );
      } catch {
        continue;
      }
      const parsed = BenchmarkManifestSchema.safeParse(raw);
      if (!parsed.success) continue;
      const manifest = parsed.data;
      const manifest_hash = canonicalHash(manifest);
      if (
        manifest.task_class !== task_class ||
        manifest.fixture ||
        !currentForDiscoveryRole({ task_class, manifest, manifest_hash })
      )
        continue;
      out.push({
        name: manifest.name,
        task_class: task_class as DiscoveryBenchmark['task_class'],
        manifest_hash,
        data_class: manifest.data_class,
        development: manifest.cases.filter((c) => c.split !== 'held_out')
          .length,
        held_out: manifest.cases.filter((c) => c.split === 'held_out').length,
        manifest,
      });
      break;
    }
  }
  offeredCache.set(key, out);
  return out;
}

/**
 * The offered benchmark with this name, or a refusal: an unknown name, or one that is not (or
 * no longer) current for the discovery role, is never started from the app.
 */
export function offeredDiscoveryBenchmark(
  name: string,
  root?: URL,
  dirs?: readonly string[],
): OfferedBenchmark {
  const found = offeredDiscoveryBenchmarks(root, dirs).find(
    (b) => b.name === name,
  );
  if (!found)
    throw new ContractError(
      'INVALID_CONTRACT',
      `${name} is not a benchmark the app offers: only the newest discovery benchmark that matches the current discovery role prompts can be started here.`,
    );
  return found;
}
