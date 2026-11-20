import { promises as fs } from "fs";
import path from "path";

export type MappingSource = "anilist" | "myanimelist" | "kitsu" | "imdb" | "themoviedb";
export type AnimeMapping = { anilistId: number; kitsu: Set<number>; imdb: Set<string> };
const FRIBB_URL = "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";
const ANIME_API_URL = "https://raw.githubusercontent.com/nattadasu/animeApi/v3/database/animeapi.tsv";
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;

export function positiveId(value: unknown): number | undefined {
    if (typeof value !== "number" && typeof value !== "string") return undefined;
    if (!/^[1-9]\d*$/.test(String(value))) return undefined;
    const id = Number(value);
    return Number.isSafeInteger(id) ? id : undefined;
}

export class AnimeMappings {
    private readonly byAnilist = new Map<number, AnimeMapping>();
    // Most aliases have one owner. null marks ambiguity without allocating a Set
    // for every identifier or retaining all franchise members a caller cannot use.
    private readonly aliases = new Map<string, AnimeMapping | null>();

    private alias(source: MappingSource, value: unknown, mapping: AnimeMapping) {
        const id = source === "imdb" ? (/^tt\d{7,10}$/.test(String(value)) ? String(value) : undefined) : positiveId(value);
        if (id === undefined) return;
        const key = `${source}:${id}`;
        const previous = this.aliases.get(key);
        if (previous === undefined) this.aliases.set(key, mapping);
        else if (previous !== mapping) this.aliases.set(key, null);
    }

    private add(row: any, fields: { anilist: string; kitsu: string; imdb: string; mal: string; tmdb: string }) {
        const id = positiveId(row?.[fields.anilist]);
        if (!id) return;
        let mapping = this.byAnilist.get(id);
        if (!mapping) {
            mapping = { anilistId: id, kitsu: new Set(), imdb: new Set() };
            this.byAnilist.set(id, mapping);
        }
        const kitsu = positiveId(row[fields.kitsu]);
        if (kitsu) { mapping.kitsu.add(kitsu); this.alias("kitsu", kitsu, mapping); }
        for (const imdb of Array.isArray(row[fields.imdb]) ? row[fields.imdb] : [row[fields.imdb]]) {
            if (/^tt\d{7,10}$/.test(String(imdb))) {
                mapping.imdb.add(imdb);
                this.alias("imdb", imdb, mapping);
            }
        }
        this.alias("myanimelist", row[fields.mal], mapping);
        const tmdb = row[fields.tmdb];
        if (tmdb && typeof tmdb === "object") {
            this.alias("themoviedb", tmdb.movie, mapping);
            this.alias("themoviedb", tmdb.tv, mapping);
        } else this.alias("themoviedb", tmdb, mapping);
    }

    constructor(fribb: unknown, animeApi: string) {
        if (!Array.isArray(fribb) || !fribb.length) throw new Error("Invalid Fribb mapping dataset.");
        for (const row of fribb) this.add(row, { anilist: "anilist_id", kitsu: "kitsu_id", imdb: "imdb_id", mal: "mal_id", tmdb: "themoviedb_id" });
        const lines = animeApi.replace(/^\uFEFF/, "").split(/\r?\n/);
        const header = lines.shift()?.split("\t") || [];
        if (!["anilist", "kitsu", "imdb"].every(name => header.includes(name)) || !lines.length) {
            throw new Error("Invalid animeApi mapping dataset.");
        }
        // Only retain the fields used by the resolver, not provider descriptions/URLs.
        const wanted = ["anilist", "kitsu", "imdb", "myanimelist", "themoviedb"];
        const columns = wanted.map(name => header.indexOf(name));
        for (const line of lines) {
            const cells = line.split("\t");
            // A quoted tab/newline or truncated row must never shift an ID column.
            // Names are unused, so safely skip malformed rows instead of guessing.
            if (cells.length !== header.length) continue;
            const row = Object.fromEntries(wanted.map((name, index) => [name, columns[index] < 0 ? undefined : cells[columns[index]]]));
            this.add(row, { anilist: "anilist", kitsu: "kitsu", imdb: "imdb", mal: "myanimelist", tmdb: "themoviedb" });
        }
        if (!this.byAnilist.size) throw new Error("Anime mapping datasets contain no valid AniList identities.");
    }

    get(anilistId: number): AnimeMapping | undefined { return this.byAnilist.get(anilistId); }

    lookup(source: MappingSource, id: string): AnimeMapping | undefined {
        const normalized = source === "imdb" ? (/^tt\d{7,10}$/.test(id) ? id : undefined) : positiveId(id);
        if (normalized === undefined) return undefined;
        if (source === "anilist") return this.byAnilist.get(Number(normalized));
        // A franchise IMDb/TMDB ID may name several anime seasons. Never pick one arbitrarily.
        return this.aliases.get(`${source}:${normalized}`) ?? undefined;
    }

    preferredId(anilistId: number): string {
        if (!positiveId(anilistId)) throw new Error("Invalid AniList identity.");
        const kitsu = this.kitsuId(anilistId);
        return kitsu ? `kitsu:${kitsu}` : `anilist:${anilistId}`;
    }

    kitsuId(anilistId: number): number | undefined {
        const mapping = this.get(anilistId);
        const id = mapping?.kitsu.size === 1 ? mapping.kitsu.values().next().value : undefined;
        // A provider may combine several AniList seasons/editions under one ID.
        // Keep their original AniList identities instead of merging distinct titles.
        return id && this.aliases.get(`kitsu:${id}`) === mapping ? id : undefined;
    }

    verifies(anilistId: number, id: string): boolean {
        if (id === `anilist:${anilistId}`) return true;
        const mapping = this.get(anilistId);
        if (id.startsWith("kitsu:")) return mapping?.kitsu.has(Number(id.slice(6))) || false;
        return mapping?.imdb.has(id) || false;
    }
}

async function download(url: string): Promise<string> {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: "error" });
    if (!response.ok) throw new Error(`Anime mapping download failed: HTTP ${response.status}`);
    if (Number(response.headers.get("content-length")) > MAX_SOURCE_BYTES) throw new Error("Anime mapping dataset is too large.");
    if (!response.body) throw new Error("Empty anime mapping response.");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of response.body as any) {
        bytes += chunk.length;
        if (bytes > MAX_SOURCE_BYTES) throw new Error("Anime mapping dataset is too large.");
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
}

let loading: Promise<AnimeMappings> | undefined;
export function loadAnimeMappings(): Promise<AnimeMappings> {
    // One pair of bulk downloads per generator process, shared by all title lookups.
    if (!loading) {
        loading = Promise.all([download(FRIBB_URL), download(ANIME_API_URL)])
            .then(([fribb, animeApi]) => new AnimeMappings(JSON.parse(fribb), animeApi))
            .catch(error => { loading = undefined; throw error; });
    }
    return loading;
}

export async function readMappingSnapshots(directory: string): Promise<AnimeMappings> {
    const [fribb, animeApi] = await Promise.all([
        fs.readFile(path.join(directory, "fribb.json"), "utf8"),
        fs.readFile(path.join(directory, "animeapi.tsv"), "utf8")
    ]);
    return new AnimeMappings(JSON.parse(fribb), animeApi);
}
