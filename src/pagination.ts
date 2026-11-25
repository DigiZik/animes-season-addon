import { promises as fs } from "fs";
import path from "path";

const PAGES_MAX_BYTES = 1_000_000_000;
const PAGINATED_ID = "com.digizik.animes-season-addon.paginated";
export const PAGE_SIZE = 100;

type Meta = { id: string; type: string; name: string; [key: string]: unknown };
type Extra = { name: string; options?: string[]; isRequired?: boolean };
type Catalog = {
    id: string;
    type: string;
    name: string;
    extra?: Extra[];
    extraSupported?: string[];
};
type Manifest = {
    id: string;
    version: string;
    name: string;
    catalogs: Catalog[];
    [key: string]: unknown;
};
type Source = { catalog: Catalog; genre?: string; serialized: string[]; prefixBytes: number[] };
export type BuildOptions = { root?: string; maxBytes?: number; catalogs?: Map<string, { metas: Meta[] }>; publishedManifest?: Manifest };
export type BuildResult = { outputDir: string; pageSize: number; catalogs: number; variants: number; files: number; bytes: number };

function segment(value: unknown, label: string): asserts value is string {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
        throw new Error(`Invalid ${label}: expected a safe catalog path segment.`);
    }
}

function validateManifest(value: any): asserts value is Manifest {
    if (!value || typeof value.id !== "string" || typeof value.name !== "string" ||
        typeof value.version !== "string" || !Array.isArray(value.catalogs) || !value.catalogs.length) {
        throw new Error("Invalid manifest.json: expected an addon identity and nonempty catalogs array.");
    }
    const seen = new Set<string>();
    for (const catalog of value.catalogs) {
        if (!catalog || typeof catalog.name !== "string") throw new Error("Invalid catalog description.");
        segment(catalog.type, "catalog type");
        segment(catalog.id, "catalog ID");
        const key = `${catalog.type}/${catalog.id}`;
        if (seen.has(key)) throw new Error(`Duplicate catalog: ${key}`);
        seen.add(key);
        if (catalog.extra !== undefined && !Array.isArray(catalog.extra)) throw new Error(`Invalid extras for ${key}`);
        if (catalog.extraSupported !== undefined && (!Array.isArray(catalog.extraSupported) ||
            catalog.extraSupported.some((name: unknown) => typeof name !== "string"))) {
            throw new Error(`Invalid extraSupported for ${key}`);
        }
        const extras = new Set<string>();
        for (const extra of catalog.extra || []) {
            if (!extra || (extra.name !== "genre" && extra.name !== "skip") || extras.has(extra.name)) {
                throw new Error(`Unsupported or duplicate extra for ${key}`);
            }
            extras.add(extra.name);
            if (extra.name === "genre") {
                if (!Array.isArray(extra.options) || !extra.options.length) throw new Error(`Missing genre options for ${key}`);
                for (const genre of extra.options) segment(genre, "genre option");
                if (new Set(extra.options).size !== extra.options.length) throw new Error(`Duplicate genre options for ${key}`);
            }
        }
    }
}

export function uniqueMetas(items: unknown, type: string, label: string): Meta[] {
    if (!Array.isArray(items)) throw new Error(`Invalid catalog ${label}: missing metas array.`);
    const seen = new Set<string>();
    return items.filter((meta, index): meta is Meta => {
        if (!meta || typeof meta.id !== "string" || !meta.id.length || meta.type !== type ||
            typeof meta.name !== "string" || !meta.name.length) {
            throw new Error(`Invalid metadata at ${label} item ${index}: expected id, matching type, and name.`);
        }
        const key = `${meta.type}:${meta.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

async function readJson(file: string): Promise<any> {
    try {
        return JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
        throw new Error(`Cannot read valid JSON from ${file}: ${(error as Error).message}`);
    }
}

async function readSources(root: string, manifest: Manifest, catalogs?: Map<string, { metas: Meta[] }>): Promise<Source[]> {
    const sources: Source[] = [];
    for (const catalog of manifest.catalogs) {
        const genre = catalog.extra?.find(extra => extra.name === "genre");
        const variants: (string | undefined)[] = genre?.isRequired ? [] : [undefined];
        variants.push(...(genre?.options || []));
        for (const option of variants) {
            const relativePath = path.join("catalog", catalog.type,
                option === undefined ? `${catalog.id}.json` : path.join(catalog.id, `genre=${option}.json`));
            const data = catalogs ? catalogs.get(relativePath.replace(/\\/g, "/")) : await readJson(path.join(root, relativePath));
            const serialized = uniqueMetas(data?.metas, catalog.type, relativePath).map(meta => JSON.stringify(meta));
            const prefixBytes = [0];
            for (const meta of serialized) prefixBytes.push(prefixBytes[prefixBytes.length - 1] + Buffer.byteLength(meta));
            sources.push({ catalog, genre: option, serialized, prefixBytes });
        }
    }
    return sources;
}

function pagePaths(source: Source, skip?: number): string[] {
    const base = path.join("paginated", "catalog", source.catalog.type, source.catalog.id);
    if (skip === undefined) {
        return [source.genre === undefined ? `${base}.json` : path.join(base, `genre=${source.genre}.json`)];
    }
    if (source.genre === undefined) return [path.join(base, `skip=${skip}.json`)];
    return [path.join(base, `skip=${skip}&genre=${source.genre}.json`),
        path.join(base, `genre=${source.genre}&skip=${skip}.json`)];
}

function lastOffset(count: number): number {
    // Every possible next request after the last title for steps up to PAGE_SIZE.
    return count + PAGE_SIZE - 1;
}

function* pages(sources: Source[]): Generator<{ paths: string[]; body: string }> {
    for (const source of sources) {
        const body = (skip: number) => '{"metas":[' + source.serialized.slice(skip, skip + PAGE_SIZE).join(",") + ']}';
        const first = body(0);
        yield { paths: pagePaths(source), body: first };
        for (let skip = 0; skip <= lastOffset(source.serialized.length); skip++) {
            yield { paths: pagePaths(source, skip), body: skip === 0 ? first : body(skip) };
        }
    }
}

// Refuse links: the Pages artifact must contain only regular files/directories.
async function listFiles(root: string, relative: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
        const file = path.join(relative, entry.name);
        if (entry.isDirectory()) files.push(...await listFiles(root, file));
        else if (entry.isFile()) files.push(file);
        else throw new Error(`Cannot publish non-regular file: ${file}`);
    }
    return files;
}

export async function buildPages(options: BuildOptions = {}): Promise<BuildResult> {
    const root = path.resolve(options.root || process.cwd());
    const maxBytes = Math.min(options.maxBytes ?? PAGES_MAX_BYTES, PAGES_MAX_BYTES);
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("Invalid Pages size limit.");
    const manifest = options.publishedManifest || await readJson(path.join(root, "manifest.json"));
    validateManifest(manifest);
    const sources = await readSources(root, manifest, options.catalogs);
    const paginated = JSON.parse(JSON.stringify(manifest)) as Manifest;
    paginated.id = PAGINATED_ID;
    paginated.version = options.publishedManifest?.version || "1.4.1";
    paginated.name = `${manifest.name} (Paginated)`;
    for (const catalog of paginated.catalogs) {
        catalog.extra = [...(catalog.extra || []).filter(extra => extra.name !== "skip"), { name: "skip", isRequired: false }];
        catalog.extraSupported = [...new Set([...(catalog.extraSupported || []), ...catalog.extra.map(extra => extra.name)])];
    }
    const manifestBody = JSON.stringify(paginated, null, 2) + "\n";
    const originals = ["manifest.json", ...await listFiles(root, "catalog")];
    const originalBodies = new Map<string, Buffer>();
    for (const relative of originals) {
        const mapped = options.catalogs?.get(relative.replace(/\\/g, "/"));
        if (options.catalogs && relative !== "manifest.json" && !mapped) throw new Error(`Missing converted catalog: ${relative}`);
        const body = relative === "manifest.json" && options.publishedManifest ? options.publishedManifest : mapped;
        originalBodies.set(relative, body ? Buffer.from(JSON.stringify(body, null, 2) + "\n") : await fs.readFile(path.join(root, relative)));
    }
    let bytes = Buffer.byteLength(manifestBody);
    let files = originals.length + 2; // The generated manifest and .nojekyll.
    for (const body of originalBodies.values()) bytes += body.length;
    const checkBudget = () => {
        if (bytes > maxBytes) throw new Error(`Generated site exceeds the GitHub Pages size limit (${maxBytes} bytes).`);
    };
    checkBudget();
    // Prefix byte counts preflight the exact size without constructing page strings.
    for (const source of sources) {
        const count = source.serialized.length;
        const aliases = source.genre === undefined ? 1 : 2;
        const pageBytes = (skip: number) => {
            const start = Math.min(skip, count);
            const end = Math.min(skip + PAGE_SIZE, count);
            return 12 + source.prefixBytes[end] - source.prefixBytes[start] + Math.max(0, end - start - 1);
        };
        bytes += pageBytes(0);
        files++;
        for (let skip = 0; skip < count; skip++) bytes += pageBytes(skip) * aliases;
        const offsets = lastOffset(count) + 1;
        bytes += 12 * (offsets - count) * aliases;
        files += offsets * aliases;
        checkBudget();
    }
    const outputDir = path.resolve(root, ".pages");
    if (path.dirname(outputDir) !== root || outputDir === root) throw new Error("Unsafe Pages output directory.");
    await fs.rm(outputDir, { recursive: true, force: true });
    const directories = new Set<string>();
    const ensureParent = async (file: string) => {
        const parent = path.dirname(file);
        if (!directories.has(parent)) {
            await fs.mkdir(parent, { recursive: true });
            directories.add(parent);
        }
    };
    for (const relative of originals) {
        const target = path.join(outputDir, relative);
        await ensureParent(target);
        await fs.writeFile(target, originalBodies.get(relative)!);
    }
    const manifestPath = path.join(outputDir, "paginated", "manifest.json");
    await ensureParent(manifestPath);
    await fs.writeFile(manifestPath, manifestBody);
    await fs.writeFile(path.join(outputDir, ".nojekyll"), "");
    const pageDirectories = new Set(sources.map(source => path.join(outputDir, "paginated", "catalog", source.catalog.type, source.catalog.id)));
    await Promise.all([...pageDirectories].map(directory => fs.mkdir(directory, { recursive: true })));
    // Bound filesystem pressure and queued payloads instead of queueing the whole site.
    let pending: Promise<void>[] = [];
    for (const page of pages(sources)) {
        for (const relative of page.paths) {
            const target = path.join(outputDir, relative);
            pending.push(fs.writeFile(target, page.body));
            if (pending.length === 16) {
                await Promise.all(pending);
                pending = [];
            }
        }
    }
    await Promise.all(pending);
    return { outputDir, pageSize: PAGE_SIZE, catalogs: manifest.catalogs.length, variants: sources.length, files, bytes };
}
