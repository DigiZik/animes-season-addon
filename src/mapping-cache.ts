import { promises as fs } from "fs";
import path from "path";
import { randomUUID, createHash } from "crypto";

const MAX_BYTES = 16 * 1024 * 1024;
const DAY = 86400000;
type Snapshot = { version: 1; url: string; body: string; etag?: string; downloadedAt: number; checkedAt: number; sha256: string };
export type SourceReport = { source: string; status: "downloaded" | "not-modified" | "fallback" | "unavailable"; attempts: number; bytes: number; ageHours: number | null; reason?: string };
export type CacheOptions = {
    directory: string; maxAgeDays?: number; fetcher?: typeof fetch;
    now?: () => number; sleep?: (ms: number) => Promise<void>;
};
export class MappingSourceError extends Error {
    constructor(message: string, public readonly report: SourceReport) { super(message); }
}
class DownloadError extends Error {
    constructor(message: string, readonly retryable = false, readonly retryAfter?: number) { super(message); }
}
export function cacheMaxAge(value = process.env.MAPPING_CACHE_MAX_AGE_DAYS): number {
    if (value === undefined || value === "") return 7;
    if (!/^[1-9]\d*$/.test(value) || Number(value) > 30) throw new Error("MAPPING_CACHE_MAX_AGE_DAYS must be an integer from 1 through 30.");
    return Number(value);
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const reason = (error: unknown) => error instanceof Error ? error.message : "Mapping source unavailable";

// One atomic envelope keeps the body, timestamps and ETag in the same generation.
async function save(file: string, snapshot: Snapshot) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        await fs.writeFile(temporary, JSON.stringify(snapshot), { flag: "wx" });
        await fs.rename(temporary, file);
    } finally { await fs.rm(temporary, { force: true }); }
}

export async function loadMappingSource<T>(source: { name: string; url: string; validate: (text: string) => T }, options: CacheOptions): Promise<{ data: T; report: SourceReport }> {
    const now = options.now || Date.now;
    const maxAge = (options.maxAgeDays ?? cacheMaxAge()) * DAY;
    if (!Number.isInteger(maxAge / DAY) || maxAge < DAY || maxAge > 30 * DAY) throw new Error("Invalid mapping cache age limit.");
    const file = path.join(options.directory, `${source.name}.snapshot.json`);
    let cached: Snapshot | undefined, cachedData: T | undefined;
    try {
        if ((await fs.stat(file)).size > MAX_BYTES * 2 + 4096) throw new Error("Oversized mapping cache");
        const value = JSON.parse(await fs.readFile(file, "utf8")) as Snapshot;
        if (value.version !== 1 || value.url !== source.url || typeof value.body !== "string" || Buffer.byteLength(value.body) > MAX_BYTES ||
            !Number.isFinite(value.downloadedAt) || !Number.isFinite(value.checkedAt) || value.downloadedAt < 0 ||
            value.checkedAt < value.downloadedAt || value.checkedAt > now() + 300000 ||
            value.etag !== undefined && (typeof value.etag !== "string" || value.etag.length > 256 || /[\r\n]/.test(value.etag)) || value.sha256 !== hash(value.body)) {
            throw new Error("Invalid mapping cache");
        }
        cachedData = source.validate(value.body);
        cached = value;
    } catch { /* A missing or invalid snapshot must be replaced, never trusted. */ }

    const report: SourceReport = { source: source.name, status: "unavailable", attempts: 0, bytes: 0, ageHours: null };
    const started = now();
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const remaining = 45000 - (now() - started);
            if (remaining <= 0) throw new DownloadError("Mapping download deadline exceeded");
            report.attempts++;
            let response: Response;
            try {
                response = await (options.fetcher || fetch)(source.url, {
                    signal: AbortSignal.timeout(Math.min(20000, remaining)), redirect: "error",
                    headers: cached?.etag ? { "If-None-Match": cached.etag } : {},
                });
            } catch (error) { throw new DownloadError(reason(error), true); }
            if (response.status === 304) {
                if (!cached) throw new DownloadError("Unexpected HTTP 304 without a valid snapshot");
                cached.checkedAt = now();
                await save(file, cached).catch(() => { report.reason = "Snapshot could not be saved"; });
                report.status = "not-modified";
                report.ageHours = 0;
                return { data: cachedData as T, report };
            }
            if (!response.ok) {
                await response.body?.cancel();
                const retryAfter = response.headers.get("retry-after");
                const delay = retryAfter ? (/^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now()) : undefined;
                throw new DownloadError(`HTTP ${response.status}`, [408, 425, 429, 500, 502, 503, 504].includes(response.status), delay);
            }
            if (Number(response.headers.get("content-length")) > MAX_BYTES || !response.body) {
                await response.body?.cancel();
                throw new DownloadError("Mapping dataset is empty or too large");
            }
            const chunks: Uint8Array[] = [];
            let bytes = 0;
            try {
                for await (const chunk of response.body as any) {
                    bytes += chunk.length;
                    report.bytes += chunk.length;
                    if (bytes > MAX_BYTES) throw new DownloadError("Mapping dataset is too large");
                    chunks.push(chunk);
                }
            } catch (error) {
                if (error instanceof DownloadError) throw error;
                throw new DownloadError(reason(error), true);
            }
            const body = Buffer.concat(chunks, bytes).toString("utf8");
            const data = source.validate(body);
            const time = now();
            const etag = response.headers.get("etag") || undefined;
            const snapshot: Snapshot = { version: 1, url: source.url, body, etag: etag && etag.length <= 256 && !/[\r\n]/.test(etag) ? etag : undefined,
                downloadedAt: time, checkedAt: time, sha256: hash(body) };
            // Cache failures do not discard a valid response; the report makes the loss visible.
            await save(file, snapshot).catch(() => { report.reason = "Snapshot could not be saved"; });
            report.status = "downloaded";
            report.ageHours = 0;
            return { data, report };
        } catch (error) {
            lastError = error;
            if (!(error instanceof DownloadError) || !error.retryable || attempt === 2) break;
            const delay = Math.max(250 * 2 ** attempt, error.retryAfter || 0);
            // Do not hammer a rate-limited source or hold the build for a long Retry-After.
            if (delay > 5000 || now() - started + delay >= 45000) break;
            await (options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms))))(delay);
        }
    }
    report.reason = reason(lastError);
    if (cached) {
        const age = Math.max(0, now() - cached.checkedAt);
        report.ageHours = Math.round(age / 36000) / 100;
        if (age <= maxAge) {
            report.status = "fallback";
            return { data: cachedData as T, report };
        }
        report.reason += `; snapshot exceeds ${maxAge / DAY}-day age limit`;
    }
    throw new MappingSourceError(`${source.name}: ${report.reason}`, report);
}
