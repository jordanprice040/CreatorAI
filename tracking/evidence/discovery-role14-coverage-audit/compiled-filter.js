.filter((r) => {
            const manifest = r.manifest;
            const required = r.task_class === 'candidate_generation'
                ? ['propose', 'revise']
                : r.task_class === 'research_synthesis'
                    ? ['locate']
                    : ['skeptic'];
            const kinds = new Set();
            if (!manifest.cases?.length ||
                canonicalHash(manifest) !== r.manifest_hash)
                return false;
            for (const item of manifest.cases) {
                const parsed = BenchmarkCheckSchema.safeParse(item.check);
                if (!parsed.success || parsed.data.kind !== 'discovery_contract')
                    return false;
                const check = parsed.data;
                if (check.context.role_version !== DISCOVERY_ROLE_VERSION ||
                    check.context.packet_hash !== canonicalHash(check.packet))
                    return false;
                const expected = discoveryRoleInput(check.task_kind, check.context, check.packet, [])[0].text;
                if (item.input
                    ?.filter((m) => m.role === 'system')
                    .map((m) => m.text)
                    .join('\n\n') !== expected)
                    return false;
                kinds.add(check.task_kind);
            }
            return required.every((k) => kinds.has(k));
        })
