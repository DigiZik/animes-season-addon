# Unified catalog performance

Measured on 25 November 2026 with Node.js 24.12.0 before the yearly-fetch change.

## Publishing footprint

| Artifact | Bytes | Files |
| --- | ---: | ---: |
| Previous native + Cinemeta site | 336,455,893 | 35,148 |
| Unified Kitsu/IMDb site | 294,763,124 | 32,890 |
| Reduction | 41,692,769 (12.4%) | 2,258 (6.4%) |

These are uncompressed published file bytes. The previous figure is the recorded two-export baseline; it was not rebuilt after removing the separate export. Fixed 100-item responses, arbitrary offsets, both filter parameter orders, readable complete catalogs, and compact paginated responses remain supported. Removing only the old Cinemeta feed would save about 4.1 MB; most remaining savings come from fewer mapped titles and shorter IDs. Omissions are a coverage trade-off, not a compression improvement.

One local build took 9.99 seconds including the bulk mapping download, conversion, and file generation. This is a single Windows measurement; it excludes compilation, separate verification, and deployment. Machine-readable results are in [performance.json](performance.json).

## Mapping coverage and overhead

| Measurement | Count |
| --- | ---: |
| Internal source files / published variants | 64 |
| Source entries across all variants | 11,398 |
| Unique AniList source titles | 10,264 |
| Published Kitsu entries across variants | 10,407 |
| Published IMDb fallback entries across variants | 34 |
| Unmapped/conflicting entries omitted across variants | 957 |
| Duplicate selected IDs removed across variants | 0 |
| Unique published IDs | 9,491 |

The published unique IDs comprise 9,464 Kitsu IDs and 27 IMDb IDs. Consequently, 773 unique source titles are omitted in this build. Preliminary audit counts were slightly higher because final mapping checks reject malformed Kitsu associations. Counts include historical titles and can change as providers update their datasets.

The build downloads Fribb once and constructs two type-aware indexes in memory. A transient request failure can trigger one retry. There are no per-title requests, title matching, persistent mapping files, or mapping caches. All seasons and years share those indexes; converting annual lists requires no additional mapping requests. Publish-only builds now require network access for this single bulk download. The normal build does not modify committed inputs.

AniList refreshes now use yearly queries: movies, series and seasons share one paginated sequence per year, adult titles are excluded, and seasonal lists derive locally. Only the source catalogs and source manifest are committed by workflow refreshes. A failed fetch, mapping conversion, build, or validation prevents Pages deployment.

## Verification and limits

- Offline tests cover mapping priority, conflicts, type collisions, movie safeguards, omissions, exact-ID deduplication, bounded retries, download limits, and wholly empty conversion failures.
- Pagination tests cover first pages, both filter orders, terminal pages, arbitrary offsets, and 20/50/100-item traversal. Every generated page is checked against its complete converted catalog.
- Current-year defaults, annual order, rollover, no-op refreshes, and failure handling remain tested. Source catalogs are retained as readable AniList inputs; public catalogs contain only Kitsu/IMDb IDs.
- An isolated harness exercised the actual importer and Jellyfin item/season/episode conversion functions from the existing AIOmetadata 4.1.0 image with published Kitsu and IMDb examples for both content types. IDs and artwork survived import; both episode-ID forms round-tripped. Metadata-provider dependencies were stubbed and container networking was disabled. This does not verify live metadata accuracy or AIOStreams playback.

The separate Cinemeta URL is retired. Kitsu entries require a compatible metadata provider. The ID migration can affect downstream library/watch-state associations; no state migration is performed.

## Yearly query comparison

Live-tested on 25 November 2026 with the same adult and format filters. Each yearly request sequence supplied movies, series and all four seasons.

| Year | Yearly requests | Four seasonal sequences | Series | Movies |
| --- | ---: | ---: | ---: | ---: |
| 2026 | 11 | 12 | 453 | 55 |
| 2025 | 12 | 13 | 491 | 79 |
| 2015 | 11 | 13 | 431 | 87 |
| 2005 | 6 | 8 | 222 | 46 |

Membership, types and fallback cards matched exactly in all four comparisons. Yearly queries used 40 requests versus 46 (13.0% fewer). No unseasoned entries appeared in these samples; the refresh excludes them to retain seasonal membership semantics. Ordering was checked against the returned scores: annual lists use popularity, seasonal lists use trending with popularity and ID tie-breakers. Scores are not persisted.

A full 2001–2026 refresh used 248 yearly page requests. The additional 46 seasonal comparison requests are test-only. All 64 refreshed source files retained the same titles and fallback metadata as the prior commit; only ordering changed.
