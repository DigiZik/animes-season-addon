import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { kitsuIndex, imdbIndex, convertCatalogs, downloadMappings } from "../src/mappings";
import { buildAllPages } from "../src/build-pages";
import { verifyPages } from "../src/verify-pages";
import { refreshCatalogs } from "../src/index";
import { Manifest } from "../src/stremio";
import { validateMeta } from "../src/native-meta";

jest.setTimeout(120000);
const row = (id: number, kitsu?: unknown, imdb?: unknown, type = "TV") => ({ anilist_id: id, kitsu_id: kitsu, imdb_id: imdb, type });
const meta = (id: number) => ({ id: `anilist:${id}`, type: "series" as const, name: `Anime ${id}`, poster: "https://example.com/poster.jpg", releaseInfo: "2026" });
let root: string;
beforeEach(async () => {
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    root = await fs.mkdtemp(path.join(os.tmpdir(), "unified-anime-"));
    await fs.mkdir(path.join(root, "catalog/series"), { recursive: true });
    await fs.writeFile(path.join(root, "catalog/series/test.json"), JSON.stringify({ metas: [meta(1), meta(2), meta(3), meta(4)] }));
});
afterEach(async () => {
    jest.restoreAllMocks();
    if (path.dirname(root) !== path.resolve(os.tmpdir())) throw Error("Unsafe cleanup");
    await fs.rm(root, { recursive: true, force: true });
});

it("prefers Kitsu, uses IMDb fallback and omits unmapped entries without changing sources", async () => {
    const source = await fs.readFile(path.join(root, "catalog/series/test.json"));
    const result = await convertCatalogs(root, [row(1, 10, "tt1111111"), row(2, undefined, "tt2222222"), row(3, 10, "tt2222222"), row(4, 40)]);
    // Shared Kitsu 10 is rejected; 1 falls back to IMDb and 3 deduplicates against 2.
    expect(result.converted.get("catalog/series/test.json")?.metas).toEqual([
        { ...meta(1), id: "tt1111111" }, { ...meta(2), id: "tt2222222" }, { ...meta(4), id: "kitsu:40" }
    ]);
    expect(result.report).toEqual({ inputEntries: 4, kitsu: 1, imdb: 2, omitted: 0, duplicates: 1 });
    expect(await fs.readFile(path.join(root, "catalog/series/test.json"))).toEqual(source);
    const simple = await convertCatalogs(root, [row(1, 10, "tt1111111")]);
    expect(simple.converted.get("catalog/series/test.json")?.metas[0].id).toBe("kitsu:10");
    expect(simple.report.omitted).toBe(3);
});

it("rejects conflicting Kitsu rows, invalid IDs and ownership across types", () => {
    const index = kitsuIndex([row(1, 10), row(1, 11), row(2, [20, 21]), row(3, 30), row(4, 30, undefined, "MOVIE"), row(5, 50), row(5, 50), row(6, "60"), row(7, 0), row(8, Number.MAX_SAFE_INTEGER + 1)]);
    for (const key of ["series:1", "series:2", "series:3", "movie:4", "series:6", "series:7", "series:8"]) expect(index.get(key)).toBeFalsy();
    expect(index.get("series:5")).toBe("kitsu:50");
});

it("retains IMDb movie safeguards and permits shared series IDs", () => {
    const index = imdbIndex([row(1, undefined, "tt1111111", "MOVIE"), row(2, undefined, "tt1111111", "MOVIE"), row(3, undefined, ["tt2222222", "tt3333333"]), row(4, undefined, "tt4444444"), row(5, undefined, "tt4444444"), { ...row(6, undefined, "tt6666666", "MOVIE"), themoviedb_id: { tv: 6 } }, { ...row(7, undefined, "tt7777777", "MOVIE"), themoviedb_id: { movie: [1, 2] } }]);
    for (const key of ["movie:1", "movie:2", "series:3", "movie:6", "movie:7"]) expect(index.get(key)).toBeFalsy();
    expect(index.get("series:4")).toBe("tt4444444");
    expect(index.get("series:5")).toBe("tt4444444");
});

it.each([false, true])("rejects IMDb conflicts disclosed by rejected rows regardless of order (reverse=%s)", reverse => {
    const rows = [
        row(1, undefined, "tt1111111", "MOVIE"), row(2, undefined, ["tt1111111", "tt2222222"], "MOVIE"),
        row(3, undefined, "tt3333333"), { ...row(4, undefined, "tt3333333", "MOVIE"), themoviedb_id: { tv: 4 } },
        row(5, undefined, "tt5555555", "MOVIE"), row(5, undefined, "invalid", "MOVIE"),
        row(6, undefined, ["tt6666666", "invalid"]),
    ];
    const index = imdbIndex(reverse ? rows.reverse() : rows);
    for (const key of ["movie:1", "movie:2", "series:3", "movie:4", "movie:5", "series:6"]) expect(index.get(key)).toBeFalsy();
});

it("accepts Kitsu-only datasets and never uses IMDb to revive a duplicate Kitsu entry", async () => {
    const file = path.join(root, "catalog/series/test.json");
    await fs.writeFile(file, JSON.stringify({ metas: [meta(1), meta(1), meta(2)] }));
    const kitsuOnly = await convertCatalogs(root, [row(1, 10)]);
    expect(kitsuOnly.report).toMatchObject({ kitsu: 1, imdb: 0, omitted: 1, duplicates: 1 });
    const withFallback = await convertCatalogs(root, [row(1, 10, "tt1111111")]);
    expect(withFallback.converted.get("catalog/series/test.json")?.metas.map(item => item.id)).toEqual(["kitsu:10"]);
});

it("rejects an oversized streamed body without relying on Content-Length", async () => {
    const network = jest.spyOn(global, "fetch").mockResolvedValue(new Response(new Uint8Array(16 * 1024 * 1024 + 1)));
    await expect(downloadMappings()).rejects.toThrow("16 MiB");
    expect(network).toHaveBeenCalledTimes(1);
});

it.each([[], {}, [row(99)], [row(99, 99)]])("refuses unusable datasets or a wholly empty conversion", async rows => {
    await expect(convertCatalogs(root, rows)).rejects.toThrow();
});

it.each(["network", "429", "503"])("retries a transient %s failure only once", async failure => {
    const network = jest.spyOn(global, "fetch");
    if (failure === "network") network.mockRejectedValueOnce(new Error("network"));
    else network.mockResolvedValueOnce(new Response("unavailable", { status: Number(failure), headers: { "Retry-After": "3" } }));
    network.mockResolvedValueOnce(new Response(JSON.stringify([row(1, 1)])));
    const timer = jest.spyOn(global, "setTimeout").mockImplementation(((callback: () => void) => { callback(); return 0; }) as any);
    expect(await downloadMappings()).toEqual([row(1, 1)]);
    expect(network).toHaveBeenCalledTimes(2);
    expect(timer).toHaveBeenCalledWith(expect.any(Function), failure === "network" ? 2000 : 3000);
});

it("does not retry malformed, forbidden, oversized or excessively delayed responses", async () => {
    const network = jest.spyOn(global, "fetch");
    for (const response of [new Response("invalid"), new Response("forbidden", { status: 403 }), new Response("", { headers: { "content-length": String(17 * 1024 * 1024) } }), new Response("retry", { status: 429, headers: { "Retry-After": "120" } })]) {
        network.mockResolvedValueOnce(response);
        await expect(downloadMappings()).rejects.toThrow();
    }
    expect(network).toHaveBeenCalledTimes(4);
});

it("stops after the second transient failure", async () => {
    const network = jest.spyOn(global, "fetch").mockResolvedValue(new Response("unavailable", { status: 503 }));
    jest.spyOn(global, "setTimeout").mockImplementation(((callback: () => void) => { callback(); return 0; }) as any);
    await expect(downloadMappings()).rejects.toThrow("503");
    expect(network).toHaveBeenCalledTimes(2);
});

it("builds one readable/mapped export with verified arbitrary offsets and no source changes", async () => {
    await fs.unlink(path.join(root, "catalog/series/test.json"));
    const manifest = Manifest.default(path.join(root, "manifest.json"));
    await manifest.writeToFile();
    await refreshCatalogs(root, new Date(), true, async () => ({ series: [meta(1), meta(2), meta(3)], movie: [] }));
    const source = await fs.readFile(path.join(root, "catalog/series/latest_anime_seasons.json"));
    const network = jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify([row(1, 10), row(2, undefined, "tt2222222")])));
    const result = await buildAllPages(root);
    expect(network).toHaveBeenCalledTimes(1);
    const verification = await verifyPages(root, { mixed: true });
    expect(verification.bytes).toBe(result.bytes);
    expect(verification.files).toBe(result.files);
    const body = await fs.readFile(path.join(root, ".pages/catalog/series/latest_anime_seasons.json"), "utf8");
    expect(body).toContain('\n  "metas"');
    expect(JSON.parse(body).metas.map((m: any) => m.id)).toEqual(["kitsu:10", "tt2222222"]);
    expect(await fs.readFile(path.join(root, "catalog/series/latest_anime_seasons.json"))).toEqual(source);
    network.mockResolvedValue(new Response("forbidden", { status: 403 }));
    await expect(buildAllPages(root)).rejects.toThrow("403");
    expect(await fs.readFile(path.join(root, ".pages/catalog/series/latest_anime_seasons.json"), "utf8")).toBe(body);
});

it("accepts only canonical Kitsu/IMDb IDs in published previews", () => {
    for (const id of ["kitsu:1", "tt1234567"]) expect(() => validateMeta({ ...meta(1), id }, "series", "mixed")).not.toThrow();
    for (const id of ["anilist:1", "kitsu:01", "kitsu:0", "kitsu:9007199254740992", "tt1"]) expect(() => validateMeta({ ...meta(1), id }, "series", "mixed")).toThrow();
});
