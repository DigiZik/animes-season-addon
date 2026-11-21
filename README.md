# Anime Seasons

Browse anime by season or year using catalogs sourced from [AniList](https://anilist.co/). Choose the AIOmetadata or Cinemeta manifest for your setup.

[![Publish catalogs](https://github.com/DigiZik/animes-season-addon/actions/workflows/update.yaml/badge.svg)](https://github.com/DigiZik/animes-season-addon/actions/workflows/update.yaml)

## Choose your manifest

**Use one of these URLs. You do not need to install or host this repository yourself.**

| Your setup | Manifest | Catalog IDs |
| --- | --- | --- |
| **AIOmetadata** | [Copy AIOmetadata manifest](https://digizik.github.io/animes-season-addon/paginated/manifest.json) | AniList |
| **Cinemeta** | [Copy Cinemeta manifest](https://digizik.github.io/animes-season-addon/cinemeta/paginated/manifest.json) | IMDb |

### Install in AIOmetadata

1. Open your **AIOmetadata configuration** and go to **Catalogs**.
2. Choose the option to add a **Custom Manifest**, then paste:

   ```text
   https://digizik.github.io/animes-season-addon/paginated/manifest.json
   ```

3. Select the catalogs you want and save your configuration. Open your client and browse the added catalogs.

Use this manifest even when AIOmetadata is acting as a Jellyfin server for AIOStreams. The default page size is **20**; see [Pagination](#pagination) if you changed AIOmetadata’s `CATALOG_LIST_ITEMS_SIZE`.

### Install with Cinemeta

Install this manifest as a catalog addon alongside Cinemeta, which supplies the metadata:

```text
https://digizik.github.io/animes-season-addon/cinemeta/paginated/manifest.json
```

These catalogs have **(IMDb)** in their names. They include only titles with an acceptable IMDb mapping, so they may contain fewer titles than the AIOmetadata catalogs.

## Browse the catalogs

Each catalog is available for **series and movies**.

| Catalog | Default | Filter options |
| --- | --- | --- |
| **Anime Seasons** | Current season of the current year | Winter, Spring, Summer, Fall |
| **Anime Years** | Current calendar year | Current year back to 2001 |

AniList supplies season membership and popularity ordering. The current-year list combines seasons in Winter → Spring → Summer → Fall order and removes duplicate IDs. A year indicates season membership; a series may have debuted earlier.

Each season contains up to **50 AniList results per content type**. Pagination lets you browse the generated results; it does not increase this source limit. Anime Seasons offers seasons for the current year only—it does not combine a season filter with a historical year.

The default-season calendar uses December–February for Winter, March–May for Spring, June–August for Summer, and September–November for Fall. It can differ from AniChart’s boundaries. In December, the default is Winter of the current calendar year.

## Updates

The published catalogs are refreshed daily at **12:30 PM UTC**. Each refresh fetches AniList data, downloads the IMDb cross-reference, validates both exports, and publishes them.

If a refresh or validation fails, the previous successful deployment stays online. The workflow does not automatically merge upstream code changes.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Only one page of titles appears | Use the paginated manifest and check that the page sizes match in [Pagination](#pagination). Refresh the AIOmetadata catalog cache and client view. |
| Titles don’t match the latest catalog | In AIOmetadata’s dashboard, use **Operations → Cache Management → Clear by ID** and preview the affected catalog ID before clearing it. Then reload the catalog in your client. |
| Anime Years asks for a year | Refresh the imported manifest and clear any selected filter. |
| Cinemeta shows fewer titles | Titles with missing, ambiguous or unsuitable IMDb mappings are omitted. The AIOmetadata manifest retains the native AniList entries. |
| Artwork or details are missing | The catalog includes fallback titles, posters and years when available. Full metadata and playback depend on the client’s metadata and stream providers. |
| An update fails | Check the repository’s **Actions** tab. The last successful deployment remains available. |

## Host your own fork

Only follow these steps if you want to publish your **own copy**. The installation URLs above already work without forking.

1. Fork this repository and enable GitHub Actions. Keep `main` as the default branch.
2. In your fork, open **Settings → Pages → Build and deployment** and select **GitHub Actions** as the source.
3. If needed, set `PAGINATION_PAGE_SIZE` as described below.
4. Under **Actions**, run **Update catalogs and publish Pages**. Enable **Refresh AniList data** if you want a fresh provider update; otherwise the run publishes the committed catalogs.
5. After the deployment succeeds, replace `digizik` in the two manifest URLs above with your GitHub username.

Successful refreshes commit changed native and IMDb catalogs as `github-actions[bot]`. A push to `main` publishes committed data without refreshing providers. Manual runs can do either. Make sure branch rules permit the workflow to push, and pull `main` before editing because a refresh may have added commits.

### Pagination

For the AIOmetadata manifest, match these values:

| Setting | Where | Default |
| --- | --- | --- |
| `PAGINATION_PAGE_SIZE` | GitHub repository → **Settings → Secrets and variables → Actions → Variables** | `20` |
| `CATALOG_LIST_ITEMS_SIZE` | AIOmetadata environment | `20` |

The static catalog cannot detect AIOmetadata’s page-size setting. After changing the repository variable, rerun the publishing workflow. If you change AIOmetadata’s environment, recreate its container. The separate Cinemeta manifest uses standard **100-item** pages.

<details>
<summary>How pagination works</summary>

The native export supports normal first pages, explicit `skip=0`, integer offsets and both `skip`/`genre` parameter orders. For `N` titles and page size `P`, offsets through `N + P` are generated, including empty terminal responses. Cinemeta generates standard multiples of 100 through an empty terminal page. Unsupported filters or offsets beyond the generated range may return 404.

</details>

<details>
<summary>How IDs and fallback metadata work</summary>

The AIOmetadata catalog passes AniList IDs directly to the metadata provider. The Cinemeta export downloads the [Fribb anime cross-reference](https://github.com/Fribb/anime-lists) once per refresh and produces IMDb IDs; it uses exact ID associations rather than title matching. Missing, conflicting, wrong-type and ambiguous movie mappings are omitted. Series sharing an IMDb ID are deduplicated in source order. A dataset link is not independent proof that a mapping is correct.

Both exports keep fallback names, posters and years when available. Metadata enrichment and stream matching are handled downstream. A missing downstream mapping can affect details or playback. Changing ID formats may affect existing ID-based watch-state associations.

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

`npm start` refreshes AniList catalogs; `npm run export:cinemeta` refreshes the IMDb export using one bulk mapping download. The offline Pages build reads the committed exports and writes `.pages/`. Source catalogs are in `catalog/` and `cinemeta/catalog/`. Complete unpaginated manifests are also published at `/manifest.json` and `/cinemeta/manifest.json`.

The build validates pagination and enforces the combined 1 GB Pages artifact limit. See [performance results](docs/performance.md) for the ID-export benchmark.

## Credits

- [victorgveloso/animes-season-addon](https://github.com/victorgveloso/animes-season-addon) — original addon and historical catalogs.
- [AniList](https://anilist.co/) — anime data and season membership.
- [Fribb/anime-lists](https://github.com/Fribb/anime-lists) — IMDb cross-references.
- [AIOmetadata](https://github.com/cedya77/aiometadata) and [Stremio](https://www.stremio.com/) — metadata integration and addon protocol.

The package declares the ISC license. Provider data remains subject to its own terms.
