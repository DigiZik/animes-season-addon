export class AnilistApiError extends Error {
    constructor(message: string, public readonly status?: number, public readonly errors?: unknown) {
        super(message);
        this.name = "AnilistApiError";
    }
}

export class Anilist {
    async fetch(query: string) {
        const response = await fetch("https://graphql.anilist.co", {
            method: "POST", signal: AbortSignal.timeout(30000),
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ query }),
        });
        let body;
        try { body = await response.json(); }
        catch { throw new AnilistApiError(`AniList returned invalid JSON (HTTP ${response.status}).`, response.status); }
        if (!response.ok || body?.errors?.length) {
            throw new AnilistApiError(`AniList API request failed (${response.status}): ${body?.errors?.[0]?.message || response.statusText}`, response.status, body?.errors);
        }
        return body;
    }
}
