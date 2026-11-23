export class AnilistApiError extends Error {
    constructor(message: string, public readonly status?: number, public readonly errors?: unknown) { super(message); this.name = "AnilistApiError"; }
}
let queue: Promise<unknown> = Promise.resolve();
let nextRequest = 0;
const wait = (ms: number) => ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
export class Anilist {
    fetch(query: string): Promise<any> {
        const task = queue.then(() => this.request(query));
        queue = task.catch(() => undefined);
        return task;
    }
    private async request(query: string): Promise<any> {
        for (let attempt = 0; attempt < 4; attempt++) {
            await wait(nextRequest - Date.now());
            nextRequest = Date.now() + 2200;
            let response: Response;
            try {
                response = await fetch("https://graphql.anilist.co", {
                    method: "POST", signal: AbortSignal.timeout(30000),
                    headers: { "Content-Type": "application/json", Accept: "application/json" },
                    body: JSON.stringify({ query }),
                });
            } catch {
                if (attempt === 3) throw new AnilistApiError("AniList network request failed.");
                nextRequest = Math.max(nextRequest, Date.now() + 2000 * 2 ** attempt);
                continue;
            }
            const headers = response.headers;
            const limit = Number(headers?.get("x-ratelimit-limit"));
            if (limit > 0) nextRequest = Math.max(nextRequest, Date.now() + Math.ceil(60000 / limit) + 200);
            if (headers?.get("x-ratelimit-remaining") === "0") {
                const reset = Number(headers.get("x-ratelimit-reset")) * 1000;
                nextRequest = Math.max(nextRequest, Number.isFinite(reset) && reset > Date.now() ? reset + 1000 : Date.now() + 61000);
            }
            if (response.status === 429 || response.status >= 500) {
                const retry = headers?.get("retry-after");
                const retryMs = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : NaN;
                nextRequest = Math.max(nextRequest, Date.now() + (Number.isFinite(retryMs) ? Math.max(0, retryMs) + 1000 : response.status === 429 ? 61000 : 2000 * 2 ** attempt));
                if (attempt < 3) {
                    await response.body?.cancel();
                    continue;
                }
            }
            let body: any;
            try { body = await response.json(); }
            catch { throw new AnilistApiError(`AniList returned invalid JSON (HTTP ${response.status}).`, response.status); }
            if (!response.ok || body?.errors?.length) throw new AnilistApiError(`AniList API request failed (HTTP ${response.status}).`, response.status);
            return body;
        }
        throw new AnilistApiError("AniList retries exhausted.");
    }
}
