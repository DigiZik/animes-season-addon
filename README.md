# Anime Seasons

Browse anime by season or year using [AniList](https://anilist.co/) data. One static export uses Kitsu IDs, with IMDb IDs as fallback.

[![Publish catalogs](https://github.com/DigiZik/animes-season-addon/actions/workflows/update.yaml/badge.svg)](https://github.com/DigiZik/animes-season-addon/actions/workflows/update.yaml)

## Install

Import this custom manifest in **AIOmetadata → Catalogs**, select your catalogs, and save:

https://digizik.github.io/animes-season-addon/paginated/manifest.json

Use the same URL when AIOmetadata acts as a Jellyfin server for AIOStreams. Metadata and stream providers must support Kitsu and IMDb IDs. Cinemeta alone cannot supply metadata for Kitsu entries. The former separate Cinemeta manifest is retired; its users must switch to the main URL and a compatible metadata provider.

## Catalogs

Each catalog is available separately for movies and series.

| Catalog | Default | Filter options |
| --- | --- | --- |
| Anime Seasons | Current season of the current year | Winter, Spring, Summer, Fall |
| Anime Years | Current calendar year | Current year back to 2001 |

AniList supplies season membership and popularity ordering. Annual lists combine Winter → Spring → Summer → Fall and remove duplicate output IDs in first-occurrence order. A year indicates season membership; a series may have debuted earlier. The season selector covers the current year only.

Refreshes fetch all AniList pages with adult titles excluded, then split movies and series locally. AniList may classify ecchi as non-adult. Browsing catalogs never calls AniList.

Default seasons use UTC dates: December–February for Winter, March–May for Spring, June–August for Summer, and September–November for Fall. In December, Winter means the current calendar year.

## Updates and IDs

The daily refresh at **12:30 PM UTC** updates all four seasons of the current year, finalizing the previous year at rollover. Older years retain their committed data until a manual history refresh.

Readable AniList files in `catalog/` are internal build inputs. Every Pages build downloads the [Fribb cross-reference](https://github.com/Fribb/anime-lists) once, allowing one retry for transient failures. It selects an unambiguous Kitsu ID first, then an acceptable IMDb ID. Missing/conflicting mappings are omitted; duplicate output IDs retain their first entry. Conversion uses exact IDs without title searches, per-title requests, or a mapping cache. Build summaries report mapping coverage and omissions.

Published catalogs contain only Kitsu/IMDb IDs, fallback names, posters, and years when available. Full metadata, episode numbering, and playback depend on downstream providers and mapping accuracy. Changing from AniList IDs may affect library or watch-state associations; this project does not migrate them.

If fetching, conversion, building, or validation fails, deployment stops and the previous Pages deployment remains available. Publish-only builds also require the mapping download. Provider data can change even when AniList source files do not.

## Pagination

Responses contain up to **100 titles**, supporting every integer offset, explicit `skip=0`, and both filter parameter orders. Keep AIOmetadata’s `CATALOG_LIST_ITEMS_SIZE` at 100 or below; 20, 50, and 100 are tested. There is no repository page-size setting.

Complete catalogs and manifests remain readable JSON; generated paginated responses are compact. For `N` titles, offsets through `N + 99` include empty terminal responses. Unsupported filters and offsets beyond that range may return 404. The complete unpaginated manifest is also available at `/manifest.json`.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Only one page appears | Use the paginated URL, keep AIOmetadata’s page size at most 100, and refresh its catalog cache and client view. |
| Stale titles or IDs after migration | Refresh the imported manifest; preview the catalog in AIOmetadata’s Operations → Cache Management → Clear by ID, then clear its cache and reload. |
| Fewer titles than AniList | Titles without safe Kitsu/IMDb mappings are omitted. Annual lists also deduplicate output IDs. |
| Missing details, artwork, or playback | Check metadata/stream provider support and mappings for the entry’s Kitsu or IMDb ID. |
| An update fails | Check GitHub Actions; the previous successful site remains available. |

## Development and hosting

Use Node.js 24. Run `npm ci`, `npm test`, `npm run build:pages`, `npm run verify:ids`, and `npm run verify:pages`. Tests use fixtures and do not require provider access. A normal Pages build requires one bulk mapping download and writes only generated `.pages/` output.

`npm start` refreshes current-year AniList inputs; `npm start -- --history` refreshes all years from 2001. Requested fetches finish before sources are replaced. Identical refreshes do not rewrite the source manifest timestamp. History refreshes restart from the beginning after failure.

To host a fork, enable GitHub Pages with **GitHub Actions** as its source and run **Update catalogs and publish Pages**. Enable **Refresh AniList data** for a current-year refresh, or **Refresh all years from 2001** for history. Otherwise, it maps and publishes committed inputs. Replace `digizik` in the manifest URL with your username.

Pushes to main publish committed inputs. Successful workflow refreshes commit changed AniList inputs as github-actions[bot]; branch rules must allow this, and pull main before editing. Cloudflare dispatch requires no change. See [performance results](docs/performance.md).

## Credits

- [victorgveloso/animes-season-addon](https://github.com/victorgveloso/animes-season-addon) — original addon and historical catalogs.
- [AniList](https://anilist.co/) — anime data and season membership.
- [Fribb/anime-lists](https://github.com/Fribb/anime-lists) — ID cross-references.
- [AIOmetadata](https://github.com/cedya77/aiometadata) and [Stremio](https://www.stremio.com/) — integration and addon protocol.

The package declares the ISC license. Provider data remains subject to its own terms.
