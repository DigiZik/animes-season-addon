import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { refreshCatalogs } from "../src/index";
import { Season } from "../src/query";
import { YearCatalogs } from "../src/stremio";

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
const fakeYearFetch = () => jest.fn(async (year: number): Promise<YearCatalogs> => {
    const annual = { movie: [{ id: `anilist:${year}`, type: "movie" as const, name: `First ${year}` },
        { id: `anilist:${year + 10000}`, type: "movie" as const, name: "Second" }],
        series: [{ id: `anilist:${year}`, type: "series" as const, name: `First ${year}` },
        { id: `anilist:${year + 10000}`, type: "series" as const, name: "Second" }] };
    return { annual, seasons: Object.values(Season).map(() => annual) };
});

it("fetches one combined year, preserves history, and deduplicates annual lists", async () => {
    const dir = path.join(root, "catalog/series/archive_anime_seasons");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "genre=2025.json"), "historical bytes");
    const fetch = fakeYearFetch();
    expect(await refreshCatalogs(root, today, false, fetch)).toEqual({ fetched: 1, firstYear: 2026, yearNow: 2026 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.every(([year]) => year === 2026)).toBe(true);
    expect(await fs.readFile(path.join(dir, "genre=2025.json"), "utf8")).toBe("historical bytes");
    for (const type of ["series", "movie"]) {
        const file = `catalog/${type}/archive_anime_seasons.json`;
        expect((await read(file)).metas).toHaveLength(2);
        expect(await fs.readFile(path.join(root, file), "utf8")).toBe(JSON.stringify(await read(file), null, 2) + "\n");
        expect(await read(`catalog/${type}/trending_anime_seasons.json`)).toEqual(await read(`catalog/${type}/trending_anime_seasons/genre=FALL (Sep - Nov).json`));
    }
    await expect(fs.stat(path.join(root, ".season-data"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("explicit history refresh rebuilds all years", async () => {
    const fetch = fakeYearFetch();
    expect((await refreshCatalogs(root, today, true, fetch)).fetched).toBe(26);
    expect((await read("catalog/movie/archive_anime_seasons/genre=2001.json")).metas[0].id).toBe("anilist:2001");
});

it("a late fetch failure leaves catalog sources and manifest unchanged", async () => {
    const dir = path.join(root, "catalog/series");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "trending_anime_seasons.json");
    await fs.writeFile(file, "previous data");
    const before = await fs.readFile(path.join(root, "manifest.json"), "utf8");
    const fetch = fakeYearFetch();
    const good = await fetch(2026);
    fetch.mockResolvedValueOnce(good).mockRejectedValueOnce(new Error("later failure"));
    await expect(refreshCatalogs(root, today, true, fetch)).rejects.toThrow("later failure");
    expect(await fs.readFile(file, "utf8")).toBe("previous data");
    expect(await fs.readFile(path.join(root, "manifest.json"), "utf8")).toBe(before);
});

it("finalizes last year at rollover once, then returns to one current-year query", async () => {
    const fetch = fakeYearFetch(), now = new Date("2027-01-01T00:30:00Z");
    expect((await refreshCatalogs(root, now, false, fetch)).fetched).toBe(2);
    expect((await read("manifest.json")).catalogs.find((c: any) => c.id === "archive_anime_seasons").extra[0].options[0]).toBe("2027");
    expect((await read("catalog/series/archive_anime_seasons/genre=2026.json")).metas[0].id).toBe("anilist:2026");
    fetch.mockClear();
    expect((await refreshCatalogs(root, now, false, fetch)).fetched).toBe(1);
    expect(fetch.mock.calls.every(([year]) => year === 2027)).toBe(true);
});

it("dates changed data accurately but does not rewrite identical refreshes", async () => {
    const fetch = fakeYearFetch();
    await refreshCatalogs(root, today, false, fetch);
    const before = await read("manifest.json");
    const write = jest.spyOn(fs, "writeFile");
    const tomorrow = new Date("2026-11-25T12:30:00Z");
    await refreshCatalogs(root, tomorrow, false, fetch);
    expect(write).not.toHaveBeenCalled();
    expect(await read("manifest.json")).toEqual(before);
    const changed = await fetch(2026); changed.annual = { movie: [{ id: "anilist:99", type: "movie", name: "New movie" }], series: [] }; fetch.mockResolvedValueOnce(changed);
    await refreshCatalogs(root, tomorrow, false, fetch);
    expect((await read("manifest.json")).lastUpdatedAt).toBe(tomorrow.toISOString());
    expect((await read("manifest.json")).version).not.toBe(before.version);
});
