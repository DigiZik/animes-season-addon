# Anime Seasons

<img src="logo.png" alt="Anime Seasons logo" width="180">

Browse anime by season or year using catalogs sourced from [AniList](https://anilist.co/). The static export uses Kitsu IDs, with IMDb IDs as fallback.

[![Publish catalogs](https://github.com/DigiZik/animes-season-addon/actions/workflows/update.yaml/badge.svg)](https://github.com/DigiZik/animes-season-addon/actions/workflows/update.yaml)

## Choose your manifest

**Use this URL. You do not need to install or host this repository yourself.**

| Your setup | Manifest | Catalog IDs |
| --- | --- | --- |
| **AIOmetadata** | [Copy AIOmetadata manifest](https://digizik.github.io/animes-season-addon/paginated/manifest.json) | Kitsu, with IMDb fallback |

### Install in AIOmetadata

1. Open your **AIOmetadata configuration** and go to **Catalogs**.
2. Choose the option to add a **Custom Manifest**, then paste:

   ```text
   https://digizik.github.io/animes-season-addon/paginated/manifest.json
   ```

3. Select the catalogs you want and save your configuration. Open your client and browse the added catalogs.

Use this manifest even when AIOmetadata is acting as a Jellyfin server for AIOStreams. Responses contain up to **100 titles**; see [Pagination](#pagination) for supported AIOmetadata settings.

Metadata and stream providers must support Kitsu and IMDb IDs. Cinemeta alone cannot supply metadata for Kitsu entries. The former separate Cinemeta manifest is retired; its users must switch to the main URL and a compatible metadata provider.

## Browse the catalogs

Each catalog is available for **series and movies**.

| Catalog | Default | Filter options |
| --- | --- | --- |
| **Anime Seasons** | Current season of the current year | Winter, Spring, Summer, Fall |
| **Anime Years** | Current calendar year | Current year back to 2001 |

AniList supplies season membership. Anime Seasons uses trending order; Anime Years uses overall popularity across all four seasons, including the current year. Annual lists remove duplicate output IDs. A year indicates season membership; a series may have debuted earlier.

Refreshes fetch every AniList page once per year with adult titles excluded, then split movies, series and seasons locally. Entries without season membership are excluded. AniList may classify ecchi as non-adult. Client pagination does not call AniList. Anime Seasons offers seasons for the current year only.

The default-season calendar uses UTC dates: December–February for Winter, March–May for Spring, June–August for Summer, and September–November for Fall. In December, the default is Winter of the current calendar year.

## Updates

The daily refresh at **12:30 PM UTC** fetches the current year once and derives all four seasons. At year rollover it also finalizes the previous year. Older years keep their committed data until a manual history refresh. Trending is a snapshot at refresh time.

Every Pages build downloads the Fribb ID mapping once. If fetching, conversion, building or validation fails, publishing stops and the previous Pages deployment stays online. There is no seasonal snapshot cache or automatic history refresh.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Only one page of titles appears | Use the paginated manifest and an AIOmetadata page size of at most 100. Refresh the AIOmetadata catalog cache and client view. |
| Titles don’t match the latest catalog | In AIOmetadata’s dashboard, use **Operations → Cache Management → Clear by ID** and preview the affected catalog ID before clearing it. Then reload the catalog in your client. |
| Anime Years asks for a year | Refresh the imported manifest and clear any selected filter. |
| Fewer titles than AniList | Titles without safe Kitsu/IMDb mappings are omitted. Annual lists also deduplicate output IDs. |
| Artwork, details or playback are missing | Check that your metadata and stream providers support the entry’s Kitsu or IMDb ID. The catalog includes fallback titles, posters and years when available. |
| An update fails | Check the repository’s **Actions** tab. The last successful deployment remains available. |

## Host your own fork

Only follow these steps if you want to publish your **own copy**. The installation URL above already works without forking.

1. Fork this repository and enable GitHub Actions. Keep `main` as the default branch.
2. Under **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source.
3. Under **Actions**, run **Update catalogs and publish Pages**. Enable **Refresh AniList data** for a current-year update, or **Refresh all years from 2001** for history; otherwise the run publishes committed inputs.
4. After deployment succeeds, replace `digizik` in the manifest URL above with your GitHub username.

Successful refreshes commit changed AniList inputs as `github-actions[bot]`. A push to `main` publishes committed inputs without refreshing AniList. Each build downloads the mapping dataset. Make sure branch rules permit the workflow to push, and pull `main` before editing because a refresh may have added commits.

### Pagination

Responses contain up to **100 titles** and support every integer offset. Keep AIOmetadata’s `CATALOG_LIST_ITEMS_SIZE` at **100 or below**; 20, 50 and 100 are covered by pagination tests. Recreate AIOmetadata’s container after changing its environment; no Pages rebuild is needed.

<details>
<summary>How pagination works</summary>

Repository catalog JSON and complete published catalogs are indented for readability; generated paginated responses stay compact. The builder checks exact file bytes against its size budget before generating pages.

The export supports normal first pages, explicit `skip=0`, integer offsets and both `skip`/`genre` parameter orders. For `N` titles, offsets through `N + 99` include empty terminal responses for client steps up to 100. Unsupported filters or offsets beyond the generated range may return 404. Overlapping responses are separate files because GitHub Pages serves static JSON.

</details>

<details>
<summary>How IDs and fallback metadata work</summary>

Readable AniList files in `catalog/` are internal build inputs. Each Pages build downloads the [Fribb anime cross-reference](https://github.com/Fribb/anime-lists) once, with one retry for a transient failure. It selects an unambiguous Kitsu ID first, then an acceptable IMDb ID. Missing or conflicting mappings are omitted; duplicate output IDs retain their first entry. Conversion uses exact associations without title searches, per-title requests or a mapping cache. A dataset link is not independent proof that a mapping is correct.

The export keeps fallback names, posters and years when available. Metadata enrichment, episode numbering and stream matching are handled downstream. Changing ID formats may affect existing library and watch-state associations; no state migration is performed.

</details>

## Development

Use Node.js 24:

```sh
npm ci
npm test
npm run build:pages
npm run verify:ids
npm run verify:pages
```

`npm start` refreshes the current year; `npm start -- --history` refreshes all years from 2001. History refreshes are slower and restart from the beginning if they fail. Both modes finish their requested fetches before replacing catalog sources. Changed AniList data updates the source manifest timestamp; identical refreshes do not rewrite it.

The Pages build validates the committed sources, downloads the mapping dataset and writes `.pages/` without modifying source files. The complete unpaginated manifest is also published at `/manifest.json`. The build enforces the 1 GB Pages artifact limit. See [performance results](docs/performance.md).

## Credits

- [victorgveloso/animes-season-addon](https://github.com/victorgveloso/animes-season-addon) — original addon and historical catalogs.
- [AniList](https://anilist.co/) — anime data and season membership.
- [Fribb/anime-lists](https://github.com/Fribb/anime-lists) — ID cross-references.
- [AIOmetadata](https://github.com/cedya77/aiometadata) and [Stremio](https://www.stremio.com/) — metadata integration and addon protocol.

The package declares the ISC license. Provider data remains subject to its own terms.
