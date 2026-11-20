# Anime Seasons: paginated catalogs

This fork preserves the original Anime Seasons and Anime Years catalogs and adds
a separately installed, paginated version for AIOmetadata. Both movies and series,
every advertised season, and every archived year are included.

## Enable publishing

1. Push these changes to this fork's `main` branch.
2. In **Settings → Pages → Build and deployment**, choose **GitHub Actions** as
   the source. In a new fork, enable Actions if GitHub has disabled them.
3. Optionally create a repository variable under **Settings → Secrets and
   variables → Actions → Variables** named `PAGINATION_PAGE_SIZE`. Its default is
   `20`; use a positive integer, such as `20`, `30`, or `50`.
4. Set it to the same value as `CATALOG_LIST_ITEMS_SIZE` in your AIOmetadata
   environment. Changing that AIOmetadata setting requires recreating its
   container, then rebuilding these Pages files with the matching value.
5. Run **Actions → Update catalogs and publish Pages → Run workflow**. Leave
   **Refresh AniList data** unchecked to rebuild immediately from existing data.

The workflow also publishes changes pushed to `main`. Its daily schedule refreshes
the source data from AniList before publishing. A manual run can optionally
refresh data too. A repository variable change alone does not trigger a workflow;
run the workflow after changing the variable.

Scheduled workflows run from the default branch; keep `main` as the default.
The update job needs permission to commit `manifest.json` and `catalog/` to `main`.
If branch rules prevent that normal push, the workflow fails rather than force
pushing. The last successful Pages deployment remains available when a run fails.

## Import into AIOmetadata

Once deployment succeeds, import this **Custom Manifest** URL:

<https://digizik.github.io/animes-season-addon/paginated/manifest.json>

The original manifest remains at
<https://digizik.github.io/animes-season-addon/manifest.json>, and the complete
original catalog JSON files remain at their existing URLs. The paginated addon
uses a distinct identity, `com.digizik.animes-season-addon.paginated`, so you can
test it alongside the old one.

In AIOmetadata, enable the imported paginated catalogs. Refresh the AIOStreams
Jellyfin library/catalog view and check **Anime Years (Series) → 2025** loads
beyond the first page before disabling the original catalog. The current source
has 200 entries and 195 unique `(type, id)` titles. AIOmetadata's mapping, filters,
and client caching may affect the final displayed count; verify the full client
path separately from the static files. No additional Docker service is needed.

## Pagination behavior

Page size is configurable at **build time**, not detected from AIOmetadata.
AIOmetadata requests `skip` and `genre` but does not send a requested limit.
Keep its `CATALOG_LIST_ITEMS_SIZE` and this repository's `PAGINATION_PAGE_SIZE`
matched, then rerun publishing whenever you change the size.

For a catalog with `N` unique entries and page size `P`, the builder publishes:

- Its normal first-page URL and an explicit `skip=0` URL.
- Every integer offset from `0` through `N + P`, including nonmultiples of `P`.
- Both `skip=20&genre=2025.json` and `genre=2025&skip=20.json` parameter orders.
- `{"metas":[]}` for generated offsets at or beyond the end.

All source metadata is retained. Duplicate `(type, id)` entries are removed
before pagination, keeping the first occurrence and the original ordering.
Required year filters stay required; the default Anime Seasons catalog continues
to use the source generator's current-season selection.

This is a static GitHub Pages site. Unsupported filters and offsets beyond
`N + P` can return 404. Normal sequential traversal at the configured page size
has a valid terminal response. No runtime server or private-host allowlist change
is required.

## Local development and validation

Use Node.js 24 and the existing lockfile:

```sh
npm ci
npm run test:offline
npm run build:pages
npm run verify:pages
```

To build and verify another size in PowerShell:

```powershell
$env:PAGINATION_PAGE_SIZE = '30'
npm run build:pages
npm run verify:pages
Remove-Item Env:PAGINATION_PAGE_SIZE
```

`npm run build:pages` reads the existing catalog files without contacting AniList.
`npm start` retains its separate purpose of refreshing source data from AniList.
`npm test` includes the original tests that depend on external services;
`test:offline` runs the deterministic suites, including pagination and HTTP tests.

The ignored `.pages/` directory contains the entire publishable site. Every build
replaces it to remove stale pages. Manifest validation, source validation, and an
exact size preflight happen before replacing the previous local output. The
generated site must stay within GitHub Pages' 1 GB limit.

For lower build overhead, each title is serialized once, prefix byte counts
calculate the exact output size without rendering all pages twice, and file
writes use bounded concurrency. Equivalent parameter-order aliases share the
same rendered payload during generation. JSON is compact, npm downloads are
cached in Actions, and manual publishing skips the costly AniList refresh by
default. Generated pages are uploaded as an artifact rather than committed,
avoiding daily growth in Git history. Separate static alias files still consume
disk space because GitHub Pages cannot route requests dynamically.
