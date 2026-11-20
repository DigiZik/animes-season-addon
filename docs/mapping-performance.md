# Resolver benchmark — 21 November 2026

Compared with commit `b318225020decbedaa89fa81ba5fd685f48a259d`, using identical
full Fribb and animeApi snapshots (14,137,114 bytes).
Environment: Node v24.12.0, win32/x64. Each value is the median of
5 fresh processes. Trial order alternates between implementations.

| Check | b318225 | Updated resolver | Difference |
| --- | ---: | ---: | --- |
| Cold load, including downloads and indexing | 1937.50 ms | 2023.00 ms | 4.41% slower |
| Unchanged-source load | 1932.19 ms | 345.91 ms | 82.10% less time |
| Mapping response bodies on unchanged sources | 14,137,114 bytes | 0 bytes | Bodies eliminated; two conditional requests remain |
| 100,000 repeated ID selections, warmed | 15.44 ms | 2.16 ms | 7.14× faster |
| Retained index heap after cold load | 15.63 MiB | 18.36 MiB | +2.73 MiB |
| Provider outage with a usable snapshot | Refresh fails | Snapshot succeeds | At most three attempts per source |

## Method and limits

The HTTP server runs on loopback and sends 64 KiB chunks every 5 ms per source.
These are reproducible fixture conditions, **not predicted GitHub or end-to-end
catalog refresh times**. They exclude Actions cache restore/save, AniList queries,
TypeScript compilation, pagination, and deployment. Actual gains depend on source
changes, network speed, and cache availability.

The updated cold path includes conflict checks, SHA-256 validation, provenance,
and writing snapshots. It trades a small cold-start cost and additional memory
for safer mappings and cheaper repeated runs. Both versions use two requests on
successful loads; the unchanged current path receives two HTTP 304 responses.

Lookup trials warm each index with 20,000 selections, then measure 100,000
selections five times per process. The benchmark uses 20,928
distinct AniList IDs from Fribb. The new implementation memoizes chosen IDs; this
number measures repeated-selection throughput, not all request processing.

The outage fixture returns HTTP 503. Retry sleeps are disabled **only in the
benchmark** to isolate work: current median 290.64 ms, six requests,
24 response-body bytes. Production additionally waits through bounded
backoff. A failed baseline load is not a successful-performance comparison.

## Reproduce

Use Node.js 24 and retain the baseline commit in Git history. First run
`npm run audit:ids` to populate mapping snapshots, then:

```sh
npm run benchmark:ids
# Or use raw fribb.json and animeapi.tsv snapshots:
npm run benchmark:ids -- --snapshots=/path/to/snapshots --samples=5
```

Machine-readable results are in [mapping-benchmark.json](mapping-benchmark.json).
Local reruns write `.cache/mapping-benchmark.json`. Input hashes are recorded in
the JSON so runs can be compared using the same data. The benchmark downloads no
external data and deletes only its own temporary workspace.

## Correctness verification

- 169 deterministic tests across nine suites, including HTTP pagination at sizes
  20, 30 and 50, cache corruption/expiry, retries, provider failures and conflicts.
- All 64 catalog files, 6,956 entries and 6,389 distinct AniList identities audited.
- Two newly ambiguous entries retain their source AniList IDs: SHORT PEACE
  (17677) and Whistle! (183). This flags conflicting mapping evidence, not a
  confirmed claim that either previous Kitsu record was an unrelated title.
- Final audit requires no further repairs; source metadata and ordering remain.
- Complete Pages traversal and native-ID/provenance verification pass.
