# Anime Seasons for AIOmetadata

Seasonal and yearly anime catalogs from **AniList**, with pagination for
**AIOmetadata** and its Jellyfin integration. Browse movies and series by season
or year, with the current year available automatically on your home screen.

[![Publish catalogs](https://github.com/DigiZik/animes-season-addon/actions/workflows/update.yaml/badge.svg)](https://github.com/DigiZik/animes-season-addon/actions/workflows/update.yaml)
[![Node.js 24](https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)

**[Install manifest](https://digizik.github.io/animes-season-addon/paginated/manifest.json)**
· [Workflow status](https://github.com/DigiZik/animes-season-addon/actions)
· [Report an issue](https://github.com/DigiZik/animes-season-addon/issues)

---

## Contents

- [Features](#features)
- [Installation](#installation)
- [Catalogs and data sources](#catalogs-and-data-sources)
- [Automatic updates](#automatic-updates)
- [Configuration](#configuration)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Credits](#credits)

---

<a id="features"></a>

## 🚀 Features

- **Seasonal browsing:** Current-year anime grouped into Winter, Spring, Summer, and Fall.
- **Yearly browsing:** The current year and historical years back to 2001, for both series and movies.
- **Home screen defaults:** Anime Seasons shows the selected current season; Anime Years shows the current calendar year when no filter is selected.
- **Configurable pagination:** Choose the page size to match AIOmetadata, with duplicate titles removed before paging.
- **Daily publishing:** GitHub Actions refreshes the data and deploys the verified catalogs to GitHub Pages.
- **Existing catalogs preserved:** Historical JSON files and the original manifest remain available.

<a id="installation"></a>

## 🛠️ Installation

### Import into AIOmetadata

1. Open your AIOmetadata configuration and choose the **Custom Manifest** importer.
2. Paste this URL:

   ```text
   https://digizik.github.io/animes-season-addon/paginated/manifest.json
   ```

3. Enable the imported **Anime Seasons** and **Anime Years** catalogs you want.
4. Save, then refresh your AIOStreams library/catalog view if using the Jellyfin integration.

> **Already imported an older version?** Refresh or re-import the manifest so
> AIOmetadata picks up the optional year filter and the new current-year choice.
> Clear any explicitly selected year to use the automatic default.

### Publish your own fork

1. Enable **Actions** in your fork. Keep `main` as the default branch.
2. Under **Settings → Pages → Build and deployment**, select **GitHub Actions**.
3. Optionally set the repository variable `PAGINATION_PAGE_SIZE` as described below.
4. Run **Actions → Update catalogs and publish Pages → Run workflow**.
5. Replace `digizik` in the install URL with your GitHub username.

Leave **Refresh AniList data** unchecked to publish using saved data. Check it
when you need fresh provider data, including the first refresh after a year change.

<a id="catalogs-and-data-sources"></a>

## 🧩 Catalogs and data sources

| Catalog | Without a filter | Available filters |
| --- | --- | --- |
| Anime Seasons — Series | Current season, current year | Winter, Spring, Summer, Fall |
| Anime Seasons — Movies | Current season, current year | Winter, Spring, Summer, Fall |
| Anime Years — Series | Current calendar year | Current year through 2001 |
| Anime Years — Movies | Current calendar year | Current year through 2001 |

**Where the data comes from:** The generator queries AniList's GraphQL API using
`seasonYear` and `season`, sorted by `POPULARITY_DESC`. AniList assigns season
membership; the generator does not scrape the AniChart website. Verified anime ID mappings connect those entries to metadata clients can use.

### Verified anime identities

Catalog entries use an unambiguous `kitsu:` ID from the
[Fribb](https://github.com/Fribb/anime-lists) and
[animeApi](https://github.com/nattadasu/animeApi) cross-reference datasets. If a
Kitsu link is missing, conflicting, or shared by distinct AniList entries, the
original `anilist:` ID is retained. There are no fuzzy title searches or shortened
name guesses. Each entry records its original `anilistId` for auditing.

Fribb is the primary mapping source. The animeApi overlay fills gaps only when
native identity fields agree and the added IDs are not already owned by another
anime. Conflicting MAL, AniDB, Simkl, or Kitsu evidence retains the original
AniList identity. TMDB movie and TV numbers are kept in separate namespaces.
Provider-level provenance records which dataset supplied accepted links. Here,
"verified" means an explicit, consistent cross-reference, not independent proof.

The resolver builds an in-memory index once and reuses chosen IDs. There are no
per-title mapping requests. Legacy title/IMDb patches cannot overwrite native IDs.
Titles without a supported stream mapping can remain unavailable for playback
until providers add one; they are never replaced with an unrelated film.

### Mapping cache and fallback

Refresh runs restore ignored `.cache/mappings/` snapshots through GitHub Actions
cache. Each provider is checked with one conditional GET. A `304` response reuses
validated data without downloading its body. New data is validated before an
atomic snapshot replacement, keeping bodies, timestamps, and ETags together.

Transient connection failures, HTTP 429, and selected server errors receive at
most two retries. Backoff starts at 250 ms; short Retry-After values are respected.
Each attempt has a maximum 20-second timeout within a 45-second download budget
per provider. Long Retry-After values defer to fallback instead of holding a run.

| Situation | Behaviour |
| --- | --- |
| Download fails; validated snapshot is within the age limit | Use that snapshot and report degraded operation |
| Snapshot is too old or corrupt | Refuse it; a successful origin revalidation can make an old snapshot usable |
| Fribb unavailable without a usable snapshot | Stop the refresh; keep the previous public deployment |
| animeApi unavailable without a usable snapshot | Continue with Fribb; preserve AniList IDs where links are missing |
| No AniList seasonal data | Stop the refresh; mapping snapshots do not replace seasonal data |

The default fallback age limit is **7 days** since the last successful download or
origin revalidation. Fallback use never renews that timestamp. Set repository
variable `MAPPING_CACHE_MAX_AGE_DAYS` to an integer from **1–30** to change it.
Actions cache is an optimisation and may be evicted; a cache miss fetches fresh
data. Publish-only runs make no mapping requests or mapping-cache transfers.

Each refresh emits one aggregate mapping report in the Actions log and job
summary: source status and age, download attempts and bytes, conflicts, and native
fallback counts. The detailed report is saved locally as
`.cache/mapping-report.json`. Cached files contain public mapping data only;
they are excluded from Git and the Pages artifact.

**How yearly catalogs work:** The current year combines the four existing season
files in Winter → Spring → Summer → Fall order. Each title keeps its first
occurrence and metadata. This reuses data already fetched during a normal refresh,
so adding the year catalog requires no additional AniList requests. The year
represents seasonal membership, not necessarily a show's original debut year.

> **Source limit:** The inherited query fetches only the first **50 results per
> season and content type**. Pagination serves all generated entries; it does not
> expand AniList's source query. Year catalogs therefore combine up to 200 source
> entries before deduplication and ID filtering. Year ordering groups seasons;
> it is not a single popularity ranking across the whole year.

The inherited default-season calendar is December–February for Winter,
March–May for Spring, June–August for Summer, and September–November for Fall.

<a id="automatic-updates"></a>

## 🔄 Automatic updates

```text
AniList → catalog generator → pagination and validation → GitHub Pages
                                                           ↓
                                                   AIOmetadata → AIOStreams
```

| Trigger | Refreshes AniList data | Builds and publishes |
| --- | --- | --- |
| Daily at 04:30 UTC  | Yes | Yes |
| Push to `main` | No | Yes |
| Manual workflow run | If the refresh option is checked | Yes |

Each run executes offline tests, optionally refreshes source data, prepares the
current-year defaults, builds pagination, and verifies every advertised filter.
Changed source catalogs are committed as `github-actions[bot]`; generated pages
are uploaded as an artifact instead of growing the Git history.

Historical years stay available. At the next successful annual refresh, the new
calendar year becomes the default and the previous year remains selectable.
A publish-only run refuses to label last year's seasonal files as the new year.

**If AniList is unavailable:** The refresh fails and the last successful Pages
deployment stays online. The next daily run tries again, or you can manually run
with refresh enabled. There is no alternative provider for seasonal catalog data;
the ID mapping fallbacks serve a different purpose.

GitHub's scheduled runs can be delayed. Public repositories with no activity for
60 days can have their schedules disabled; re-enable the workflow in **Actions**
if GitHub reports that state. Upstream code changes are not merged automatically.

<a id="configuration"></a>

## ⚙️ Configuration

| Setting | Where to set it | Default |
| --- | --- | --- |
| `PAGINATION_PAGE_SIZE` | GitHub repository → Settings → Secrets and variables → Actions → Variables | `20` |
| `MAPPING_CACHE_MAX_AGE_DAYS` | GitHub repository → Actions → Variables; maximum fallback age, 1–30 days | `7` |
| `CATALOG_LIST_ITEMS_SIZE` | Your AIOmetadata environment | `20` |

**Keep the two page-size values equal.** AIOmetadata sends `skip` and `genre` but no requested
page size, so the public catalog cannot detect your setting automatically.

After changing the repository variable, manually run the publishing workflow.
Changing a variable alone does not trigger a build. If you change AIOmetadata's
environment setting, recreate its container to apply it.

<details>
<summary><strong>Pagination URLs and static hosting limits</strong></summary>

The paginated manifest uses the ID `com.digizik.animes-season-addon.paginated`.
The original manifest remains at `/manifest.json`; the new one is at
`/paginated/manifest.json`.

For a catalog with `N` unique titles and page size `P`, the site publishes the
normal first page, explicit `skip=0`, and every integer offset through `N + P`.
Both extra-parameter orders are supported:

```text
/paginated/catalog/series/archive_anime_seasons.json
/paginated/catalog/series/archive_anime_seasons/genre=2026.json
/paginated/catalog/series/archive_anime_seasons/skip=20.json
/paginated/catalog/series/archive_anime_seasons/skip=20&genre=2026.json
/paginated/catalog/series/archive_anime_seasons/genre=2026&skip=20.json
```

Generated offsets at or beyond the end return `{"metas":[]}`. Unsupported filters
and offsets beyond the generated range can return 404. Normal sequential
traversal at the configured page size has a valid terminal response.

</details>

<a id="development"></a>

## 🧑‍💻 Development

Use **Node.js 24** and the existing lockfile:

```sh
npm ci
npm run test:offline
npm run build:pages
npm run verify:pages
npm run verify:ids
```

| Command | Purpose |
| --- | --- |
| `npm start` | Fetch seasonal data, update archives, and prepare current-year defaults |
| `npm run build:pages` | Prepare current-year defaults from saved seasonal files, then build `.pages/` without provider requests |
| `npm run verify:pages` | Check the generated site's catalogs, traversal, originals, and size |
| `npm run test:offline` | Run deterministic tests, including pagination, current-year defaults, and HTTP checks |
| `npm test` | Run all test suites |
| `npm run verify:ids` | Check native IDs, AniList provenance, and movie playback IDs without provider requests |
| `npm run benchmark:ids` | Compare the resolver with commit `b318225` using cached snapshots and controlled HTTP conditions |
| `npm run audit:ids` | Audit every source catalog against current ID cross-references; writes `.cache/id-audit.json` |

To audit or repair catalog identities manually:

```sh
npm run audit:ids
npm run audit:ids -- --repair
npm run build:pages
npm run verify:ids
npm run verify:pages
```

The audit deduplicates checks by AniList identity and validates all files before
applying repairs. Its report distinguishes IDs missing from current cross-references
from confirmed title mismatches; absence alone does not prove an old ID was wrong.
Routine Pages builds use the offline ID check instead of repeating the network audit.

See [resolver benchmarks](docs/mapping-performance.md) for measured improvements,
tradeoffs, and reproduction commands.

To validate another page size in PowerShell:

```powershell
$env:PAGINATION_PAGE_SIZE = '30'
npm run build:pages
npm run verify:pages
Remove-Item Env:PAGINATION_PAGE_SIZE
```

The ignored `.pages/` directory is replaced on each build to remove stale files.
Metadata is serialized once per source entry, exact sizes are checked before
generation, and writes use bounded concurrency. JSON is compact and Actions
caches npm downloads. The published site must stay within GitHub Pages' 1 GB limit.

The workflow commits source updates to `main` with a normal push. Branch rules
must allow that update; a rejected push stops publishing. Pull the latest `main`
before making local changes because scheduled runs may have added data commits.

<a id="troubleshooting"></a>

## 🔎 Troubleshooting

| Symptom | What to check |
| --- | --- |
| Only one page appears | Import `/paginated/manifest.json`, match both page-size settings, and refresh AIOmetadata/client caches |
| Anime Years still requires a filter | Refresh or re-import the manifest and clear the previously selected year |
| A new year is missing | Run the workflow with **Refresh AniList data** enabled and inspect its result |
| An unrelated film appears after an ID repair | Refresh AIOmetadata's catalog cache and your client library; changing only artwork does not fix a stale source ID |
| Titles look unchanged after deployment | Wait for AIOmetadata's catalog cache to expire or refresh it, then refresh the client library |
| The refresh fails | Open the failed run in **Actions**; the previous published catalogs remain available |

Keep API keys, account configurations, and private addon URLs out of this public
repository and workflow logs. `.env` and `.env.*` are ignored by Git.

<a id="credits"></a>

## 🙏 Credits

- [victorgveloso/animes-season-addon](https://github.com/victorgveloso/animes-season-addon) — original generator and historical catalog data.
- [AniList](https://anilist.co/) — anime metadata and seasonal membership.
- [Fribb/anime-lists](https://github.com/Fribb/anime-lists) and [nattadasu/animeApi](https://github.com/nattadasu/animeApi) — verified anime cross-reference data.
- [AIOmetadata](https://github.com/cedya77/aiometadata) — metadata integration.
- [Stremio](https://www.stremio.com/) — the addon manifest and catalog protocol.

The source package declares the ISC license. Provider data remains subject to its
respective terms; this fork is not affiliated with AniList or AIOmetadata.
