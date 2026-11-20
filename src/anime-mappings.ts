import { promises as fs } from "fs";
import path from "path";
import { CacheOptions, SourceReport, MappingSourceError, cacheMaxAge, loadMappingSource } from "./mapping-cache";

export type MappingSource = "anilist" | "myanimelist" | "kitsu" | "imdb" | "themoviedb";
export type DatasetSource = "fribb" | "animeApi" | "both";
type Link = "kitsu" | "imdb" | "myanimelist" | "anidb" | "simkl" | "themoviedb";
export type AnimeMapping = {
    anilistId: number; kitsu: Set<number>; imdb: Set<string>;
    mal?: number; anidb?: number; simkl?: number; conflicted?: boolean;
    provenance: Partial<Record<Link, DatasetSource>>;
};
const FRIBB_URL = "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";
const ANIME_API_URL = "https://raw.githubusercontent.com/nattadasu/animeApi/v3/database/animeapi.tsv";
const imdbId = (value: unknown) => typeof value === "string" && /^tt\d{7,10}$/.test(value) ? value : undefined;
export function positiveId(value: unknown): number | undefined {
    if (typeof value !== "number" && typeof value !== "string") return undefined;
    if (!/^[1-9]\d*$/.test(String(value))) return undefined;
    const id = Number(value);
    return Number.isSafeInteger(id) ? id : undefined;
}
type Row = { anilist?: number; kitsu?: number; mal?: number; anidb?: number; simkl?: number; imdb?: unknown; tmdb?: unknown; tmdbType?: string };
type Columns = { anilist: number; kitsu: number; imdb: number; mal: number; anidb: number; simkl: number; tmdb: number; tmdbType: number };
function tsvColumns(text: string): { columns: Columns; start: number; count: number } {
    const end = text.indexOf("\n");
    const header = text.slice(0, end < 0 ? text.length : end).replace(/^\uFEFF/, "").trimEnd().split("\t");
    if (end < 0 || !["anilist", "kitsu", "imdb"].every(name => header.includes(name))) throw new Error("Invalid animeApi mapping dataset.");
    return { columns: { anilist: header.indexOf("anilist"), kitsu: header.indexOf("kitsu"), imdb: header.indexOf("imdb"), mal: header.indexOf("myanimelist"),
        anidb: header.indexOf("anidb"), simkl: header.indexOf("simkl"), tmdb: header.indexOf("themoviedb"), tmdbType: header.indexOf("themoviedb_type") }, start: end + 1, count: header.length };
}
const cell = (value: string | undefined) => value?.startsWith('"') && value.endsWith('"') ? value.slice(1, -1).replace(/""/g, '"') : value;

export class AnimeMappings {
    private readonly byAnilist = new Map<number, AnimeMapping>();
    private readonly aliases = new Map<string, AnimeMapping | null>();
    // Needed only while merging; discard ownership indexes unused by runtime lookups.
    private readonly nativeOwners = new Map<string, AnimeMapping | null>();
    private readonly used = new Map<number, string>();
    readonly stats = { fribbRows: 0, animeApiRows: 0, invalidRows: 0, conflicts: 0, contestedLinks: 0, enrichmentConflicts: 0 };
    sourceReports: SourceReport[] = [];

    private alias(source: MappingSource, id: number | string | undefined, mapping: AnimeMapping, type?: string) {
        if (id === undefined) return;
        // Movie and TV numbers are different namespaces. Untyped TMDB links are not aliases.
        if (source === "themoviedb" && type !== "movie" && type !== "tv") return;
        const key = source === "themoviedb" ? `${source}:${type}:${id}` : `${source}:${id}`;
        const previous = this.aliases.get(key);
        if (previous === undefined) this.aliases.set(key, mapping);
        else if (previous !== mapping) this.aliases.set(key, null);
    }

    private add(row: Row, source: "fribb" | "animeApi") {
        if (!row.anilist) return;
        this.stats[source === "fribb" ? "fribbRows" : "animeApiRows"]++;
        let mapping = this.byAnilist.get(row.anilist);
        if (!mapping) {
            mapping = { anilistId: row.anilist, kitsu: new Set(), imdb: new Set(), provenance: {} };
            this.byAnilist.set(row.anilist, mapping);
        }
        const conflict = (row.kitsu && mapping.kitsu.size && !mapping.kitsu.has(row.kitsu)) ||
            (row.mal && mapping.mal && row.mal !== mapping.mal) || (row.anidb && mapping.anidb && row.anidb !== mapping.anidb) ||
            (row.simkl && mapping.simkl && row.simkl !== mapping.simkl);
        if (conflict) {
            mapping.conflicted = true;
            this.stats.conflicts++;
            return; // Keep provenance and existing links, but export the original AniList identity.
        }
        // An overlay may fill a gap only when its native IDs are not owned by another anime.
        if (source === "animeApi") {
            for (const [provider, id] of [["kitsu", row.kitsu], ["myanimelist", row.mal], ["anidb", row.anidb], ["simkl", row.simkl]] as const) {
                const owner = id ? (provider === "anidb" || provider === "simkl" ? this.nativeOwners : this.aliases).get(`${provider}:${id}`) : undefined;
                if (owner !== undefined && owner !== mapping) {
                    this.stats.contestedLinks++;
                    mapping.conflicted = true;
                    return;
                }
            }
        }
        const provenance = (field: Link) => {
            const previous = mapping!.provenance[field];
            mapping!.provenance[field] = previous && previous !== source ? "both" : source;
        };
        if (row.kitsu) { mapping.kitsu.add(row.kitsu); provenance("kitsu"); this.alias("kitsu", row.kitsu, mapping); }
        if (row.mal) { mapping.mal = row.mal; provenance("myanimelist"); this.alias("myanimelist", row.mal, mapping); }
        if (row.anidb) { mapping.anidb = row.anidb; provenance("anidb"); }
        if (row.simkl) { mapping.simkl = row.simkl; provenance("simkl"); }
        for (const [provider, id] of [["anidb", row.anidb], ["simkl", row.simkl]] as const) {
            if (!id) continue;
            const key = `${provider}:${id}`, previous = this.nativeOwners.get(key);
            if (previous === undefined) this.nativeOwners.set(key, mapping);
            else if (previous !== mapping) this.nativeOwners.set(key, null);
        }
        // IMDb/TMDB are enrichment links, not proof that two anime seasons are the same title.
        const imdbs = (Array.isArray(row.imdb) ? row.imdb : [row.imdb]).map(imdbId).filter((id): id is string => !!id);
        if (source === "fribb" || !mapping.imdb.size || imdbs.some(id => mapping!.imdb.has(id))) {
            for (const id of imdbs) { mapping.imdb.add(id); this.alias("imdb", id, mapping); provenance("imdb"); }
        } else if (imdbs.length) this.stats.enrichmentConflicts++;
        if (row.tmdb && typeof row.tmdb === "object" && !Array.isArray(row.tmdb)) {
            for (const type of ["movie", "tv"] as const) {
                for (const raw of Array.isArray((row.tmdb as any)[type]) ? (row.tmdb as any)[type] : [(row.tmdb as any)[type]]) {
                    const id = positiveId(raw);
                    if (id) { this.alias("themoviedb", id, mapping, type); provenance("themoviedb"); }
                }
            }
        } else if (positiveId(row.tmdb) && (row.tmdbType === "movie" || row.tmdbType === "tv")) {
            this.alias("themoviedb", positiveId(row.tmdb), mapping, row.tmdbType); provenance("themoviedb");
        }
    }

    constructor(fribb: unknown, animeApi?: string) {
        if (!Array.isArray(fribb) || !fribb.some(row => positiveId(row?.anilist_id))) throw new Error("Invalid Fribb mapping dataset.");
        for (const row of fribb) this.add({ anilist: positiveId(row?.anilist_id), kitsu: positiveId(row?.kitsu_id), mal: positiveId(row?.mal_id),
            anidb: positiveId(row?.anidb_id), simkl: positiveId(row?.simkl_id), imdb: row?.imdb_id, tmdb: row?.themoviedb_id }, "fribb");
        if (animeApi !== undefined) {
            const { columns: c, start, count } = tsvColumns(animeApi);
            let position = start;
            while (position < animeApi.length) {
                const newline = animeApi.indexOf("\n", position);
                const end = newline < 0 ? animeApi.length : newline;
                const line = animeApi.slice(position, animeApi.charCodeAt(end - 1) === 13 ? end - 1 : end);
                position = end + 1;
                if (!line) continue;
                const values = line.split("\t");
                if (values.length !== count) { this.stats.invalidRows++; continue; }
                this.add({ anilist: positiveId(cell(values[c.anilist])), kitsu: positiveId(cell(values[c.kitsu])), mal: positiveId(cell(values[c.mal])),
                    anidb: positiveId(cell(values[c.anidb])), simkl: positiveId(cell(values[c.simkl])), imdb: cell(values[c.imdb]),
                    tmdb: cell(values[c.tmdb]), tmdbType: cell(values[c.tmdbType]) }, "animeApi");
            }
        }
        this.nativeOwners.clear();
    }
    get(anilistId: number): AnimeMapping | undefined { return this.byAnilist.get(anilistId); }
    lookup(source: MappingSource, id: string, type?: "movie" | "series"): AnimeMapping | undefined {
        const normalized = source === "imdb" ? imdbId(id) : positiveId(id);
        if (normalized === undefined) return undefined;
        const mapping = source === "anilist" ? this.byAnilist.get(Number(normalized)) :
            this.aliases.get(source === "themoviedb" ? `${source}:${type === "series" ? "tv" : type}:${normalized}` : `${source}:${normalized}`);
        return mapping && !mapping.conflicted ? mapping : undefined;
    }
    preferredId(anilistId: number): string {
        const previous = this.used.get(anilistId);
        if (previous) return previous;
        if (!positiveId(anilistId)) throw new Error("Invalid AniList identity.");
        const kitsu = this.kitsuId(anilistId);
        const preferred = kitsu ? `kitsu:${kitsu}` : `anilist:${anilistId}`;
        this.used.set(anilistId, preferred);
        return preferred;
    }
    kitsuId(anilistId: number): number | undefined {
        const mapping = this.get(anilistId);
        if (mapping?.conflicted || mapping?.kitsu.size !== 1) return undefined;
        const id = mapping.kitsu.values().next().value;
        return id && this.aliases.get(`kitsu:${id}`) === mapping ? id : undefined;
    }
    verifies(anilistId: number, id: string): boolean {
        if (id === `anilist:${anilistId}`) return true;
        const mapping = this.get(anilistId);
        if (!mapping || mapping.conflicted) return false;
        if (id.startsWith("kitsu:")) return this.kitsuId(anilistId) === positiveId(id.slice(6));
        return mapping.imdb.has(id);
    }
    report() {
        let kitsu = 0, anilist = 0;
        for (const id of this.used.values()) id.startsWith("kitsu:") ? kitsu++ : anilist++;
        return { ...this.stats, status: this.sourceReports.some(source => source.status === "fallback" || source.status === "unavailable") ? "degraded" : "validated",
            identities: this.byAnilist.size, resolvedUnique: this.used.size, kitsu, anilist, sources: this.sourceReports };
    }
}

function validateFribb(text: string): unknown {
    const rows = JSON.parse(text);
    if (!Array.isArray(rows) || !rows.some(row => positiveId(row?.anilist_id))) throw new Error("Invalid Fribb mapping dataset.");
    return rows;
}
function validateAnimeApi(text: string): string {
    const { columns, start, count } = tsvColumns(text);
    // Check at least one usable identity before replacing a last-good snapshot.
    let position = start;
    while (position < text.length) {
        const end = text.indexOf("\n", position);
        const row = text.slice(position, end < 0 ? text.length : end).replace(/\r$/, "").split("\t");
        if (row.length === count && positiveId(cell(row[columns.anilist]))) return text;
        position = end < 0 ? text.length : end + 1;
    }
    throw new Error("animeApi mapping dataset has no valid identities.");
}

export async function loadMappingIndex(options: CacheOptions): Promise<AnimeMappings> {
    const results = await Promise.allSettled([
        loadMappingSource({ name: "fribb", url: FRIBB_URL, validate: validateFribb }, options),
        loadMappingSource({ name: "animeApi", url: ANIME_API_URL, validate: validateAnimeApi }, options),
    ]);
    const reports = results.map((result, i) => result.status === "fulfilled" ? result.value.report :
        result.reason instanceof MappingSourceError ? result.reason.report : { source: i ? "animeApi" : "fribb", status: "unavailable" as const, attempts: 0, bytes: 0, ageHours: null, reason: String(result.reason?.message || result.reason) });
    if (results[0].status === "rejected") {
        throw Object.assign(new Error(`Fribb mappings unavailable (${reports[0].reason}); previous published catalogs are preserved.`), { sourceReports: reports });
    }
    const mapping = new AnimeMappings(results[0].value.data, results[1].status === "fulfilled" ? results[1].value.data as string : undefined);
    mapping.sourceReports = reports;
    return mapping;
}
let loading: Promise<AnimeMappings> | undefined;
let failedSources: SourceReport[] | undefined;
export function loadAnimeMappings(): Promise<AnimeMappings> {
    if (!loading) {
        const maxAgeDays = cacheMaxAge();
        loading = loadMappingIndex({ directory: process.env.ANIME_MAPPING_CACHE_DIR || path.join(process.cwd(), ".cache", "mappings"), maxAgeDays })
            .then(index => { failedSources = undefined; return index; })
            .catch(error => { failedSources = error.sourceReports; loading = undefined; throw error; });
    }
    return loading;
}
export async function writeMappingReport(mapping?: AnimeMappings) {
    const index = mapping || (loading ? await loading : undefined);
    if (!index && !failedSources) return;
    const report = index ? index.report() : { status: "failed", resolvedUnique: 0, kitsu: 0, anilist: 0, conflicts: 0, contestedLinks: 0, sources: failedSources! };
    const directory = path.join(process.cwd(), ".cache");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "mapping-report.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(`[Anime mappings] ${JSON.stringify(report)}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
        const sources = report.sources.map(source => `| ${source.source} | ${source.status} | ${source.attempts} | ${source.bytes} | ${source.ageHours ?? "unavailable"} |`).join("\n");
        await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `\n### Anime mapping build report\n\n${report.resolvedUnique} unique anime resolved: ${report.kitsu} Kitsu, ${report.anilist} original AniList IDs. ${report.conflicts} conflicting rows and ${report.contestedLinks} contested overlay rows rejected.\n\n| Source | Status | Attempts | Downloaded bytes | Cache age (hours) |\n| --- | --- | --- | --- | --- |\n${sources}\n`);
    }
    return report;
}
export async function readMappingSnapshots(directory: string): Promise<AnimeMappings> {
    const [fribb, animeApi] = await Promise.all([fs.readFile(path.join(directory, "fribb.json"), "utf8"), fs.readFile(path.join(directory, "animeapi.tsv"), "utf8")]);
    return new AnimeMappings(validateFribb(fribb), validateAnimeApi(animeApi));
}
