import { promises as fs } from "fs";
import path from "path";
import assert from "assert";
import { validateMeta } from "./native-meta";
import { prepareCurrentYear } from "./current-year";
import { PAGE_SIZE } from "./pagination";

export async function verifyPages(root = process.cwd(), options: { output?: string; expectedId?: string; mixed?: boolean } = {}) {
    const pageSize = PAGE_SIZE;
    const output = options.output || path.join(root, ".pages");
    const read = async (relative: string) => JSON.parse(await fs.readFile(path.join(output, relative), "utf8"));
    const original = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
    const manifest = await read("paginated/manifest.json");
    assert.equal(manifest.id, options.expectedId || "com.digizik.animes-season-addon.paginated");
    assert.equal(manifest.catalogs.length, original.catalogs.length);
    if (options.mixed) {
        assert.deepStrictEqual(manifest.idPrefixes, ["kitsu", "tt"]);
        assert.deepStrictEqual((await read("manifest.json")).idPrefixes, ["kitsu", "tt"]);
        await prepareCurrentYear(output);
        await assert.rejects(fs.access(path.join(output, "cinemeta")));
    }
    let variants = 0;
    let titles = 0;
    for (let index = 0; index < original.catalogs.length; index++) {
        const catalog = original.catalogs[index];
        const published = manifest.catalogs[index];
        assert.equal(published.type, catalog.type);
        assert.equal(published.id, catalog.id);
        assert(published.extraSupported.includes("skip"));
        const genre = catalog.extra?.find((extra: any) => extra.name === "genre");
        assert.deepStrictEqual(published.extra.find((extra: any) => extra.name === "genre"), genre);
        const genres = [...(genre?.isRequired ? [] : [undefined]), ...(genre?.options || [])];
        for (const option of genres) {
            const base = `catalog/${catalog.type}/${catalog.id}`;
            const relative = option === undefined ? `${base}.json` : `${base}/genre=${option}.json`;
            const sourceBytes = await fs.readFile(path.join(options.mixed ? output : root, relative));
            if (!options.mixed) assert(sourceBytes.equals(await fs.readFile(path.join(output, relative))), `Original changed: ${relative}`);
            const source = JSON.parse(sourceBytes.toString("utf8")).metas;
            if (options.mixed) for (const meta of source) validateMeta(meta, catalog.type, "mixed");
            const seen = new Set<string>();
            const expected = source.filter((meta: any) => {
                const key = `${meta.type}:${meta.id}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            if (options.mixed) assert.equal(expected.length, source.length, `Duplicate published IDs: ${relative}`);
            assert.deepStrictEqual((await read(`paginated/${relative}`)).metas, expected.slice(0, pageSize));
            const collected = [];
            const last = expected.length + pageSize - 1;
            for (let skip = 0; skip <= last; skip++) {
                const suffix = option === undefined ? `skip=${skip}` : `skip=${skip}&genre=${option}`;
                const page = await read(`paginated/${base}/${suffix}.json`);
                assert.deepStrictEqual(page.metas, expected.slice(skip, skip + pageSize), `${relative}, skip=${skip}`);
                if (option !== undefined) {
                    assert.deepStrictEqual(await read(`paginated/${base}/genre=${option}&skip=${skip}.json`), page);
                }
                if (skip % pageSize === 0) collected.push(...page.metas);
            }
            assert.deepStrictEqual(collected, expected, `Traversal mismatch: ${relative}`);
            variants++;
            titles += expected.length;
        }
    }
    let bytes = 0;
    let files = 0;
    async function measure(directory: string) {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) await measure(file);
            else {
                assert(entry.isFile(), `Non-regular published file: ${file}`);
                bytes += (await fs.stat(file)).size;
                files++;
            }
        }
    }
    await measure(output);
    assert(bytes <= 1_000_000_000, "Published site exceeds the GitHub Pages size limit");
    return { catalogs: manifest.catalogs.length, variants, titles, pageSize, files, bytes };
}

if (require.main === module) verifyPages(process.cwd(), { mixed: true })
    .then(result => console.log(`Verified unified export: ${JSON.stringify(result)}`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
