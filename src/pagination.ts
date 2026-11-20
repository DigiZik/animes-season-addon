import { promises as fs } from "fs";
import path from "path";

const PAGES_MAX_BYTES = 1_000_000_000;
const PAGINATED_ID = "com.digizik.animes-season-addon.paginated";

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
export type BuildOptions = { root?: string; pageSize?: number; maxBytes?: number };
export type BuildResult = { outputDir: string; pageSize: number; catalogs: number; variants: number; files: number; bytes: number };

export function parsePageSize(value: string | undefined): number {
    if (value === undefined || value === "") return 20;
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new Error("PAGINATION_PAGE_SIZE must be a positive safe integer (for example 20, 30, or 50).");
    }
    return Number(value);
}

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

async function readSources(root: string, manifest: Manifest): Promise<Source[]> {
    const sources: Source[] = [];
    for (const catalog of manifest.catalogs) {
        const genre = catalog.extra?.find(extra => extra.name === "genre");
        const variants: (string | undefined)[] = genre?.isRequired ? [] : [undefined];
        variants.push(...(genre?.options || []));
        for (const option of variants) {
            const relativePath = path.join("catalog", catalog.type,
                option === undefined ? `${catalog.id}.json` : path.join(catalog.id, `genre=${option}.json`));
            const data = await readJson(path.join(root, relativePath));
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

function* pages(sources: Source[], pageSize: number): Generator<{ paths: string[]; body: string }> {
    for (const source of sources) {
        const body = (skip: number) => '{"metas":[' + source.serialized.slice(skip, skip + pageSize).join(",") + ']}';
        const first = body(0);
        yield { paths: pagePaths(source), body: first };
        for (let skip = 0; skip <= source.serialized.length + pageSize; skip++) {
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
    const pageSize = options.pageSize ?? parsePageSize(process.env.PAGINATION_PAGE_SIZE);
    if (!Number.isSafeInteger(pageSize) || pageSize <= 0) throw new Error("PAGINATION_PAGE_SIZE must be a positive safe integer.");
    const maxBytes = Math.min(options.maxBytes ?? PAGES_MAX_BYTES, PAGES_MAX_BYTES);
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("Invalid Pages size limit.");
    const manifest = await readJson(path.join(root, "manifest.json"));
    validateManifest(manifest);
    const sources = await readSources(root, manifest);
    const paginated = JSON.parse(JSON.stringify(manifest)) as Manifest;
    paginated.id = PAGINATED_ID;
    paginated.version = "1.0.0";
    paginated.name = `${manifest.name} (Paginated)`;
    for (const catalog of paginated.catalogs) {
        catalog.extra = [...(catalog.extra || []).filter(extra => extra.name !== "skip"), { name: "skip", isRequired: false }];
        catalog.extraSupported = [...new Set([...(catalog.extraSupported || []), ...catalog.extra.map(extra => extra.name)])];
    }
    const manifestBody = JSON.stringify(paginated, null, 2) + "\n";
    const originals = ["manifest.json", ...await listFiles(root, "catalog")];
    let bytes = Buffer.byteLength(manifestBody);
    let files = originals.length + 2; // The generated manifest and .nojekyll.
    for (const relative of originals) bytes += (await fs.stat(path.join(root, relative))).size;
    const checkBudget = () => {
        if (bytes > maxBytes) throw new Error(`Generated site exceeds the GitHub Pages size limit (${maxBytes} bytes).`);
    };
    checkBudget();
    // A lower bound also rejects impractically large page sizes before iterating offsets.
    for (const source of sources) {
        const aliases = source.genre === undefined ? 1 : 2;
        if (pageSize > Math.floor(maxBytes / (aliases * Buffer.byteLength('{"metas":[]}')))) {
            throw new Error("PAGINATION_PAGE_SIZE would exceed the GitHub Pages size limit.");
        }
    }
    // Prefix byte counts preflight the exact size without constructing page strings.
    for (const source of sources) {
        const count = source.serialized.length;
        const aliases = source.genre === undefined ? 1 : 2;
        const pageBytes = (skip: number) => {
            const start = Math.min(skip, count);
            const end = Math.min(skip + pageSize, count);
            return 12 + source.prefixBytes[end] - source.prefixBytes[start] + Math.max(0, end - start - 1);
        };
        bytes += pageBytes(0);
        files++;
        for (let skip = 0; skip < count; skip++) bytes += pageBytes(skip) * aliases;
        bytes += 12 * (pageSize + 1) * aliases;
        files += (count + pageSize + 1) * aliases;
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
        await fs.copyFile(path.join(root, relative), target);
    }
    const manifestPath = path.join(outputDir, "paginated", "manifest.json");
    await ensureParent(manifestPath);
    await fs.writeFile(manifestPath, manifestBody);
    await fs.writeFile(path.join(outputDir, ".nojekyll"), "");
    const pageDirectories = new Set(sources.map(source => path.join(outputDir, "paginated", "catalog", source.catalog.type, source.catalog.id)));
    await Promise.all([...pageDirectories].map(directory => fs.mkdir(directory, { recursive: true })));
    // Bound filesystem pressure and queued payloads instead of queueing the whole site.
    let pending: Promise<void>[] = [];
    for (const page of pages(sources, pageSize)) {
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
    return { outputDir, pageSize, catalogs: manifest.catalogs.length, variants: sources.length, files, bytes };
}

if (require.main === module) {
    buildPages().then(result => {
        console.log(`Built ${result.catalogs} catalogs / ${result.variants} variants with page size ${result.pageSize}: ${result.files} files, ${result.bytes} bytes in ${result.outputDir}`);
    }).catch(error => {
        console.error(`Pages build failed: ${(error as Error).message}`);
        process.exitCode = 1;
    });
}
