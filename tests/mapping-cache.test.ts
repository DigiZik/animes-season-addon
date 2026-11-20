import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { cacheMaxAge, loadMappingSource, MappingSourceError } from "../src/mapping-cache";
import { AnimeMappings, loadMappingIndex } from "../src/anime-mappings";

const DAY = 86400000;
const start = Date.UTC(2026, 10, 21);
let directory: string, clock: number, fetcher: jest.Mock, sleeps: number[];
const source = { name: "fixture", url: "https://example.com/data.json", validate: (text: string) => {
    const value = JSON.parse(text);
    if (value?.id !== 1) throw new Error("Invalid schema");
    return value;
} };
const good = () => new Response('{"id":1}', { headers: { etag: '"v1"' } });
const options = () => ({ directory, now: () => clock, fetcher, sleep: async (ms: number) => { sleeps.push(ms); clock += ms; } });
async function seed() { fetcher.mockResolvedValue(good()); return loadMappingSource(source, options()); }
async function editSnapshot(change: (value: any) => void) {
    const file = path.join(directory, "fixture.snapshot.json");
    const value = JSON.parse(await fs.readFile(file, "utf8")); change(value); await fs.writeFile(file, JSON.stringify(value));
}
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), "mapping-cache-")); clock = start; sleeps = []; fetcher = jest.fn(); });
afterEach(async () => { if (path.dirname(directory) !== path.resolve(os.tmpdir())) throw new Error("Unsafe cleanup"); await fs.rm(directory, { recursive: true, force: true }); });

it("saves a validated snapshot and revalidates with one conditional GET, without reading a 304 body", async () => {
    expect((await seed()).report).toMatchObject({ status: "downloaded", attempts: 1, bytes: 8 });
    clock += DAY;
    fetcher.mockResolvedValue(new Response(null, { status: 304 }));
    const result = await loadMappingSource(source, options());
    expect(result.data).toEqual({ id: 1 });
    expect(result.report).toMatchObject({ status: "not-modified", attempts: 1, bytes: 0, ageHours: 0 });
    expect(fetcher.mock.calls[1][1].headers).toEqual({ "If-None-Match": '"v1"' });
    expect(JSON.parse(await fs.readFile(path.join(directory, "fixture.snapshot.json"), "utf8"))).toMatchObject({ downloadedAt: start, checkedAt: clock });
    expect((await fs.readdir(directory)).filter(file => file.endsWith(".tmp"))).toEqual([]);
});
it("retries transient responses twice, then uses a snapshot without renewing its age", async () => {
    await seed(); clock += DAY;
    fetcher.mockImplementation(async () => new Response("busy", { status: 503 }));
    const result = await loadMappingSource(source, options());
    expect(result.report).toMatchObject({ status: "fallback", attempts: 3, reason: "HTTP 503" });
    expect(sleeps).toEqual([250, 500]);
    expect(JSON.parse(await fs.readFile(path.join(directory, "fixture.snapshot.json"), "utf8")).checkedAt).toBe(start);
});
it("recovers from a transient connection failure without duplicate work", async () => {
    fetcher.mockRejectedValueOnce(new TypeError("connection reset")).mockImplementationOnce(async () => good());
    expect((await loadMappingSource(source, options())).report).toMatchObject({ status: "downloaded", attempts: 2 });
    expect(sleeps).toEqual([250]);
});
it("retries a truncated body and validates the replacement", async () => {
    fetcher.mockImplementationOnce(async () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError("socket closed")); } })))
        .mockImplementationOnce(async () => good());
    expect((await loadMappingSource(source, options())).report.attempts).toBe(2);
});
it("honours a short Retry-After but stops retrying when the server requests a long wait", async () => {
    await seed();
    fetcher.mockImplementation(async () => new Response("rate limited", { status: 429, headers: { "retry-after": "2" } }));
    await loadMappingSource(source, options()); expect(sleeps).toEqual([2000, 2000]);
    sleeps = [];
    fetcher.mockImplementation(async () => new Response("rate limited", { status: 429, headers: { "retry-after": "120" } }));
    expect((await loadMappingSource(source, options())).report.attempts).toBe(1); expect(sleeps).toEqual([]);
});
it("does not retry permanent HTTP or schema errors, or replace the last-good cache", async () => {
    await seed(); const before = await fs.readFile(path.join(directory, "fixture.snapshot.json"));
    fetcher.mockImplementation(async () => new Response("missing", { status: 404 }));
    expect((await loadMappingSource(source, options())).report).toMatchObject({ status: "fallback", attempts: 1 });
    fetcher.mockImplementation(async () => new Response('{"id":2}', { headers: { etag: '"bad"' } }));
    expect((await loadMappingSource(source, options())).report).toMatchObject({ status: "fallback", attempts: 1, reason: "Invalid schema" });
    expect(await fs.readFile(path.join(directory, "fixture.snapshot.json"))).toEqual(before);
});
it("expires fallback snapshots at the configured age, but can revalidate an old snapshot", async () => {
    await seed(); clock += 8 * DAY;
    fetcher.mockImplementation(async () => new Response("missing", { status: 404 }));
    await expect(loadMappingSource(source, options())).rejects.toThrow("exceeds 7-day");
    expect((await loadMappingSource(source, { ...options(), maxAgeDays: 10 })).report.status).toBe("fallback");
    fetcher.mockResolvedValue(new Response(null, { status: 304 }));
    expect((await loadMappingSource(source, options())).report.status).toBe("not-modified");
});
it.each(["url", "hash", "future", "date", "etag"])("does not trust a corrupt %s snapshot", async kind => {
    await seed();
    await editSnapshot(value => { if (kind === "url") value.url += "/other"; if (kind === "hash") value.body = '{"id":2}';
        if (kind === "future") value.checkedAt += DAY; if (kind === "date") value.downloadedAt = null; if (kind === "etag") value.etag = "bad\r\nheader"; });
    fetcher.mockImplementation(async () => new Response("missing", { status: 404 }));
    await expect(loadMappingSource(source, options())).rejects.toBeInstanceOf(MappingSourceError);
    expect(fetcher.mock.calls[1][1].headers).toEqual({});
});
it("does not trust 304 without a valid snapshot", async () => {
    fetcher.mockResolvedValue(new Response(null, { status: 304 }));
    await expect(loadMappingSource(source, options())).rejects.toThrow("without a valid snapshot");
});
it("rejects oversized advertised and streamed responses without replacing cache", async () => {
    await seed();
    fetcher.mockResolvedValue(new Response("", { headers: { "content-length": String(17 * 1024 * 1024) } }));
    expect((await loadMappingSource(source, options())).report.reason).toContain("too large");
    fetcher.mockResolvedValue(new Response(new Uint8Array(17 * 1024 * 1024)));
    expect((await loadMappingSource(source, options())).report.reason).toContain("too large");
});
it("returns valid network data even when the snapshot directory is unwritable", async () => {
    const notDirectory = path.join(directory, "file"); await fs.writeFile(notDirectory, "file"); fetcher.mockResolvedValue(good());
    expect((await loadMappingSource(source, { ...options(), directory: notDirectory })).report).toMatchObject({ status: "downloaded", reason: "Snapshot could not be saved" });
});
it.each(["0", "-1", "1.5", "31", "NaN", "7days"])("rejects invalid age %s", value => expect(() => cacheMaxAge(value)).toThrow("1 through 30"));
it("defaults to seven days", () => { expect(cacheMaxAge("")).toBe(7); expect(cacheMaxAge("30")).toBe(30); });

const header = "anilist\tkitsu\timdb\tmyanimelist\tanidb\tsimkl\tthemoviedb\tthemoviedb_type\n";
it.each(["mal", "anidb", "simkl"])("rejects contradictory %s evidence even when Kitsu agrees", field => {
    const mapping = new AnimeMappings([{ anilist_id: 1, kitsu_id: 10, mal_id: 20, anidb_id: 30, simkl_id: 40 }],
        header + `1\t10\t\t${field === "mal" ? 21 : 20}\t${field === "anidb" ? 31 : 30}\t${field === "simkl" ? 41 : 40}\t\t\n`);
    expect(mapping.preferredId(1)).toBe("anilist:1"); expect(mapping.report().conflicts).toBe(1);
    expect(mapping.lookup("kitsu", "10")).toBeUndefined();
});
it("records link provenance and does not overwrite a primary IMDb with a conflicting overlay", () => {
    const mapping = new AnimeMappings([{ anilist_id: 1, mal_id: 20, imdb_id: "tt1234567" }], header + "1\t10\ttt7654321\t20\t\t\t\t\n");
    expect(mapping.preferredId(1)).toBe("kitsu:10");
    expect(mapping.get(1)?.provenance).toMatchObject({ kitsu: "animeApi", myanimelist: "both", imdb: "fribb" });
    expect(mapping.get(1)?.imdb).toEqual(new Set(["tt1234567"]));
});
it("rejects contested overlay links instead of taking an ID from another anime", () => {
    const mapping = new AnimeMappings([{ anilist_id: 1, kitsu_id: 10 }, { anilist_id: 2 }], header + "2\t10\t\t\t\t\t\t\n");
    expect(mapping.preferredId(2)).toBe("anilist:2"); expect(mapping.preferredId(1)).toBe("kitsu:10");
    expect(mapping.report().contestedLinks).toBe(1);
});
it.each(["anidb", "simkl"])("rejects an overlay whose %s identity belongs to another anime", field => {
    const mapping = new AnimeMappings([{ anilist_id: 1, [field + "_id"]: 30 }, { anilist_id: 2 }],
        header + `2\t20\t\t\t${field === "anidb" ? 30 : ""}\t${field === "simkl" ? 30 : ""}\t\t\n`);
    expect(mapping.preferredId(2)).toBe("anilist:2");
    expect(mapping.report().contestedLinks).toBe(1);
});
it("keeps movie and TV TMDB namespaces separate and refuses untyped lookup", () => {
    const mapping = new AnimeMappings([{ anilist_id: 1, themoviedb_id: { movie: [30] } }, { anilist_id: 2, themoviedb_id: { tv: 30 } }]);
    expect(mapping.lookup("themoviedb", "30", "movie")?.anilistId).toBe(1);
    expect(mapping.lookup("themoviedb", "30", "series")?.anilistId).toBe(2);
    expect(mapping.lookup("themoviedb", "30")).toBeUndefined();
});
it("continues with primary mappings when the optional overlay is unavailable", async () => {
    fetcher.mockImplementation(async (url: string) => url.includes("Fribb") ? new Response('[{"anilist_id":1,"kitsu_id":10}]') : new Response("missing", { status: 404 }));
    const mapping = await loadMappingIndex(options()); expect(mapping.preferredId(1)).toBe("kitsu:10");
    expect(mapping.sourceReports.map(source => source.status)).toEqual(["downloaded", "unavailable"]);
});
it("requires primary mappings and preserves a previous deployment when no usable snapshot exists", async () => {
    fetcher.mockImplementation(async () => new Response("missing", { status: 404 }));
    await expect(loadMappingIndex(options())).rejects.toThrow("previous published catalogs are preserved");
});
it("bounds the total retry deadline and reports actual attempts", async () => {
    await seed();
    fetcher.mockImplementation(async () => { clock += 23000; throw new TypeError("timeout"); });
    const result = await loadMappingSource(source, options());
    expect(result.report.attempts).toBe(2);
    expect(sleeps).toEqual([250]);
});
it("parses quoted IDs, CRLF, and trailing empty columns without shifting identities", () => {
    const mapping = new AnimeMappings([{ anilist_id: 1 }], header.replace(/\n$/, '\r\n') + '"1"\t"10"\t\t\t\t\t\t\r\n');
    expect(mapping.preferredId(1)).toBe("kitsu:10");
    expect(mapping.report().invalidRows).toBe(0);
});
it("checks each identity once for reporting while reusing the chosen ID", () => {
    const mapping = new AnimeMappings([{ anilist_id: 1, kitsu_id: 10 }]);
    for (let i = 0; i < 100; i++) expect(mapping.preferredId(1)).toBe("kitsu:10");
    expect(mapping.report()).toMatchObject({ resolvedUnique: 1, kitsu: 1, anilist: 0 });
});
