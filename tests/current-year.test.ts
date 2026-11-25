import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { prepareCurrentYear } from "../src/current-year";
import { buildPages } from "../src/pagination";
import { verifyPages } from "../src/verify-pages";

jest.setTimeout(30000);
let root: string;
const today = new Date("2026-11-20T00:00:00Z");
const seasons = ["WINTER (Dec - Feb)", "SPRING (Mar - May)", "SUMMER (Jun - Aug)", "FALL (Sep - Nov)"];
const meta = (type: string, index: number) => ({ id: `tt${1000000 + index}`, type, name: `Anime ${index}`, poster: "https://example.com/poster.jpg" });
async function write(relative: string, data: unknown) {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n");
}
async function read(relative: string) { return JSON.parse(await fs.readFile(path.join(root, relative), "utf8")); }
async function fixture() {
    const catalogs = [];
    for (const type of ["series", "movie"]) {
        catalogs.push({ type, id: "trending_anime_seasons", name: "Anime Seasons", extra: [{ name: "genre", options: ["FALL (Sep - Nov)", "WINTER (Dec - Feb)", "SPRING (Mar - May)", "SUMMER (Jun - Aug)"], isRequired: false }], extraSupported: ["genre"] });
        catalogs.push({ type, id: "archive_anime_seasons", name: "Anime Years", extra: [{ name: "genre", options: Array.from({ length: 26 }, (_, i) => String(2026 - i)), isRequired: false }], extraSupported: ["genre"] });
        const seasonal = seasons.map((season, index) => [meta(type, index), { ...meta(type, 99), name: `First occurrence in ${season}` }]);
        await write(`catalog/${type}/trending_anime_seasons.json`, { metas: seasonal[3] });
        for (let index = 0; index < seasons.length; index++) {
            await write(`catalog/${type}/trending_anime_seasons/genre=${seasons[index]}.json`, { metas: seasonal[index] });
        }
        const annual = [seasonal[0][0], seasonal[0][1], seasonal[1][0], seasonal[2][0], seasonal[3][0]];
        await write(`catalog/${type}/archive_anime_seasons.json`, { metas: annual });
        await write(`catalog/${type}/archive_anime_seasons/genre=2026.json`, { metas: annual });
        for (let year = 2001; year <= 2025; year++) await write(`catalog/${type}/archive_anime_seasons/genre=${year}.json`, { metas: [meta(type, year)] });
    }
    await write("manifest.json", { id: "original", name: "Anime", version: "1.20.1", catalogs, types: ["series", "movie"], resources: ["catalog"], lastUpdatedAt: "2026-09-01T00:00:00.000Z" });
}

beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "anime-year-test-")); await fixture(); });
afterEach(async () => {
    jest.restoreAllMocks();
    if (path.dirname(root) !== path.resolve(os.tmpdir())) throw Error("Unsafe cleanup");
    await fs.rm(root, { recursive: true, force: true });
});

it("validates membership and defaults without network requests or source writes", async () => {
    const network = jest.spyOn(global, "fetch").mockRejectedValue(new Error("Network must not be used"));
    const writes = jest.spyOn(fs, "writeFile");
    const before = await fs.readFile(path.join(root, "manifest.json"), "utf8");
    expect(await prepareCurrentYear(root, today)).toEqual({ year: 2026, counts: { series: 5, movie: 5 } });
    expect(network).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(root, "manifest.json"), "utf8")).toBe(before);
    const annual = (await read("catalog/series/archive_anime_seasons.json")).metas;
    expect(annual.map((item: any) => item.id)).toEqual([1000000, 1000099, 1000001, 1000002, 1000003].map(id => `tt${id}`));
    expect(annual[1].name).toBe("First occurrence in WINTER (Dec - Feb)");
});

it("accepts independently ordered annual catalogs and rejects missing or duplicate entries", async () => {
    const file = "catalog/series/archive_anime_seasons/genre=2026.json";
    const annual = (await read(file)).metas.reverse();
    await write(file, { metas: annual });
    await write("catalog/series/archive_anime_seasons.json", { metas: annual });
    await expect(prepareCurrentYear(root, today)).resolves.toMatchObject({ counts: { series: 5, movie: 5 } });
    await write(file, { metas: annual.slice(1) });
    await expect(prepareCurrentYear(root, today)).rejects.toThrow("annual membership");
    await write(file, { metas: [...annual, annual[0]] });
    await expect(prepareCurrentYear(root, today)).rejects.toThrow("Duplicate catalog IDs");
});

it("rejects inconsistent native cards but permits different ranking winners for shared mapped IDs", async () => {
    const file = "catalog/series/archive_anime_seasons/genre=2026.json";
    const currentFiles = [file, "catalog/series/archive_anime_seasons.json", "catalog/series/trending_anime_seasons.json",
        ...seasons.map(season => `catalog/series/trending_anime_seasons/genre=${season}.json`)];
    for (const current of currentFiles) {
        const data = await read(current);
        data.metas.forEach((meta: any) => { meta.id = `anilist:${meta.id.slice(2)}`; });
        await write(current, data);
    }
    const annual = (await read(file)).metas;
    annual[0] = { ...annual[0], name: "Inconsistent fallback" };
    await write(file, { metas: annual });
    await write("catalog/series/archive_anime_seasons.json", { metas: annual });
    await expect(prepareCurrentYear(root, today)).rejects.toThrow("annual card");
    await fixture();
    const updated = (await read(file)).metas;
    updated[1] = { ...updated[1], name: "Popularity winner before mapped-ID deduplication" };
    await write(file, { metas: updated });
    await write("catalog/series/archive_anime_seasons.json", { metas: updated });
    await expect(prepareCurrentYear(root, today)).resolves.toMatchObject({ counts: { series: 5 } });
});

it("publishes equivalent default and explicit current-year pages at fixed size 100", async () => {
    await prepareCurrentYear(root, today);
    await buildPages({ root });
    expect((await verifyPages(root)).variants).toBe(64);
    for (const type of ["series", "movie"]) {
        const base = `.pages/paginated/catalog/${type}/archive_anime_seasons`;
        expect(await read(`${base}.json`)).toEqual(await read(`${base}/genre=2026.json`));
        for (const skip of [0, 1, 5, 20]) {
            expect(await read(`${base}/skip=${skip}.json`)).toEqual(await read(`${base}/skip=${skip}&genre=2026.json`));
        }
    }
});

it("rejects stale defaults without silently repairing them after IMDb conversion", async () => {
    await write("catalog/movie/archive_anime_seasons.json", { metas: [] });
    const writes = jest.spyOn(fs, "writeFile");
    await expect(prepareCurrentYear(root, today)).rejects.toThrow("Stale catalog");
    expect(writes).not.toHaveBeenCalled();
    expect((await read("catalog/movie/archive_anime_seasons.json")).metas).toEqual([]);
});

it("rejects missing or invalid seasonal sources and stale year-filter options", async () => {
    const file = "catalog/movie/trending_anime_seasons/genre=FALL (Sep - Nov).json";
    await fs.unlink(path.join(root, file));
    await expect(prepareCurrentYear(root, today)).rejects.toMatchObject({ code: "ENOENT" });
    await write(file, { metas: [{ id: "bad", type: "series", name: "Invalid" }] });
    await expect(prepareCurrentYear(root, today)).rejects.toThrow("Invalid metadata");
    await fixture();
    const manifest = await read("manifest.json");
    manifest.catalogs[1].extra[0].options = ["2025"];
    await write("manifest.json", manifest);
    await expect(prepareCurrentYear(root, today)).rejects.toThrow("Stale Anime Years options");
});

it("requires refreshed seasonal data at year rollover without changing existing files", async () => {
    const oldYear = await fs.readFile(path.join(root, "catalog/series/archive_anime_seasons/genre=2026.json"));
    const writes = jest.spyOn(fs, "writeFile");
    await expect(prepareCurrentYear(root, new Date("2027-01-01T00:00:00Z"))).rejects.toThrow("Refresh AniList data");
    expect(writes).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(root, "catalog/series/archive_anime_seasons/genre=2026.json"))).toEqual(oldYear);
});

it("accepts legitimate empty seasons and annual lists", async () => {
    for (const type of ["series", "movie"]) {
        for (const season of seasons) await write(`catalog/${type}/trending_anime_seasons/genre=${season}.json`, { metas: [] });
        for (const file of [`trending_anime_seasons.json`, `archive_anime_seasons.json`, `archive_anime_seasons/genre=2026.json`]) await write(`catalog/${type}/${file}`, { metas: [] });
    }
    expect((await prepareCurrentYear(root, today)).counts).toEqual({ series: 0, movie: 0 });
});
