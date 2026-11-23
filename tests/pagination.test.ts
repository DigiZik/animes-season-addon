import { promises as fs } from "fs";
import path from "path";
import os from "os";
import http from "http";
import { createHash } from "crypto";
import { buildPages, parsePageSize } from "../src/pagination";
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

describe("page size configuration", () => {
    it.each([[undefined, 20], ["", 20], ["20", 20], ["30", 30], ["50", 50], ["1", 1]])("parses %s", (value, expected) => {
        expect(parsePageSize(value as string | undefined)).toBe(expected);
    });
    it.each(["0", "-1", "1.5", "abc", " 20", "20 ", "1e2", "01", "9007199254740992"])("rejects %s", value => {
        expect(() => parsePageSize(value)).toThrow("PAGINATION_PAGE_SIZE");
    });
});

it.each([20, 30, 50])("traverses all four catalogs and filters with page size %i", async pageSize => {
    const metas = Array.from({ length: 65 }, (_, i) => item(i));
    metas.splice(2, 0, { ...item(0), name: "Duplicate must not replace first" });
    const catalogs = await fixture(metas);
    const sourceManifest = await fs.readFile(path.join(root, "manifest.json"));
    const sourceHash = await digest(path.join(root, "catalog"));
    const result = await buildPages({ root, pageSize });
    expect(result.catalogs).toBe(4);
    expect(result.variants).toBe(8);
    expect(result.bytes).toBeLessThan(1_000_000_000);
    const manifest = await json(".pages/paginated/manifest.json");
    expect(manifest.id).toBe("com.digizik.animes-season-addon.paginated");
    expect(manifest.version).toBe("1.4.0");
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
            const expected = Array.from({ length: 65 }, (_, index) => item(index, entry.type));
            expect((await json(first)).metas).toEqual(expected.slice(0, pageSize));
            const collected = [];
            for (let skip = 0; skip <= 65 + pageSize; skip++) {
                const suffix = genre === undefined ? `skip=${skip}` : `skip=${skip}&genre=${genre}`;
                const actual = (await json(`${base}/${suffix}.json`)).metas;
                expect(actual).toEqual(expected.slice(skip, skip + pageSize));
                if (genre !== undefined) expect(await json(`${base}/genre=${genre}&skip=${skip}.json`)).toEqual({ metas: actual });
                if (skip % pageSize === 0 && skip < 65) collected.push(...actual);
            }
            expect(collected).toEqual(expected);
        }
    }
    expect(await fs.readFile(path.join(root, "manifest.json"))).toEqual(sourceManifest);
    expect(await fs.readFile(path.join(root, ".pages/manifest.json"))).toEqual(sourceManifest);
    expect(await digest(path.join(root, "catalog"))).toBe(sourceHash);
    expect(await digest(path.join(root, ".pages/catalog"))).toBe(sourceHash);
    const generatedHash = await digest(result.outputDir);
    await buildPages({ root, pageSize });
    expect(await digest(result.outputDir)).toBe(generatedHash);
});

it.each([0, 20, 40])("handles %i items including empty and exact full pages", async count => {
    await fixture(Array.from({ length: count }, (_, i) => item(i)));
    await buildPages({ root, pageSize: 20 });
    const base = ".pages/paginated/catalog/series/latest_anime_seasons";
    expect((await json(`${base}.json`)).metas).toHaveLength(Math.min(20, count));
    expect(await json(`${base}/skip=${count}.json`)).toEqual({ metas: [] });
    expect(await json(`${base}/skip=${count + 20}.json`)).toEqual({ metas: [] });
});

it("removes stale pages and removed catalog variants on rebuild", async () => {
    await fixture();
    await buildPages({ root, pageSize: 20 });
    await fixture([item(1)]);
    const manifest = await json("manifest.json");
    manifest.catalogs = manifest.catalogs.filter((entry: any) => entry.type === "series");
    await write("manifest.json", manifest);
    await buildPages({ root, pageSize: 20 });
    await expect(fs.stat(path.join(root, ".pages/paginated/catalog/series/latest_anime_seasons/skip=45.json"))).rejects.toThrow();
    await expect(fs.stat(path.join(root, ".pages/paginated/catalog/movie"))).rejects.toThrow();
});

it("preflights the exact UTF-8 file size without rendering metadata twice", async () => {
    await fixture([{ ...item(1), name: "日本語 🎬", description: "Été — 海" }]);
    const built = await buildPages({ root, pageSize: 20 });
    const verified = await verifyPages(root, 20);
    expect(verified.bytes).toBe(built.bytes);
    expect(verified.files).toBe(built.files);
    const before = await digest(built.outputDir);
    await expect(buildPages({ root, pageSize: 20, maxBytes: built.bytes - 1 })).rejects.toThrow("size limit");
    expect(await digest(built.outputDir)).toBe(before);
});

it("rejects invalid or missing source data before replacing the previous output", async () => {
    await fixture();
    await buildPages({ root, pageSize: 20 });
    const before = await digest(path.join(root, ".pages"));
    await write("catalog/series/archive_anime_seasons/genre=2025.json", { metas: [{ id: "tt1", type: "movie", name: "Wrong type" }] });
    await expect(buildPages({ root, pageSize: 20 })).rejects.toThrow("Invalid metadata");
    expect(await digest(path.join(root, ".pages"))).toBe(before);
    await fs.unlink(path.join(root, "catalog/series/archive_anime_seasons/genre=2025.json"));
    await expect(buildPages({ root, pageSize: 20 })).rejects.toThrow("Cannot read valid JSON");
    expect(await digest(path.join(root, ".pages"))).toBe(before);
});

it("rejects invalid manifests, unsafe paths, page sizes, and oversized sites", async () => {
    await fixture();
    await expect(buildPages({ root, pageSize: 0 })).rejects.toThrow("PAGINATION_PAGE_SIZE");
    await expect(buildPages({ root, pageSize: 1.5 })).rejects.toThrow("PAGINATION_PAGE_SIZE");
    await expect(buildPages({ root, pageSize: Number.MAX_SAFE_INTEGER })).rejects.toThrow("size limit");
    await expect(buildPages({ root, pageSize: 20, maxBytes: 10 })).rejects.toThrow("size limit");
    const manifest = await json("manifest.json");
    manifest.catalogs[0].id = "../escape";
    await write("manifest.json", manifest);
    await expect(buildPages({ root, pageSize: 20 })).rejects.toThrow("safe catalog path");
    await write("manifest.json", { catalogs: [] });
    await expect(buildPages({ root, pageSize: 20 })).rejects.toThrow("Invalid manifest");
});

it.each([20, 30, 50])("paginates the full 2025 archive without losing anime identities at size %i", async pageSize => {
    const sourcePath = path.resolve(__dirname, "../../catalog/series/archive_anime_seasons/genre=2025.json");
    const data = JSON.parse(await fs.readFile(sourcePath, "utf8"));
    expect(data.metas.length).toBeGreaterThan(pageSize);
    await fixture([]);
    const manifest = await json("manifest.json");
    manifest.catalogs = [catalog("series", true)];
    await write("manifest.json", manifest);
    await write("catalog/series/archive_anime_seasons/genre=2025.json", data);
    await buildPages({ root, pageSize });
    const seen = new Set<string>();
    const expected = data.metas.filter((meta: any) => {
        const key = `${meta.type}:${meta.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    expect(expected).toHaveLength(new Set(data.metas.map((meta: any) => meta.id)).size);
    const collected = [];
    for (let skip = 0; skip < expected.length; skip += pageSize) {
        const page = await json(`.pages/paginated/catalog/series/archive_anime_seasons/skip=${skip}&genre=2025.json`);
        collected.push(...page.metas);
    }
    expect(collected).toEqual(expected);
    const terminal = Math.ceil(expected.length / pageSize) * pageSize;
    expect(await json(`.pages/paginated/catalog/series/archive_anime_seasons/skip=${terminal}&genre=2025.json`)).toEqual({ metas: [] });
});

it("serves first pages, both parameter orders, arbitrary offsets, and terminal JSON over HTTP", async () => {
    await fixture(Array.from({ length: 45 }, (_, i) => item(i)));
    const result = await buildPages({ root, pageSize: 20 });
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
        expect((await fetchJson("paginated/catalog/series/latest_anime_seasons.json")).metas).toHaveLength(20);
        const route = "paginated/catalog/series/archive_anime_seasons/";
        expect(await fetchJson(route + "skip=20&genre=2025.json")).toEqual(await fetchJson(route + "genre=2025&skip=20.json"));
        expect((await fetchJson(route + "skip=19&genre=2025.json")).metas[0]).toEqual(item(19));
        expect((await fetchJson(route + "skip=40&genre=2025.json")).metas).toHaveLength(5);
        expect(await fetchJson(route + "skip=60&genre=2025.json")).toEqual({ metas: [] });
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});
