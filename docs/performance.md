# Compact catalog performance

Historical ID-conversion comparison with resolver commit `59024c0` on Node v24.12.0, win32/x64.
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
provider cache or dataset-merging layer. The bulk IMDb download now permits one
retry for a transient request failure; successful first attempts use one request.

## Publishing footprint

Current fixed-100 build, measured on 25 November 2026 using catalogs from
`25158cb`:

| Artifact | Bytes | Files |
| --- | ---: | ---: |
| Native feed, every integer offset | 332,342,112 | 34,701 |
| Cinemeta feed, offsets in steps of 100 | 4,113,781 | 447 |
| Combined published site | 336,455,893 | 35,148 |
| Compressed GitHub Pages upload | 63,120,352 | — |

The latest successful Actions run spent 3 seconds building, 4 seconds validating
Pages, and 6 seconds uploading. Published file bytes and compressed upload bytes
are different measurements. Readable source catalogs add only 852,752 bytes over
compact copies. Generated paginated JSON remains compact. Both parameter orders,
native arbitrary offsets, fallback artwork and years are retained.

The older compact-preview migration below used smaller source catalogs and
configurable native page sizes; its sizes are not the current footprint:

| Artifact | Bytes |
| --- | ---: |
| Previous native feed alone | 217,234,501 |
| Compact native feed | 44,748,506 |
| Additional Cinemeta feed | 3,111,925 |
| Both compact feeds combined | 47,860,431 |

At that migration, both new feeds together used **78.0% less space** than the
previous single feed. The current native feed uses fixed 100-item responses and
every supported integer offset. Cinemeta uses standard 100-item Stremio pages
and only their required offsets.

Previews contain only ID, type, title, poster URL and optional release year.
Descriptions, tags, genres, backgrounds, duplicate source-ID fields and movie
playback hints were removed. Poster images are not downloaded or embedded by
the generator. Provider metadata remains responsible for detailed information.

## Refresh requests and build overhead

Movies and series are now retrieved in one paginated sequence per season and
split locally by format. The same adult exclusion and popularity/ID sort apply.
Annual catalogs use the four seasonal lists locally; they require no additional
AniList requests. AniList pages still contain at most 50 entries, and pagination
continues using `hasNextPage`.

With the committed current-year counts, this models 12 requests instead of 16
(25% fewer), or about 8.8 seconds less pacing delay. This is not a live timing
claim: changing source counts and retries affect the actual result. Historical
season refreshes use the same method. Existing rate-limit pacing stays intact.

Actions compiles TypeScript once in the offline test step, then reuses the
compiled refresh and build entry points. Local npm commands still compile when
needed. Shared catalog derivation preserves seasonal order, annual deduplication
and defaults. Offline builds validate both exports without modifying sources.
Changed native data advances its manifest timestamp; identical refreshes do not.

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

- Offline tests cover mixed-format pagination, adult exclusion, order and
  deduplication, late failures, rollover, no-op refreshes and bounded mapping
  retries, plus 20/50/100-item client traversal of fixed-100 native responses.
- Current native export: 64 variants, 11,398 entries, 10,264 unique AniList IDs.
- Current Cinemeta export: 64 variants, 5,634 entries, 3,784 unique IMDb IDs.
- The earlier ID migration exercised the actual AIOmetadata v4.1.0 importer
  with mapped/unmapped native IDs and IMDb IDs, plus live Cinemeta metadata.
  That historical check is not a new AIOStreams UI test of these changes.
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

The footprint and Actions timings above come from the build of `25158cb` and
[its successful workflow](https://github.com/DigiZik/animes-season-addon/actions/runs/45557268579).
