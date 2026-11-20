import { AnimeMapping, loadAnimeMappings, MappingSource, positiveId } from "./anime-mappings";

export type TitleType = "movie" | "series";

export class AnilistApiError extends Error {
    constructor(message: string, public readonly status?: number, public readonly errors?: any) {
        super(message);
        this.name = "AnilistApiError";
    }
}
export class Anilist {
    url = "https://graphql.anilist.co";
    method = "POST";
    headers = { "Content-Type": "application/json", "Accept": "application/json" };
    async fetch(query: string) {
        const response = await fetch(this.url, { method: this.method, headers: this.headers, body: JSON.stringify({ query }) });
        const body = await response.json();
        if (!response.ok || body?.errors) {
            const message = body?.errors?.[0]?.message ?? response.statusText;
            throw new AnilistApiError(`Anilist API request failed (${response.status}): ${message}`, response.status, body?.errors);
        }
        return body;
    }
}
export enum IdSource { KITSU, IMDB, TMDB, MAL, ANILIST }
const SOURCES: MappingSource[] = ["kitsu", "imdb", "themoviedb", "myanimelist", "anilist"];

export class IdResolver {
    private mapping?: Promise<AnimeMapping | undefined>;
    constructor(
        private readonly source: IdSource,
        private readonly id: string,
        // Kept for callers of the old constructor. Names are never identity evidence.
        _name?: string, _year?: number, _type?: TitleType, _preprocessName?: (name: string) => string
    ) {}

    private async resolveMapping(): Promise<AnimeMapping | undefined> {
        const source = SOURCES[this.source];
        if (!source || (source === "imdb" ? !/^tt\d{7,10}$/.test(this.id) : !positiveId(this.id))) return undefined;
        if (!this.mapping) {
            this.mapping = loadAnimeMappings().then(index => index.lookup(source, String(this.id)))
                .catch(error => { this.mapping = undefined; throw error; });
        }
        return this.mapping;
    }

    async resolveImdb(): Promise<string | undefined> {
        const mapping = await this.resolveMapping();
        return mapping?.imdb.size === 1 ? mapping.imdb.values().next().value : undefined;
    }

    async resolveKitsu(): Promise<string | undefined> {
        const mapping = await this.resolveMapping();
        const id = mapping ? (await loadAnimeMappings()).kitsuId(mapping.anilistId) : undefined;
        return id ? `kitsu:${id}` : undefined;
    }

    async resolveAnimeId(): Promise<string | undefined> {
        // Stable anime IDs avoid enriching a film into a documentary/stand-up special.
        // If no unambiguous Kitsu link exists, retain the authoritative AniList ID.
        if (this.source === IdSource.ANILIST) {
            const id = positiveId(this.id);
            if (!id) throw new Error("Invalid source AniList ID.");
            return (await loadAnimeMappings()).preferredId(id);
        }
        const mapping = await this.resolveMapping();
        return mapping ? (await loadAnimeMappings()).preferredId(mapping.anilistId) : undefined;
    }
}
