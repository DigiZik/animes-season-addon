import { promises as fs } from "fs";
import path from "path";
import { catalogFiles } from "./catalog-files";
import { Meta, TitleType, validateMeta } from "./native-meta";

const SERIES_TYPES = new Set(["TV", "TV_SHORT", "OVA", "ONA", "SPECIAL"]);
const has = (value: unknown) => Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null;
const URL = "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";
export const CINEMETA_ID = "com.digizik.animes-season-addon.cinemeta";
export const CINEMETA_PAGINATED_ID = `${CINEMETA_ID}.paginated`;

// Only the separate IMDb export uses this index: no title matching, dataset
// merging, per-title requests, persisted mapping files, or cache state.
export function imdbIndex(rows: unknown): Map<string, string | null> {
    if (!Array.isArray(rows) || !rows.length) throw new Error("Invalid IMDb cross-reference dataset.");
    const links = new Map<string, string | null>();
    const kinds = new Map<string, TitleType | null>();
    const movieOwners = new Map<string, number | null>();
    for (const row of rows) {
        const id = row?.anilist_id;
        if (!Number.isSafeInteger(id) || id <= 0 || !row.imdb_id) continue;
        const format = String(row.type || "").toUpperCase().replace(/[ -]/g, "_");
        const type = format === "MOVIE" ? "movie" : SERIES_TYPES.has(format) ? "series" : undefined;
        if (!type) continue;
        const imdbs = [...new Set<string>((Array.isArray(row.imdb_id) ? row.imdb_id : [row.imdb_id]).filter((value: unknown) => typeof value === "string" && /^tt\d{7,10}$/.test(value)))];
        const tmdb = row.themoviedb_id;
        const typedConflict = tmdb && typeof tmdb === "object" && has(type === "movie" ? tmdb.tv : tmdb.movie);
        const multipart = type === "movie" && Array.isArray(tmdb?.movie) && tmdb.movie.length > 1;
        const key = `${type}:${id}`;
        if (imdbs.length !== 1 || typedConflict || multipart) {
            if (imdbs.length) links.set(key, null);
            continue;
        }
        const imdb = imdbs[0], previous = links.get(key);
        links.set(key, previous === undefined || previous === imdb ? imdb : null);
        const kind = kinds.get(imdb);
        kinds.set(imdb, kind === undefined || kind === type ? type : null);
        if (type === "movie") {
            const owner = movieOwners.get(imdb);
            movieOwners.set(imdb, owner === undefined || owner === id ? id : null);
        }
    }
    for (const [key, imdb] of links) if (imdb && (kinds.get(imdb) === null || key.startsWith("movie:") && movieOwners.get(imdb) === null)) links.set(key, null);
    if (![...links.values()].some(Boolean)) throw new Error("IMDb dataset contains no usable anime links.");
    return links;
}

async function download(): Promise<unknown> {
    const response = await fetch(URL, { signal: AbortSignal.timeout(30000), redirect: "error" });
    if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Cinemeta cross-reference download failed (HTTP ${response.status}).`);
    }
    const limit = 16 * 1024 * 1024;
    if (Number(response.headers.get("content-length")) > limit || !response.body) {
        await response.body?.cancel();
        throw new Error("Invalid or oversized IMDb dataset.");
    }
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.body as any) {
        bytes += chunk.length;
        if (bytes > limit) throw new Error("IMDb dataset exceeds 16 MiB.");
        chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
}

export async function exportCinemeta(root = process.cwd(), rows?: unknown) {
    const files = await catalogFiles(root);
    for (const file of files) for (const meta of file.data.metas) validateMeta(meta, file.type);
    const index = imdbIndex(rows ?? await download());
    let inputEntries = 0, exportedEntries = 0;
    const prepared: { relative: string; body: string }[] = [];
    for (const file of files) {
        const metas: Meta[] = [], seen = new Set<string>();
        for (const meta of file.data.metas) {
            inputEntries++;
            const id = index.get(`${meta.type}:${meta.id.slice(8)}`);
            if (!id || seen.has(id)) continue;
            seen.add(id);
            metas.push({ ...meta, id });
            exportedEntries++;
        }
        prepared.push({ relative: file.relative, body: JSON.stringify({ metas }) + "\n" });
    }
    if (inputEntries && !exportedEntries) throw new Error("IMDb conversion produced no titles; keeping previous Cinemeta catalogs.");
    const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
    manifest.id = CINEMETA_ID;
    manifest.name += " (Cinemeta)";
    manifest.idPrefixes = ["tt"];
    for (const catalog of manifest.catalogs) catalog.name += " (IMDb)";
    prepared.push({ relative: "manifest.json", body: JSON.stringify(manifest, null, 2) + "\n" });
    // Provider parsing and all conversions finish before source writes.
    let oldFiles: Awaited<ReturnType<typeof catalogFiles>> = [];
    try { oldFiles = await catalogFiles(path.join(root, "cinemeta")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    for (const file of prepared) {
        const destination = path.join(root, "cinemeta", file.relative);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        let previous: string | undefined;
        try { previous = await fs.readFile(destination, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if (previous !== file.body) await fs.writeFile(destination, file.body);
    }
    const current = new Set(files.map(file => file.relative));
    for (const file of oldFiles) if (!current.has(file.relative)) await fs.unlink(path.join(root, "cinemeta", file.relative));
    const report = { files: files.length, inputEntries, exportedEntries, omittedOrDeduplicated: inputEntries - exportedEntries };
    console.log(`Cinemeta export: ${JSON.stringify(report)}`);
    if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `\n### Catalog exports\n\nNative AniList: ${inputEntries} entries. Cinemeta: ${exportedEntries} entries; ${inputEntries - exportedEntries} unmapped, ambiguous, or duplicate entries omitted. One bulk IMDb cross-reference request; no mapping cache.\n`);
    return report;
}

if (require.main === module) exportCinemeta().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
