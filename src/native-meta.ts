export type TitleType = "movie" | "series";
export type Meta = { id: string; type: TitleType; name: string; poster?: string; releaseInfo?: string };

const PREVIEW_FIELDS = new Set(["id", "type", "name", "poster", "releaseInfo"]);

export function anilistId(value: unknown): string {
    if (typeof value !== "number" && typeof value !== "string" || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error("Invalid source AniList ID.");
    return `anilist:${value}`;
}
function image(value: unknown): string | undefined {
    if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return undefined;
    try { const url = new URL(value); return url.hostname && !url.username && !url.password ? value : undefined; }
    catch { return undefined; }
}
// Source identity plus compact card data. Downstream providers supply full metadata.
export function fallbackMeta(anime: any, type: TitleType, fallbackYear?: number): Meta {
    const id = anilistId(anime?.id);
    if (type !== "movie" && type !== "series") throw new Error("Invalid catalog type.");
    const name = [anime.title?.english, anime.title?.romaji].find(value => typeof value === "string" && value.trim())?.trim() || `Anime ${anime.id}`;
    const poster = image(anime.coverImage?.large);
    const year = anime.startDate?.year ?? fallbackYear;
    return { id, type, name, ...(poster ? { poster } : {}), ...(Number.isInteger(year) && year >= 1000 && year <= 9999 ? { releaseInfo: String(year) } : {}) };
}
export function validateMeta(value: unknown, type?: string, kind: "anilist" | "imdb" = "anilist"): asserts value is Meta {
    const meta = value as Meta;
    if (!meta || typeof meta.id !== "string" || (kind === "anilist" ? !/^anilist:[1-9]\d*$/.test(meta.id) || anilistId(meta.id.slice(8)) !== meta.id : !/^tt\d{7,10}$/.test(meta.id))) throw new Error(`Invalid ${kind} identity.`);
    if ((meta.type !== "movie" && meta.type !== "series") || type && meta.type !== type) throw new Error("Catalog type differs from item type.");
    if (typeof meta.name !== "string" || !meta.name.trim()) throw new Error("Missing fallback title.");
    if (meta.poster !== undefined && !image(meta.poster)) throw new Error("Invalid fallback poster.");
    if (Object.keys(meta).some(key => !PREVIEW_FIELDS.has(key))) throw new Error("Unexpected full-metadata field in catalog preview.");
}
