import { Meta, TitleType, validateMeta } from "./native-meta";
import { catalogFiles } from "./catalog-files";

const SERIES_TYPES = new Set(["TV", "TV_SHORT", "OVA", "ONA", "SPECIAL"]);
const has = (value: unknown) => Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null;
const URL = "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";

export function kitsuIndex(rows: any[]): Map<string, string | null> {
    const links = new Map<string, string | null>();
    const owners = new Map<string, string | null>();
    for (const row of rows) {
        const format = String(row?.type || "").toUpperCase().replace(/[ -]/g, "_");
        const type = format === "MOVIE" ? "movie" : SERIES_TYPES.has(format) ? "series" : undefined;
        if (!type || !Number.isSafeInteger(row.anilist_id) || row.anilist_id <= 0) continue;
        if (row.kitsu_id === undefined || row.kitsu_id === null) continue;
        const values = Array.isArray(row.kitsu_id) ? row.kitsu_id : [row.kitsu_id];
        const ids = [...new Set(values.filter((id: unknown) => Number.isSafeInteger(id) && Number(id) > 0))];
        const key = `${type}:${row.anilist_id}`;
        const id = ids.length === 1 && values.length > 0 && values.every((value: unknown) => Number.isSafeInteger(value) && Number(value) > 0) ? `kitsu:${ids[0]}` : null;
        const previous = links.get(key);
        links.set(key, previous === undefined || previous === id ? id : null);
        for (const value of ids) {
            const target = `kitsu:${value}`, owner = owners.get(target);
            owners.set(target, owner === undefined || owner === key ? key : null);
        }
    }
    for (const [key, id] of links) if (id && owners.get(id) === null) links.set(key, null);
    return links;
}

export async function convertCatalogs(root: string, rows: unknown) {
    if (!Array.isArray(rows) || !rows.length) throw new Error("Invalid anime cross-reference dataset.");
    const kitsu = kitsuIndex(rows), imdb = imdbIndex(rows);
    if (![...kitsu.values(), ...imdb.values()].some(Boolean)) throw new Error("Mapping dataset contains no usable links.");
    const files = await catalogFiles(root);
    const report = { inputEntries: 0, kitsu: 0, imdb: 0, omitted: 0, duplicates: 0 };
    const converted = new Map<string, { metas: Meta[] }>();
    for (const file of files) {
        const metas: Meta[] = [], seen = new Set<string>();
        for (const meta of file.data.metas) {
            validateMeta(meta, file.type);
            report.inputEntries++;
            const key = `${meta.type}:${meta.id.slice(8)}`;
            const id = kitsu.get(key) || imdb.get(key);
            if (!id) { report.omitted++; continue; }
            if (seen.has(id)) { report.duplicates++; continue; }
            seen.add(id);
            const item = { ...meta, id };
            validateMeta(item, file.type, "mixed");
            metas.push(item);
            report[id.startsWith("kitsu:") ? "kitsu" : "imdb"]++;
        }
        converted.set(file.relative.replace(/\\/g, "/"), { metas });
    }
    if (report.inputEntries && !report.kitsu && !report.imdb) throw new Error("Mapping conversion produced no titles.");
    return { converted, report };
}
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
        const values = Array.isArray(row.imdb_id) ? row.imdb_id : [row.imdb_id];
        const valid = (value: unknown): value is string => typeof value === "string" && /^tt\d{7,10}$/.test(value);
        const imdbs = [...new Set<string>(values.filter(valid))];
        // Rejected rows still disclose ownership conflicts for other rows.
        for (const imdb of imdbs) {
            const kind = kinds.get(imdb);
            kinds.set(imdb, kind === undefined || kind === type ? type : null);
            if (type === "movie") {
                const owner = movieOwners.get(imdb);
                movieOwners.set(imdb, owner === undefined || owner === id ? id : null);
            }
        }
        const tmdb = row.themoviedb_id;
        const typedConflict = tmdb && typeof tmdb === "object" && has(type === "movie" ? tmdb.tv : tmdb.movie);
        const multipart = type === "movie" && Array.isArray(tmdb?.movie) && tmdb.movie.length > 1;
        const key = `${type}:${id}`;
        if (imdbs.length !== 1 || !values.every(valid) || typedConflict || multipart) {
            links.set(key, null);
            continue;
        }
        const imdb = imdbs[0], previous = links.get(key);
        links.set(key, previous === undefined || previous === imdb ? imdb : null);
    }
    for (const [key, imdb] of links) if (imdb && (kinds.get(imdb) === null || key.startsWith("movie:") && movieOwners.get(imdb) === null)) links.set(key, null);
    return links;
}

export async function downloadMappings(): Promise<unknown> {
    let response!: Response;
    // One retry only for transient request failures; parsing and size errors stay fatal.
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            response = await fetch(URL, { signal: AbortSignal.timeout(30000), redirect: "error" });
        } catch {
            if (attempt) throw new Error("Anime cross-reference network request failed.");
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
        }
        if (response.ok) break;
        await response.body?.cancel();
        const retry = response.headers.get("retry-after");
        const delay = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : 2000;
        const wait = Number.isFinite(delay) ? Math.max(2000, delay) : 2000;
        const retryable = response.status === 429 || response.status >= 500;
        if (attempt || !retryable || wait > 60000) {
            throw new Error(`Anime cross-reference download failed (HTTP ${response.status}).`);
        }
        await new Promise(resolve => setTimeout(resolve, wait));
    }
    const limit = 16 * 1024 * 1024;
    if (Number(response.headers.get("content-length")) > limit || !response.body) {
        await response.body?.cancel();
        throw new Error("Invalid or oversized Anime mapping dataset.");
    }
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.body as any) {
        bytes += chunk.length;
        if (bytes > limit) throw new Error("Anime mapping dataset exceeds 16 MiB.");
        chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
}

