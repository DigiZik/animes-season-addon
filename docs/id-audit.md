# Catalog identity audit — 21 November 2026

All 64 catalog files were audited using exact AniList identities against the Fribb and animeApi cross-reference datasets. No title searches were used.

| Check | Result |
| --- | --- |
| Original catalog entries | 6,944 |
| Distinct AniList identities | 6,389 |
| Previous IDs absent from current cross-references | 1,357 |
| Entries after repairing and rebuilding current-year defaults | 6,956 |
| Further ID changes required by the final audit | 0 |
| Distinct anime retaining AniList IDs | 270 |

An absent cross-reference does not by itself prove an old ID was incorrect. All exports now use an unambiguous native Kitsu ID or retain their original AniList ID, avoiding arbitrary IMDb guesses. Entries are not dropped when a Kitsu link is unavailable.

## Confirmed reported mismatches

| Intended anime | Incorrect IMDb ID | Repaired ID |
| --- | --- | --- |
| Shiranuhi | tt42411584 — Watashi wa Anata o Shiranai | anilist:176373 |
| Rusuban | tt39215225 — A Russian Winter | anilist:213908 |
| Norman the Snowman: Kodomo-tachi no Hitotsuboshi | tt40145204 — Mark Normand: None Too Pleased | kitsu:51003 |

Current-year defaults contain 200 series and 52 movies after rebuilding from repaired seasons. Some older IMDb IDs had merged distinct anime; native IDs restore those entries. Titles, artwork, descriptions, and seasonal membership were retained.

## Validation

- 134 deterministic tests, including concurrency, provider failure, malformed data, conflicting links, and all three reported mismatches.
- All 64 catalog variants pass complete pagination traversal.
- Native-ID/provenance validation runs before every deployment without network requests.
- The live resolver smoke test used two bulk downloads for all three reported titles.

Full per-entry findings are available locally in the ignored `.cache/id-audit-before.json` and `.cache/id-audit.json` files. Run `npm run audit:ids` to audit against the latest provider datasets, or use `--snapshots=directory` with saved `fribb.json` and `animeapi.tsv` inputs.

## Dataset fingerprints

The audit used these input SHA-256 hashes:

```text
fribb.json  5e1b838cee57430c5c8594c98fa9216686c67bd2df83d9eb0bdd6c1c2a060fae
animeapi.tsv  80eb77cdf464f5fa15b38964461c6c7dca6aaf356795e9d0276b356af436b501
```

## Follow-up conflict audit — v1.3.0

The stronger cross-field audit checks MAL, AniDB, Simkl and Kitsu agreement before accepting overlay links. It found two additional ambiguous entries: SHORT PEACE (AniList 17677) and Whistle! (AniList 183). Both retain their original AniList IDs. All 64 files and 6,956 entries were re-audited; 6,389 distinct anime remain, 272 retain AniList IDs, and the final audit requires no further changes. All metadata and ordering match b318225. The original three reported repairs remain correct.

See [performance and verification results](mapping-performance.md) for the 169-test validation and benchmark comparison.
