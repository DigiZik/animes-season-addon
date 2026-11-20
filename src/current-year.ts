import { promises as fs } from "fs";
import path from "path";
import { uniqueMetas } from "./pagination";

// Keep annual ordering stable when the default season changes during the year.
const SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"];

export async function prepareCurrentYear(root = process.cwd(), today = new Date()) {
    const year = today.getFullYear();
    if (!Number.isInteger(year) || year < 2001) throw new Error("Invalid current year.");
    const manifestPath = path.join(root, "manifest.json");
    const originalManifest = await fs.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(originalManifest);
    if (new Date(manifest.lastUpdatedAt).getFullYear() !== year) {
        throw new Error(`Seasonal data is not marked as ${year}. Run the workflow with Refresh AniList data enabled before publishing the new year.`);
    }
    if (!Array.isArray(manifest.catalogs)) throw new Error("Invalid manifest: missing catalogs.");
    const years = Array.from({ length: year - 2000 }, (_, index) => String(year - index));
    const pending: { file: string; body: string }[] = [];
    const counts: Record<string, number> = {};
    const before = JSON.stringify({ catalogs: manifest.catalogs, idPrefixes: manifest.idPrefixes });
    manifest.idPrefixes = [...new Set([...(manifest.idPrefixes || []), "anilist"])];
    for (const type of ["series", "movie"]) {
        const catalog = manifest.catalogs.find((entry: any) => entry.type === type && entry.id === "archive_anime_seasons");
        const genre = catalog?.extra?.find((extra: any) => extra.name === "genre");
        if (!genre) throw new Error(`Missing Anime Years genre configuration for ${type}.`);
        const metas: unknown[] = [];
        for (const season of SEASONS) {
            const relative = path.join("catalog", type, "latest_anime_seasons", `genre=${season}.json`);
            let source;
            try {
                source = JSON.parse(await fs.readFile(path.join(root, relative), "utf8"));
            } catch (error) {
                throw new Error(`Cannot prepare ${year} ${type}: ${relative}: ${(error as Error).message}`);
            }
            metas.push(...uniqueMetas(source?.metas, type, relative));
        }
        const combined = uniqueMetas(metas, type, `${year} ${type}`);
        const body = JSON.stringify({ metas: combined }, null, 2) + "\n";
        counts[type] = combined.length;
        pending.push({ file: path.join(root, "catalog", type, "archive_anime_seasons", `genre=${year}.json`), body });
        pending.push({ file: path.join(root, "catalog", type, "archive_anime_seasons.json"), body });
        genre.options = years;
        genre.isRequired = false;
    }
    if (JSON.stringify({ catalogs: manifest.catalogs, idPrefixes: manifest.idPrefixes }) !== before) {
        const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(manifest.version);
        if (!match) throw new Error("Cannot update invalid manifest version.");
        manifest.version = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
    }
    pending.push({ file: manifestPath, body: JSON.stringify(manifest, null, 2) + "\n" });
    // Validate both types and all seasons before changing any files. Skip unchanged
    // writes so manual builds do not manufacture data commits or new timestamps.
    let changed = 0;
    for (const { file, body } of pending) {
        let existing: string | undefined;
        try { existing = await fs.readFile(file, "utf8"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if (existing !== body) {
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.writeFile(file, body);
            changed++;
        }
    }
    return { year, counts, changed };
}

if (require.main === module) {
    prepareCurrentYear().then(result => console.log(`Prepared current-year defaults: ${JSON.stringify(result)}`)).catch(error => {
        console.error(`Current-year preparation failed: ${(error as Error).message}`);
        process.exitCode = 1;
    });
}
