# X10 benchmark (synthetic fixture workload; not real usage)

Declared: 10000 ideas, 100000 events. Seeded: {"ideas":10000,"entities":11900,"entity_versions":85957,"links":11840,"audit_events":100000,"history_rows":100000,"reservations":600} in 263.8 s.

Environment: {"platform":"linux 6.18.44-fc-v139","cpu":"4 × Intel(R) Xeon(R) Processor @ 2.10GHz","memory_gb":16,"node":"v22.22.0","postgresql":"16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)","postgresql_settings":{"effective_cache_size":"524288 8kB","max_connections":"100","shared_buffers":"16384 8kB","work_mem":"4096 kB"},"topology":"API, benchmark client and PostgreSQL on one host over loopback; one sequential client"}

| Measurement | Samples | p50 ms | p95 ms | p99 ms | max ms |
| --- | --- | --- | --- | --- | --- |
| catalog_text_search | 200 | 331.3 | 416.4 | 432.6 | 450.5 |
| catalog_browse | 200 | 18.9 | 24.4 | 29.7 | 33.1 |
| catalog_id_lookup | 200 | 56.4 | 74 | 78.9 | 112.7 |
| bounded_lineage | 200 | 581.7 | 648.7 | 677.3 | 728.9 |
| cost_aggregation | 200 | 595.7 | 663 | 691.4 | 714.2 |
| overview | 200 | 5.6 | 8.2 | 10.6 | 17.2 |
| event_display_lag | 100 | 9 | 12.5 | 25.2 | 36.2 |

- catalog search p95 under 2000 ms (provisional): measured p95 416.4 ms, met
- event display p95 under 5000 ms (provisional): measured p95 12.5 ms, met
- Latency is measured at the owner HTTP API, not in a browser; screens add their own polling interval on top (the Overview screen polls every 4 s).
- One sequential client: no concurrent-user load was measured.
- Seeded through the audited store and fixture broker; costs are simulated nano-USD.
