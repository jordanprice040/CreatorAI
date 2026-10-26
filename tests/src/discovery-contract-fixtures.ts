// Test-only rebinding of historical synthetic cases; never live qualification evidence.
import { readFileSync } from 'node:fs';
import { BenchmarkManifestSchema } from '@creator/contracts';
import { DISCOVERY_ROLE_VERSION, discoveryRoleInput } from '@creator/domain';
export function currentDiscoveryQualificationFixture(taskClass: string) {
  const base = new URL(
    '../../config/connections/benchmarks/discovery-synthetic-v2/',
    import.meta.url,
  );
  const manifest = BenchmarkManifestSchema.parse(
    JSON.parse(readFileSync(new URL(`${taskClass}.json`, base), 'utf8')),
  );
  const controls = JSON.parse(
    readFileSync(new URL('author-controls.json', base), 'utf8'),
  ) as { case_id: string; inputs: Parameters<typeof discoveryRoleInput>[3] }[];
  manifest.fixture = true;
  manifest.name = `test-only-current-${taskClass}`;
  for (const c of manifest.cases) {
    if (c.check.kind !== 'discovery_contract')
      throw new Error('Wrong fixture contract');
    c.check.context.role_version = DISCOVERY_ROLE_VERSION;
    const input = discoveryRoleInput(
      c.check.task_kind,
      c.check.context,
      c.check.packet,
      controls.find((x) => x.case_id === c.case_id)!.inputs,
    );
    c.input = [
      {
        role: 'system',
        text: input
          .filter((m) => m.role === 'system')
          .map((m) => m.text)
          .join('\n'),
      },
      {
        role: 'user',
        text: JSON.stringify(input.filter((m) => m.role === 'user')),
      },
    ];
  }
  return BenchmarkManifestSchema.parse(manifest);
}
