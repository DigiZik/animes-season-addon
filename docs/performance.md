# Compact catalog performance

Compared with resolver commit `59024c0` on Node v24.12.0, win32/x64.
CPU results are medians of 7 fresh processes using 6389 source
AniList IDs and the same full cross-reference inputs as the earlier audit.

| Work | Previous resolver | Native feed | Separate IMDb converter |
| --- | ---: | ---: | ---: |
| Parse/index/select IDs | 192.36 ms | 0.70 ms | 29.99 ms |
| Retained heap for this work | 16.42 MiB | 0.025 MiB | 0.74 MiB |
| Mapping provider requests per refresh | Up to two conditional/download requests | 0 | 1 bulk download |

The native path formats existing AniList IDs. The IMDb path uses one exact-ID,
type-aware cross-reference index only for Cinemeta. It omits missing or ambiguous
links and never guesses from names. Neither path maintains a mapping snapshot,
provider cache, dataset-merging layer or retry chain.

## Publishing footprint

| Artifact | Bytes |
| --- | ---: |
| Previous native feed alone | 217,234,501 |
| Compact native feed | 44,748,506 |
| Additional Cinemeta feed | 3,111,925 |
| Both compact feeds combined | 47,860,431 |

Both new feeds together use **78.0% less space** than the previous single feed.
The native feed retains configurable pages and every supported integer offset.
Cinemeta uses standard 100-item Stremio pages and only their required offsets,
adding 428 files. This avoids generating thousands of unused Cinemeta pages.

Previews contain only ID, type, title, poster URL and optional release year.
Descriptions, tags, genres, backgrounds, duplicate source-ID fields and movie
playback hints were removed. Poster images are not downloaded or embedded by
the generator. Provider metadata remains responsible for detailed information.

## Method and limits

CPU measurements include JSON parsing, index construction and ID selection. Raw
input reads happen before timing. They exclude HTTP latency, AniList queries,
fallback metadata construction, pagination and deployment. This is **not an
end-to-end speed claim**. The native benchmark formats every source ID; the IMDb
benchmark checks both content-type keys and includes IDs omitted by the final
source-type-specific export.

The previous snapshot cache could avoid mapping response bodies when providers
returned HTTP 304, at the cost of cache restoration. The simplified IMDb export
downloads its single dataset on each requested refresh. Publish-only builds use
committed exports and make no provider requests. Building two feeds does require
additional work; smaller previews and standard Cinemeta pagination keep its
publishing footprint small. Daily provider updates can change these measured sizes.

## Verification

- 145 deterministic tests across eight suites, including native page sizes 20,
  30 and 50; standard 100-item Cinemeta traversal; terminal responses; ambiguous
  IMDb links; malformed data; provider failures and stale-file cleanup.
- Native export: 64 variants, 6,956 entries, 6,389 unique AniList IDs.
- Cinemeta export: 64 variants, 4,692 entries, 3,297 unique IMDb IDs.
- Migration preserved source titles, artwork, ordering and existing release years;
  optional full-metadata fields were deliberately removed.
- The actual AIOmetadata v4.1.0 importer was exercised with mapped/unmapped native
  IDs and IMDb IDs. Live Cinemeta movie/series metadata endpoints passed.
- Both artifacts pass complete filesystem traversal and the combined 1 GB limit.

## Reproduce

```sh
npm run benchmark:ids
# Optional offline comparison with the old resolver, using saved raw inputs:
npm run benchmark:ids -- --baseline-snapshots=/path/to/fribb-and-animeapi --samples=7
```

The optional folder contains `fribb.json` and `animeapi.tsv`. The benchmark reads
the old implementation from Git history, builds it in its own temporary directory
and removes that directory afterward. Production code does not use these files.
Local results go to `.cache/id-benchmark.json`; the recorded measurement is in
[performance.json](performance.json).
