import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { refreshCatalogs } from "../src/index";
import { Season } from "../src/query";
import { SeasonCatalogs } from "../src/stremio";
import { Anilist } from "../src/request";

let root: string;
const today = new Date("2026-11-24T12:30:00Z");
const read = async (file: string) => JSON.parse(await fs.readFile(path.join(root, file), "utf8"));
beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "refresh-simple-"));
    const manifest = JSON.parse(await fs.readFile(path.resolve(__dirname, "../../manifest.json"), "utf8"));
    manifest.lastUpdatedAt = today.toISOString();
    await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
    jest.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(async () => {
    jest.restoreAllMocks();
    if (path.dirname(root) !== path.resolve(os.tmpdir())) throw Error("Unsafe cleanup");
    await fs.rm(root, { recursive: true, force: true });
});
const fetchSeason = () => jest.fn(async (year: number, season: Season): Promise<SeasonCatalogs> => ({
    movie: [{ id: `anilist:${year}`, type: "movie", name: `First ${year}` },
        { id: `anilist:${year + 10000}`, type: "movie", name: season }],
    series: [{ id: `anilist:${year}`, type: "series", name: `First ${year}` },
        { id: `anilist:${year + 10000}`, type: "series", name: season }],
}));

it("fetches four combined seasons, preserves history, and deduplicates annual lists", async () => {
    const dir = path.join(root, "catalog/series/archive_anime_seasons");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "genre=2025.json"), "historical bytes");
    const fetch = fetchSeason();
    expect(await refreshCatalogs(root, today, false, fetch)).toEqual({ fetched: 4, firstYear: 2026, yearNow: 2026 });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls.every(([year]) => year === 2026)).toBe(true);
    expect(await fs.readFile(path.join(dir, "genre=2025.json"), "utf8")).toBe("historical bytes");
    for (const type of ["series", "movie"]) {
        const file = `catalog/${type}/archive_anime_seasons.json`;
        expect((await read(file)).metas).toHaveLength(2);
        expect(await fs.readFile(path.join(root, file), "utf8")).toBe(JSON.stringify(await read(file), null, 2) + "\n");
        expect(await read(`catalog/${type}/latest_anime_seasons.json`)).toEqual(await read(`catalog/${type}/latest_anime_seasons/genre=FALL.json`));
    }
    await expect(fs.stat(path.join(root, ".season-data"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("explicit history refresh rebuilds all years", async () => {
    const fetch = fetchSeason();
    expect((await refreshCatalogs(root, today, true, fetch)).fetched).toBe(104);
    expect((await read("catalog/movie/archive_anime_seasons/genre=2001.json")).metas[0].id).toBe("anilist:2001");
});

it("a late fetch failure leaves catalog sources and manifest unchanged", async () => {
    const dir = path.join(root, "catalog/series");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "latest_anime_seasons.json");
    await fs.writeFile(file, "previous data");
    const before = await fs.readFile(path.join(root, "manifest.json"), "utf8");
    const fetch = fetchSeason();
    const good = await fetch(2026, Season.WINTER);
    fetch.mockResolvedValueOnce(good).mockResolvedValueOnce(good).mockResolvedValueOnce(good).mockRejectedValueOnce(new Error("later failure"));
    await expect(refreshCatalogs(root, today, false, fetch)).rejects.toThrow("later failure");
    expect(await fs.readFile(file, "utf8")).toBe("previous data");
    expect(await fs.readFile(path.join(root, "manifest.json"), "utf8")).toBe(before);
});

it("finalizes last year at rollover once, then returns to four current-year seasons", async () => {
    const fetch = fetchSeason(), now = new Date("2027-01-01T00:30:00Z");
    expect((await refreshCatalogs(root, now, false, fetch)).fetched).toBe(8);
    expect((await read("manifest.json")).catalogs.find((c: any) => c.id === "archive_anime_seasons").extra[0].options[0]).toBe("2027");
    expect((await read("catalog/series/archive_anime_seasons/genre=2026.json")).metas[0].id).toBe("anilist:2026");
    fetch.mockClear();
    expect((await refreshCatalogs(root, now, false, fetch)).fetched).toBe(4);
    expect(fetch.mock.calls.every(([year]) => year === 2027)).toBe(true);
});

it("dates changed data accurately but does not rewrite identical refreshes", async () => {
    const fetch = fetchSeason();
    await refreshCatalogs(root, today, false, fetch);
    const before = await read("manifest.json");
    const write = jest.spyOn(fs, "writeFile");
    const tomorrow = new Date("2026-11-25T12:30:00Z");
    await refreshCatalogs(root, tomorrow, false, fetch);
    expect(write).not.toHaveBeenCalled();
    expect(await read("manifest.json")).toEqual(before);
    fetch.mockResolvedValueOnce({ movie: [{ id: "anilist:99", type: "movie", name: "New movie" }], series: [] });
    await refreshCatalogs(root, tomorrow, false, fetch);
    expect((await read("manifest.json")).lastUpdatedAt).toBe(tomorrow.toISOString());
    expect((await read("manifest.json")).version).not.toBe(before.version);
});

it("preserves the committed native catalogs byte-for-byte across combined-page boundaries", async () => {
    const manifestPath = path.resolve(__dirname, "../../manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    await fs.copyFile(manifestPath, path.join(root, "manifest.json"));
    const source = path.resolve(__dirname, "../../catalog");
    await fs.cp(source, path.join(root, "catalog"), { recursive: true });
    const media = new Map<string, any[]>();
    let expectedRequests = 0, separateRequests = 0;
    for (const season of Object.values(Season)) {
        const series = (await read(`catalog/series/latest_anime_seasons/genre=${season}.json`)).metas;
        const movies = (await read(`catalog/movie/latest_anime_seasons/genre=${season}.json`)).metas;
        // A combined popularity list can interleave types; relative order within
        // each type must survive both interleaving and page boundaries.
        const rows: any[] = [];
        for (let i = 0; i < Math.max(series.length, movies.length); i++) {
            for (const [meta, format] of [[series[i], "TV"], [movies[i], "MOVIE"]] as const) {
                if (meta) rows.push({ id: Number(meta.id.slice(8)), format, isAdult: false,
                    title: { english: meta.name }, coverImage: { large: meta.poster }, startDate: { year: Number(meta.releaseInfo) } });
            }
        }
        media.set(season, rows);
        expectedRequests += Math.max(1, Math.ceil(rows.length / 50));
        separateRequests += Math.max(1, Math.ceil(series.length / 50)) + Math.max(1, Math.ceil(movies.length / 50));
    }
    const requests = jest.spyOn(Anilist.prototype, "fetch").mockImplementation(async q => {
        const rows = media.get(/season:(\w+)/.exec(q)![1])!;
        const page = Number(/page: (\d+)/.exec(q)![1]);
        return { data: { Page: { media: rows.slice((page - 1) * 50, page * 50), pageInfo: { hasNextPage: page * 50 < rows.length } } } };
    });
    const writes = jest.spyOn(fs, "writeFile");
    await refreshCatalogs(root, new Date(manifest.lastUpdatedAt));
    expect(requests).toHaveBeenCalledTimes(expectedRequests);
    expect(expectedRequests).toBeLessThanOrEqual(separateRequests);
    expect(writes).not.toHaveBeenCalled();
});
