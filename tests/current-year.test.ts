import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { prepareCurrentYear } from "../src/current-year";
import { buildPages } from "../src/pagination";
import { verifyPages } from "../src/verify-pages";
import { Manifest } from "../src/stremio";

jest.setTimeout(30000);
let root: string;
const today = new Date(2026, 10, 20);
const seasons = ["WINTER", "SPRING", "SUMMER", "FALL"];
const meta = (type: string, index: number) => ({ id: `tt${1000000 + index}`, type, name: `Anime ${index}`, poster: "https://example.com/poster.jpg" });
async function write(relative: string, data: unknown) {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data, null, 2));
}
async function read(relative: string) { return JSON.parse(await fs.readFile(path.join(root, relative), "utf8")); }
async function fixture() {
    const catalogs = [];
    for (const type of ["series", "movie"]) {
        catalogs.push({ type, id: "latest_anime_seasons", name: "Anime Seasons", extra: [{ name: "genre", options: seasons, isRequired: false }], extraSupported: ["genre"] });
        catalogs.push({ type, id: "archive_anime_seasons", name: "Anime Years", extra: [{ name: "genre", options: ["2025"], isRequired: true }], extraSupported: ["genre"] });
        await write(`catalog/${type}/latest_anime_seasons.json`, { metas: [meta(type, 3)] });
        for (let index = 0; index < seasons.length; index++) {
            await write(`catalog/${type}/latest_anime_seasons/genre=${seasons[index]}.json`, {
                metas: [meta(type, index), { ...meta(type, 99), name: `First occurrence in ${seasons[index]}` }]
            });
        }
        // Include every historic year so the complete advertised manifest can build.
        for (let year = 2001; year <= 2025; year++) await write(`catalog/${type}/archive_anime_seasons/genre=${year}.json`, { metas: [meta(type, year)] });
    }
    await write("manifest.json", { id: "original", name: "Anime", version: "1.20.1", catalogs, types: ["series", "movie"], resources: ["catalog"], lastUpdatedAt: "2026-09-01T00:00:00.000Z" });
}

beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "anime-year-test-")); await fixture(); });
afterEach(async () => {
    jest.restoreAllMocks();
    if (path.dirname(root) !== path.resolve(os.tmpdir())) throw new Error("Unsafe test cleanup path");
    await fs.rm(root, { recursive: true, force: true });
});

it("includes the current year and makes the year filter optional for both types without network requests", async () => {
    const network = jest.spyOn(global, "fetch").mockRejectedValue(new Error("Network must not be used"));
    const historical = await fs.readFile(path.join(root, "catalog/series/archive_anime_seasons/genre=2025.json"));
    const result = await prepareCurrentYear(root, today);
    expect(result).toEqual({ year: 2026, counts: { series: 5, movie: 5 }, changed: 5 });
    const manifest = await read("manifest.json");
    expect(manifest.version).toBe("1.20.2");
    expect(manifest.lastUpdatedAt).toBe("2026-09-01T00:00:00.000Z");
    for (const type of ["series", "movie"]) {
        const genre = manifest.catalogs.find((entry: any) => entry.type === type && entry.id === "archive_anime_seasons").extra[0];
        expect(genre.isRequired).toBe(false);
        expect(genre.options[0]).toBe("2026");
        expect(genre.options.at(-1)).toBe("2001");
        const explicit = await read(`catalog/${type}/archive_anime_seasons/genre=2026.json`);
        expect(await read(`catalog/${type}/archive_anime_seasons.json`)).toEqual(explicit);
        expect(explicit.metas.map((item: any) => item.id)).toEqual([1000000, 1000099, 1000001, 1000002, 1000003].map(id => `tt${id}`));
        expect(explicit.metas[1].name).toBe("First occurrence in WINTER");
    }
    expect(await fs.readFile(path.join(root, "catalog/series/archive_anime_seasons/genre=2025.json"))).toEqual(historical);
    expect(network).not.toHaveBeenCalled();
    expect((await prepareCurrentYear(root, today)).changed).toBe(0);
    expect((await read("manifest.json")).version).toBe("1.20.2");
});

it("keeps the generator manifest current and year filters optional after a normal update", async () => {
    const manifest = await Manifest.fromFile(path.join(root, "manifest.json"));
    await manifest.update(today);
    expect(manifest.getYears()[0]).toBe("2026");
    for (const catalog of manifest.catalogs.filter(entry => entry.id === "archive_anime_seasons")) {
        expect(catalog.extra[0].options[0]).toBe("2026");
        expect(catalog.extra[0].isRequired).toBe(false);
    }
    await prepareCurrentYear(root, today);
    expect((await read("catalog/series/archive_anime_seasons.json")).metas).toHaveLength(5);
});

it.each([20, 30, 50])("publishes equivalent default and explicit current-year pages at size %i", async pageSize => {
    await prepareCurrentYear(root, today);
    await buildPages({ root, pageSize });
    const result = await verifyPages(root, pageSize);
    expect(result.variants).toBe(64);
    for (const type of ["series", "movie"]) {
        const base = `.pages/paginated/catalog/${type}/archive_anime_seasons`;
        expect(await read(`${base}.json`)).toEqual(await read(`${base}/genre=2026.json`));
        for (const skip of [0, 1, 5, 20]) {
            expect(await read(`${base}/skip=${skip}.json`)).toEqual(await read(`${base}/skip=${skip}&genre=2026.json`));
        }
        expect(await read(`${base}/skip=20.json`)).toEqual({ metas: [] });
        expect((await read(`${base}/genre=2025.json`)).metas).toHaveLength(1);
    }
});

it("does not replace last-good files when any seasonal source is missing or invalid", async () => {
    await prepareCurrentYear(root, today);
    const before = await fs.readFile(path.join(root, "catalog/series/archive_anime_seasons.json"));
    const manifest = await fs.readFile(path.join(root, "manifest.json"));
    await write("catalog/series/latest_anime_seasons/genre=WINTER.json", { metas: [meta("series", 100)] });
    const movieFall = path.join(root, "catalog/movie/latest_anime_seasons/genre=FALL.json");
    await fs.unlink(movieFall);
    await expect(prepareCurrentYear(root, today)).rejects.toThrow("Cannot prepare 2026 movie");
    expect(await fs.readFile(path.join(root, "catalog/series/archive_anime_seasons.json"))).toEqual(before);
    expect(await fs.readFile(path.join(root, "manifest.json"))).toEqual(manifest);
    await write("catalog/movie/latest_anime_seasons/genre=FALL.json", { metas: [{ id: "bad", type: "series", name: "Invalid" }] });
    await expect(prepareCurrentYear(root, today)).rejects.toThrow("Invalid metadata");
    expect(await fs.readFile(path.join(root, "catalog/series/archive_anime_seasons.json"))).toEqual(before);
});

it("requires refreshed seasonal data at year rollover, then defaults to the new year and preserves history", async () => {
    await prepareCurrentYear(root, today);
    const oldYear = await fs.readFile(path.join(root, "catalog/series/archive_anime_seasons/genre=2026.json"));
    const nextYear = new Date(2027, 0, 1);
    await expect(prepareCurrentYear(root, nextYear)).rejects.toThrow("Refresh AniList data");
    expect((await read("manifest.json")).catalogs[1].extra[0].options[0]).toBe("2026");
    const manifest = await read("manifest.json");
    manifest.lastUpdatedAt = "2027-01-01T04:30:00.000Z";
    await write("manifest.json", manifest);
    await prepareCurrentYear(root, nextYear);
    expect((await read("manifest.json")).catalogs[1].extra[0].options.slice(0, 2)).toEqual(["2027", "2026"]);
    expect(await fs.readFile(path.join(root, "catalog/series/archive_anime_seasons/genre=2026.json"))).toEqual(oldYear);
    expect(await read("catalog/series/archive_anime_seasons.json")).toEqual(await read("catalog/series/archive_anime_seasons/genre=2027.json"));
});

it("accepts valid empty seasons without silently borrowing another year", async () => {
    for (const type of ["series", "movie"]) for (const season of seasons) {
        await write(`catalog/${type}/latest_anime_seasons/genre=${season}.json`, { metas: [] });
    }
    expect((await prepareCurrentYear(root, today)).counts).toEqual({ series: 0, movie: 0 });
    expect(await read("catalog/series/archive_anime_seasons.json")).toEqual({ metas: [] });
});
