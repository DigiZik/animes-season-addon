import { promises as fs } from "fs";
import path from "path";
import os from "os";
import http from "http";
import { createHash } from "crypto";
import { buildPages, PAGE_SIZE } from "../src/pagination";
import { verifyPages } from "../src/verify-pages";

jest.setTimeout(120000);
let root: string;
const item = (index: number, type = "series") => ({
    id: `tt${1000000 + index}`, type, name: `Title ${index}`, poster: `https://example.com/${index}.jpg`,
    description: "Keep metadata", behaviorHints: { defaultVideoId: `tt${1000000 + index}` }
});
const catalog = (type: string, archive = false) => ({
    type, id: archive ? "archive_anime_seasons" : "latest_anime_seasons",
    name: archive ? "Anime Years" : "Anime Seasons",
    extra: [{ name: "genre", options: archive ? ["2025"] : ["FALL", "WINTER"], isRequired: archive }],
    extraSupported: ["genre"]
});

async function write(relative: string, data: unknown) {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data, null, 2));
}
async function json(relative: string): Promise<any> {
    return JSON.parse(await fs.readFile(path.join(root, relative), "utf8"));
}
async function fixture(metas: any[] = Array.from({ length: 45 }, (_, i) => item(i))) {
    const catalogs = [catalog("series"), catalog("movie"), catalog("series", true), catalog("movie", true)];
    await write("manifest.json", { id: "original", version: "1.20.1", name: "Anime", resources: ["catalog"],
        types: ["series", "movie"], catalogs, idPrefixes: ["tt", "kitsu"], lastUpdatedAt: "2026-09-01T00:00:00.000Z" });
    for (const entry of catalogs) {
        const data = { metas: metas.map(meta => ({ ...meta, type: entry.type })) };
        if (entry.id === "latest_anime_seasons") await write(`catalog/${entry.type}/${entry.id}.json`, data);
        for (const genre of entry.extra[0].options) await write(`catalog/${entry.type}/${entry.id}/genre=${genre}.json`, data);
    }
    return catalogs;
}
async function digest(directory: string): Promise<string> {
    const hash = createHash("sha256");
    async function visit(relative: string) {
        const entries = (await fs.readdir(path.join(directory, relative), { withFileTypes: true }))
            .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
        for (const entry of entries) {
            const file = path.join(relative, entry.name);
            if (entry.isDirectory()) await visit(file);
            else { hash.update(file); hash.update(await fs.readFile(path.join(directory, file))); }
        }
    }
    await visit("");
    return hash.digest("hex");
}

beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "anime-pages-test-")); });
afterEach(async () => {
    // root is assigned only by mkdtemp under the OS temporary directory.
    if (path.dirname(root) !== path.resolve(os.tmpdir())) throw new Error("Unsafe test cleanup path");
    await fs.rm(root, { recursive: true, force: true });
});

it("traverses all four catalogs and filters with fixed 100-item responses", async () => {
    const metas = Array.from({ length: 237 }, (_, i) => item(i));
    metas.splice(2, 0, { ...item(0), name: "Duplicate must not replace first" });
    const catalogs = await fixture(metas);
    const sourceManifest = await fs.readFile(path.join(root, "manifest.json"));
    const sourceHash = await digest(path.join(root, "catalog"));
    const result = await buildPages({ root });
    expect(result.pageSize).toBe(100);
    expect(result.catalogs).toBe(4);
    expect(result.variants).toBe(8);
    expect(result.bytes).toBeLessThan(1_000_000_000);
    const manifest = await json(".pages/paginated/manifest.json");
    expect(manifest.id).toBe("com.digizik.animes-season-addon.paginated");
    expect(manifest.version).toBe("1.4.1");
    expect(manifest.name).toBe("Anime (Paginated)");
    for (let i = 0; i < catalogs.length; i++) {
        expect(manifest.catalogs[i].extra[0]).toEqual(catalogs[i].extra[0]);
        expect(manifest.catalogs[i].extra).toContainEqual({ name: "skip", isRequired: false });
        expect(manifest.catalogs[i].extraSupported).toEqual(["genre", "skip"]);
        const entry = catalogs[i];
        const genres = entry.extra[0].isRequired ? ["2025"] : [undefined, "FALL", "WINTER"];
        for (const genre of genres) {
            const base = `.pages/paginated/catalog/${entry.type}/${entry.id}`;
            const first = genre === undefined ? `${base}.json` : `${base}/genre=${genre}.json`;
            const expected = Array.from({ length: 237 }, (_, index) => item(index, entry.type));
            expect((await json(first)).metas).toEqual(expected.slice(0, PAGE_SIZE));
            const collected = [];
            for (let skip = 0; skip < expected.length + PAGE_SIZE; skip++) {
                const suffix = genre === undefined ? `skip=${skip}` : `skip=${skip}&genre=${genre}`;
                const actual = (await json(`${base}/${suffix}.json`)).metas;
                expect(actual).toEqual(expected.slice(skip, skip + PAGE_SIZE));
                if (genre !== undefined) expect(await json(`${base}/genre=${genre}&skip=${skip}.json`)).toEqual({ metas: actual });
                if (skip % PAGE_SIZE === 0 && skip < expected.length) collected.push(...actual);
            }
            expect(collected).toEqual(expected);
        }
    }
    expect(await fs.readFile(path.join(root, "manifest.json"))).toEqual(sourceManifest);
    expect(await fs.readFile(path.join(root, ".pages/manifest.json"))).toEqual(sourceManifest);
    expect(await digest(path.join(root, "catalog"))).toBe(sourceHash);
    expect(await digest(path.join(root, ".pages/catalog"))).toBe(sourceHash);
    const generatedHash = await digest(result.outputDir);
    await buildPages({ root });
    expect(await digest(result.outputDir)).toBe(generatedHash);
});

it.each([0, 1, 99, 100, 101, 200])("handles %i items including empty and exact full pages", async count => {
    await fixture(Array.from({ length: count }, (_, i) => item(i)));
    await buildPages({ root });
    const base = ".pages/paginated/catalog/series/latest_anime_seasons";
    expect((await json(`${base}.json`)).metas).toHaveLength(Math.min(PAGE_SIZE, count));
    expect(await json(`${base}/skip=${count}.json`)).toEqual({ metas: [] });
    expect(await json(`${base}/skip=${count + PAGE_SIZE - 1}.json`)).toEqual({ metas: [] });
    await expect(json(`${base}/skip=${count + PAGE_SIZE}.json`)).rejects.toMatchObject({ code: "ENOENT" });
});

it("removes stale pages and removed catalog variants on rebuild", async () => {
    await fixture();
    await buildPages({ root });
    await fixture([item(1)]);
    const manifest = await json("manifest.json");
    manifest.catalogs = manifest.catalogs.filter((entry: any) => entry.type === "series");
    await write("manifest.json", manifest);
    await buildPages({ root });
    await expect(fs.stat(path.join(root, ".pages/paginated/catalog/series/latest_anime_seasons/skip=144.json"))).rejects.toThrow();
    await expect(fs.stat(path.join(root, ".pages/paginated/catalog/movie"))).rejects.toThrow();
});

it("preflights the exact UTF-8 file size without rendering metadata twice", async () => {
    await fixture([{ ...item(1), name: "日本語 🎬", description: "Été — 海" }]);
    const built = await buildPages({ root });
    const verified = await verifyPages(root);
    expect(verified.bytes).toBe(built.bytes);
    expect(verified.files).toBe(built.files);
    const before = await digest(built.outputDir);
    await expect(buildPages({ root, maxBytes: built.bytes - 1 })).rejects.toThrow("size limit");
    expect(await digest(built.outputDir)).toBe(before);
});

it("includes the logo unchanged and counts its bytes in the artifact budget", async () => {
    await fixture([]);
    const logo = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    await fs.writeFile(path.join(root, "logo.png"), logo);
    const built = await buildPages({ root });
    expect(await fs.readFile(path.join(built.outputDir, "logo.png"))).toEqual(logo);
    expect((await verifyPages(root)).bytes).toBe(built.bytes);
    await expect(buildPages({ root, maxBytes: built.bytes - 1 })).rejects.toThrow("size limit");
});

it("rejects invalid or missing source data before replacing the previous output", async () => {
    await fixture();
    await buildPages({ root });
    const before = await digest(path.join(root, ".pages"));
    await write("catalog/series/archive_anime_seasons/genre=2025.json", { metas: [{ id: "tt1", type: "movie", name: "Wrong type" }] });
    await expect(buildPages({ root })).rejects.toThrow("Invalid metadata");
    expect(await digest(path.join(root, ".pages"))).toBe(before);
    await fs.unlink(path.join(root, "catalog/series/archive_anime_seasons/genre=2025.json"));
    await expect(buildPages({ root })).rejects.toThrow("Cannot read valid JSON");
    expect(await digest(path.join(root, ".pages"))).toBe(before);
});

it("rejects invalid manifests, unsafe paths, and oversized sites", async () => {
    await fixture();
    await expect(buildPages({ root, maxBytes: 10 })).rejects.toThrow("size limit");
    const manifest = await json("manifest.json");
    manifest.catalogs[0].id = "../escape";
    await write("manifest.json", manifest);
    await expect(buildPages({ root })).rejects.toThrow("safe catalog path");
    await write("manifest.json", { catalogs: [] });
    await expect(buildPages({ root })).rejects.toThrow("Invalid manifest");
});

it.each([20, 50, 100])("traverses the full 2025 archive in %i-item client windows", async clientSize => {
    const sourcePath = path.resolve(__dirname, "../../catalog/series/archive_anime_seasons/genre=2025.json");
    const data = JSON.parse(await fs.readFile(sourcePath, "utf8"));
    expect(data.metas.length).toBeGreaterThan(PAGE_SIZE);
    await fixture([]);
    const manifest = await json("manifest.json");
    manifest.catalogs = [catalog("series", true)];
    await write("manifest.json", manifest);
    await write("catalog/series/archive_anime_seasons/genre=2025.json", data);
    await buildPages({ root });
    const seen = new Set<string>();
    const expected = data.metas.filter((meta: any) => {
        const key = `${meta.type}:${meta.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    expect(expected).toHaveLength(new Set(data.metas.map((meta: any) => meta.id)).size);
    const collected = [];
    for (let skip = 0; skip < expected.length; skip += clientSize) {
        const page = await json(`.pages/paginated/catalog/series/archive_anime_seasons/skip=${skip}&genre=2025.json`);
        expect(page.metas).toEqual(expected.slice(skip, skip + PAGE_SIZE));
        collected.push(...page.metas.slice(0, clientSize));
    }
    expect(collected).toEqual(expected);
    const terminal = Math.ceil(expected.length / clientSize) * clientSize;
    expect(await json(`.pages/paginated/catalog/series/archive_anime_seasons/skip=${terminal}&genre=2025.json`)).toEqual({ metas: [] });
});

it("serves first pages, both parameter orders, arbitrary offsets, and terminal JSON over HTTP", async () => {
    await fixture(Array.from({ length: 45 }, (_, i) => item(i)));
    const manifest = await json("manifest.json");
    for (const entry of manifest.catalogs.filter((c: any) => c.id === "latest_anime_seasons")) {
        const base = path.join(root, "catalog", entry.type);
        await fs.rename(path.join(base, "latest_anime_seasons.json"), path.join(base, "trending_anime_seasons.json"));
        await fs.rename(path.join(base, "latest_anime_seasons"), path.join(base, "trending_anime_seasons"));
        for (const [oldLabel, newLabel] of [["FALL", "FALL (Sep - Nov)"], ["WINTER", "WINTER (Dec - Feb)"]]) {
            await fs.rename(path.join(base, "trending_anime_seasons", `genre=${oldLabel}.json`), path.join(base, "trending_anime_seasons", `genre=${newLabel}.json`));
        }
        entry.id = "trending_anime_seasons";
        entry.extra[0].options = ["FALL (Sep - Nov)", "WINTER (Dec - Feb)"];
    }
    await write("manifest.json", manifest);
    const result = await buildPages({ root });
    const prefix = "/animes-season-addon/";
    const server = http.createServer(async (request, response) => {
        try {
            const url = new URL(request.url || "/", "http://localhost");
            const relative = decodeURIComponent(url.pathname.slice(prefix.length));
            const target = path.resolve(result.outputDir, relative);
            if (!url.pathname.startsWith(prefix) || !target.startsWith(result.outputDir + path.sep)) throw new Error("Invalid path");
            response.setHeader("Content-Type", "application/json");
            response.end(await fs.readFile(target));
        } catch { response.statusCode = 404; response.end(); }
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
        const address = server.address() as { port: number };
        const base = `http://127.0.0.1:${address.port}${prefix}`;
        const fetchJson = async (url: string) => {
            const response = await fetch(base + url);
            expect(response.status).toBe(200);
            expect(response.headers.get("content-type")).toContain("application/json");
            return response.json() as Promise<any>;
        };
        expect((await fetchJson("paginated/manifest.json")).catalogs).toHaveLength(4);
        expect((await fetchJson("paginated/catalog/series/trending_anime_seasons.json")).metas).toHaveLength(45);
        const seasonal = "paginated/catalog/series/trending_anime_seasons/";
        const label = encodeURIComponent("FALL (Sep - Nov)");
        const filtered = await fetchJson(`${seasonal}genre=${label}&skip=20.json`);
        expect(filtered).toEqual(await fetchJson(`${seasonal}skip=20&genre=${label}.json`));
        expect(filtered.metas[0]).toEqual(item(20));
        const route = "paginated/catalog/series/archive_anime_seasons/";
        expect(await fetchJson(route + "skip=20&genre=2025.json")).toEqual(await fetchJson(route + "genre=2025&skip=20.json"));
        expect((await fetchJson(route + "skip=19&genre=2025.json")).metas[0]).toEqual(item(19));
        expect((await fetchJson(route + "skip=40&genre=2025.json")).metas).toHaveLength(5);
        expect(await fetchJson(route + "skip=60&genre=2025.json")).toEqual({ metas: [] });
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});
