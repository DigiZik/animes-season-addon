# Anime Seasons for AIOmetadata and Cinemeta

Seasonal and yearly anime catalogs from **AniList**, with separate ID formats
for **AIOmetadata** and **Cinemeta**. Both exports include fallback metadata and
configurable pagination on GitHub Pages.

[![Publish catalogs](https://github.com/DigiZik/animes-season-addon/actions/workflows/update.yaml/badge.svg)](https://github.com/DigiZik/animes-season-addon/actions/workflows/update.yaml)
[![Node.js 24](https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)

## Contents

- [Features](#features)
- [Installation](#installation)
- [Catalogs and IDs](#catalogs-and-ids)
- [Automatic updates and fallback](#automatic-updates-and-fallback)
- [Configuration](#configuration)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Credits](#credits)

<a id="features"></a>

## 🚀 Features

- **Seasonal browsing:** Winter, Spring, Summer and Fall for movies and series.
- **Yearly browsing:** Current-year defaults, plus historical years back to 2001.
- **Native AIOmetadata IDs:** Pass AniList IDs through without a second mapper.
- **Separate Cinemeta IDs:** Export supported titles with IMDb IDs.
- **Fallback metadata:** Retain titles, posters and release years for display.
- **Pagination:** Match your client's page size; remove duplicate IDs before paging.
- **Daily publishing:** Refresh, validate and deploy with GitHub Actions.

<a id="installation"></a>

## 🛠️ Installation

Choose the export matching your metadata provider:

| Export | Manifest | IDs | Coverage |
| --- | --- | --- | --- |
| AIOmetadata | [Install native feed](https://digizik.github.io/animes-season-addon/paginated/manifest.json) | `anilist:<id>` | Every generated anime |
| Cinemeta | [Install IMDb feed](https://digizik.github.io/animes-season-addon/cinemeta/paginated/manifest.json) | `tt…` | Titles with an acceptable IMDb cross-reference |

For your AIOmetadata server, use **Custom Manifest** and import:

```text
https://digizik.github.io/animes-season-addon/paginated/manifest.json
```

The native URL and addon ID remain the same. After an upgrade, refresh the manifest
and catalog cache, then refresh the client library. The switch from Kitsu to native
AniList IDs can affect existing ID-based library/watch-state associations.

For direct Cinemeta use, install the IMDb feed alongside Cinemeta's metadata
addon. IMDb catalog names end in **(IMDb)** to distinguish them from the native feed.
Names are fallback display data; they are never used to guess an ID.

### Publish your own fork

1. Enable **Actions** in the repository and keep `main` as the default branch.
2. Under **Settings → Pages → Build and deployment**, select **GitHub Actions**.
3. Optionally set `PAGINATION_PAGE_SIZE` below.
4. Run **Update catalogs and publish Pages**.
5. Replace `digizik` in the install URLs with your GitHub username.

Leave **Refresh AniList data** unchecked to publish committed exports without
provider requests. Check it to refresh AniList and regenerate the IMDb export.

<a id="catalogs-and-ids"></a>

## 🧩 Catalogs and IDs

| Catalog | Without a filter | Filters |
| --- | --- | --- |
| Anime Seasons — Series/Movies | Current season, current year | Winter, Spring, Summer, Fall |
| Anime Years — Series/Movies | Current calendar year | Current year through 2001 |

AniList supplies season membership and popularity ordering through its GraphQL
API. The fork does not scrape AniChart. The native catalog retains AniList IDs;
AIOmetadata performs metadata and stream-ID resolution. AIOmetadata v4.1.0's
[importer supports AniList IDs](https://github.com/cedya77/aiometadata/blob/v4.1.0/addon/utils/stremthru.js).

### Minimal Cinemeta conversion

[Cinemeta accepts IMDb IDs](https://v3-cinemeta.strem.io/manifest.json), so its
separate export performs the one conversion the native feed does not need:
one bulk [Fribb cross-reference](https://github.com/Fribb/anime-lists) download per
IMDb refresh. There are no per-title mapping requests, fuzzy title searches,
dataset merging, mapping snapshots, mapping caches, or retry chains.

The exporter requires an exact AniList-ID association and an acceptable content
type. Missing, conflicting and multi-part movie mappings are omitted. Movie/TV
namespace conflicts and IMDb IDs shared by distinct movies are rejected. Shared
series IMDb IDs represent one Cinemeta show and are deduplicated in source order.
An explicit dataset link is not independent proof that the dataset is correct.

The native feed keeps all titles, including ones omitted from the IMDb feed.
Fallback titles, posters and release years remain available in both exports.
Full descriptions, genres, backgrounds and playback hints are left to the metadata
provider; they are not needed for catalog identity or basic display. If AIOmetadata
has no mapping for a native title, full enrichment or playback may be unavailable.
The catalog does not replace it with an unrelated title.

### Year ordering and source limits

The current year combines saved season files in Winter → Spring → Summer → Fall
order, retaining the first occurrence of each ID. This requires no extra AniList
requests. The year indicates seasonal membership, not necessarily a show's debut.

The inherited query fetches the first **50 results per season and content type**.
Year catalogs combine up to 200 entries before deduplication. Pagination serves
all generated entries; it does not expand AniList's source query. Year ordering
groups seasons rather than applying one popularity ranking across the whole year.

The inherited default-season calendar remains December–February for Winter,
March–May for Spring, June–August for Summer, and September–November for Fall.
It can differ from AniChart's quarter boundaries.

<a id="automatic-updates-and-fallback"></a>

## 🔄 Automatic updates and fallback

| Trigger | Refresh providers | Build and publish |
| --- | --- | --- |
| Daily at 04:30 UTC | AniList, then one IMDb cross-reference download | Yes |
| Push to `main` | No | Yes |
| Manual run | When the refresh option is checked | Yes |

Each run tests the code, optionally refreshes both exports, prepares current-year
defaults, builds pagination, validates both feeds and checks the combined Pages
size. Updated source exports are committed as `github-actions[bot]`. Generated
pages are uploaded as an artifact and remain out of Git history.

If a provider request or validation fails, the workflow stops and the previous
Pages deployment stays online. There is no provider snapshot fallback. Committed
exports can still be republished using a manual run with refresh disabled.

Native generation (`npm start`) does not depend on an IMDb mapping provider.
The combined daily publishing workflow additionally requires the Cinemeta
conversion to succeed before replacing the public deployment.

Historical years remain available. After a successful new-year refresh, the new
year becomes the default. Publish-only runs refuse to relabel last year's season
files as the new year. GitHub schedules can be delayed or disabled after extended
public-repository inactivity. Upstream code changes are not merged automatically.

<a id="configuration"></a>

## ⚙️ Configuration

| Setting | Where | Default |
| --- | --- | --- |
| `PAGINATION_PAGE_SIZE` | Repository → Settings → Secrets and variables → Actions → Variables | `20` |
| `CATALOG_LIST_ITEMS_SIZE` | AIOmetadata environment | `20` |

Match the page sizes. The catalog cannot detect AIOmetadata's setting from its
requests. After changing the repository variable, rerun publishing. The native export uses that size. The Cinemeta export uses standard
100-item Stremio pages; use the native feed for AIOmetadata's configurable paging. Recreate AIOmetadata's container after changing its environment.

Normal first-page URLs, explicit `skip=0`, arbitrary integer offsets and both
`skip&genre` parameter orders are supported. For `N` titles and page size `P`,
native offsets through `N + P` are generated; offsets at or beyond `N` in that range
return `{"metas":[]}`. Cinemeta generates only standard multiples of 100 through
an empty terminal page. Larger or unsupported offsets and filters can return 404.

<a id="development"></a>

## 🧑‍💻 Development

Use **Node.js 24** and the lockfile:

```sh
npm ci
npm test
npm run build:pages
npm run verify:ids
npm run verify:pages
```

| Command | Purpose |
| --- | --- |
| `npm start` | Refresh native catalogs from AniList; no mapping requests |
| `npm run export:cinemeta` | Refresh the separate IMDb export with one bulk download |
| `npm run build:pages` | Build both committed exports offline into `.pages/` |
| `npm run verify:ids` | Validate both ID formats, compact fallback metadata offline |
| `npm run verify:pages` | Check traversal, terminal responses, copied originals and total size |
| `npm test` | Run type checks and deterministic tests |
| `npm run benchmark:ids` | Measure native ID export without provider requests |

See [performance results](docs/performance.md) for the before/after benchmark and
optional offline comparison with the removed mapper. Native source files are in
`catalog/`; IMDb source files are in `cinemeta/catalog/`. Complete manifests remain
at `/manifest.json` and `/cinemeta/manifest.json` for clients not needing pagination.

Builds remove stale generated pages, serialize metadata once, preflight byte
counts, bound filesystem writes and enforce the **combined 1 GB** Pages limit.
Only manifests and catalog files enter the publishing artifact. The workflow
uses a normal push; branch rules must permit its data commits. Pull `main` before
editing because scheduled refreshes may have added commits.

<a id="troubleshooting"></a>

## 🔎 Troubleshooting

| Symptom | Check |
| --- | --- |
| Only one page appears | Import a paginated manifest, match page sizes, refresh provider/client caches |
| Anime Years requires a year | Refresh the manifest and clear the explicitly selected filter |
| Fewer titles in Cinemeta | Unmapped or ambiguous IMDb entries are omitted; use the native AIOmetadata feed for full coverage |
| Artwork/details are missing | Fallback metadata is retained; downstream enrichment still depends on provider mappings |
| Old titles remain after an ID change | Refresh the AIOmetadata catalog cache and client library |
| Refresh fails | Inspect Actions; the last successful public deployment remains available |

<a id="credits"></a>

## 🙏 Credits

- [victorgveloso/animes-season-addon](https://github.com/victorgveloso/animes-season-addon) — original generator and historical data.
- [AniList](https://anilist.co/) — source identities, metadata and seasonal membership.
- [Fribb/anime-lists](https://github.com/Fribb/anime-lists) — the separate Cinemeta export's IMDb links.
- [AIOmetadata](https://github.com/cedya77/aiometadata) and [Stremio](https://www.stremio.com/) — integration and addon protocol.

The package declares the ISC license. Provider data remains subject to its own
terms. Private account configurations and credentials do not belong in this public
repository; `.env` and `.env.*` remain ignored.
