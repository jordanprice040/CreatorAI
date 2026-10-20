# X10 benchmark (synthetic fixture workload; not real usage)

Declared: 10000 ideas, 100000 events. Seeded: {"ideas":10000,"entities":11900,"entity_versions":85957,"links":11840,"audit_events":100000,"history_rows":100000,"reservations":600} in 256 s.

Environment: {"platform":"linux 6.18.44-fc-v139","cpu":"4 × Intel(R) Xeon(R) Processor @ 2.10GHz","memory_gb":16,"node":"v22.22.0","postgresql":"16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)","postgresql_settings":{"effective_cache_size":"524288 8kB","max_connections":"100","shared_buffers":"16384 8kB","work_mem":"4096 kB"},"topology":"API, benchmark client and PostgreSQL on one host over loopback; one sequential client"}

| Measurement | Samples | p50 ms | p95 ms | p99 ms | max ms |
| --- | --- | --- | --- | --- | --- |
| catalog_text_search | 200 | 325.7 | 409.8 | 427.3 | 446.8 |
| catalog_browse | 200 | 20.1 | 28.5 | 38.3 | 52.3 |
| catalog_id_lookup | 200 | 58.7 | 73.2 | 97.2 | 105.7 |
| bounded_lineage | 200 | 10.2 | 12.6 | 14.9 | 17.2 |
| cost_aggregation | 200 | 15.7 | 21.1 | 22.7 | 24.4 |
| overview | 200 | 5.4 | 7.7 | 9.4 | 23 |
| event_display_lag | 100 | 8.6 | 12.9 | 14.7 | 26.5 |

- catalog search p95 under 2000 ms (provisional): measured p95 409.8 ms, met
- event display p95 under 5000 ms (provisional): measured p95 12.9 ms, met
- Latency is measured at the owner HTTP API, not in a browser; screens add their own polling interval on top (the Overview screen polls every 4 s).
- One sequential client: no concurrent-user load was measured.
- Seeded through the audited store and fixture broker; costs are simulated nano-USD.
