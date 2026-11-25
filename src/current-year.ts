import { promises as fs } from "fs";
import path from "path";
import assert from "assert";
import { uniqueMetas } from "./pagination";
import { SEASONS, Season } from "./query";
import type { SeasonCatalogs } from "./stremio";
import type { Meta } from "./native-meta";

// Shared derivation for refreshes and offline validation. Annual ordering stays
// Winter → Spring → Summer → Fall regardless of the default season.
export function yearCatalogs(year: number, seasons: SeasonCatalogs[], defaultSeason?: Season) {
    if (seasons.length !== SEASONS.length) throw new Error("Expected all four seasonal datasets.");
    const sources: { file: string; metas: Meta[] }[] = [];
    const counts: Record<string, number> = {};
    for (const type of ["series", "movie"] as const) {
        const annual: Meta[] = [];
        for (const [index, season] of SEASONS.entries()) {
            const metas = uniqueMetas(seasons[index][type], type, `${year}/${season}/${type}`) as Meta[];
            annual.push(...metas);
            if (defaultSeason !== undefined) {
                sources.push({ file: `catalog/${type}/latest_anime_seasons/genre=${season}.json`, metas });
                if (season === defaultSeason) sources.push({ file: `catalog/${type}/latest_anime_seasons.json`, metas });
            }
        }
        const metas = uniqueMetas(annual, type, `${year}/${type}`) as Meta[];
        counts[type] = metas.length;
        sources.push({ file: `catalog/${type}/archive_anime_seasons/genre=${year}.json`, metas });
        if (defaultSeason !== undefined) sources.push({ file: `catalog/${type}/archive_anime_seasons.json`, metas });
    }
    return { sources, counts };
}

export async function prepareCurrentYear(root = process.cwd(), today = new Date()) {
    const year = today.getUTCFullYear();
    if (!Number.isInteger(year) || year < 2001) throw new Error("Invalid current year.");
    const read = async (file: string) => JSON.parse(await fs.readFile(path.join(root, file), "utf8"));
    const manifest = await read("manifest.json");
    if (new Date(manifest.lastUpdatedAt).getUTCFullYear() !== year) {
        throw new Error(`Seasonal data is not marked as ${year}. Run the workflow with Refresh AniList data enabled before publishing the new year.`);
    }
    const years = Array.from({ length: year - 2000 }, (_, index) => String(year - index));
    let defaultSeason: Season | undefined;
    for (const type of ["series", "movie"]) {
        const catalog = manifest.catalogs?.find((entry: any) => entry.type === type && entry.id === "archive_anime_seasons");
        const genre = catalog?.extra?.find((extra: any) => extra.name === "genre");
        assert(genre && !genre.isRequired, `Missing optional Anime Years filter for ${type}. Refresh AniList data before publishing.`);
        assert.deepStrictEqual(genre.options, years, `Stale Anime Years options for ${type}. Refresh AniList data before publishing.`);
        const seasonal = manifest.catalogs.find((entry: any) => entry.type === type && entry.id === "latest_anime_seasons");
        const first = seasonal?.extra?.find((extra: any) => extra.name === "genre")?.options?.[0];
        assert(SEASONS.includes(first) && (defaultSeason === undefined || defaultSeason === first), "Invalid or inconsistent default season.");
        defaultSeason = first;
    }
    const seasons: SeasonCatalogs[] = [];
    for (const season of SEASONS) {
        const datasets = {} as SeasonCatalogs;
        for (const type of ["series", "movie"] as const) datasets[type] = (await read(`catalog/${type}/latest_anime_seasons/genre=${season}.json`)).metas;
        seasons.push(datasets);
    }
    // Check committed defaults without repairing native data after IMDb conversion.
    const { sources, counts } = yearCatalogs(year, seasons, defaultSeason);
    for (const { file, metas } of sources) {
        assert.deepStrictEqual((await read(file)).metas, metas, `Stale catalog: ${file}. Refresh AniList data before publishing.`);
    }
    return { year, counts };
}

if (require.main === module) {
    Promise.all([prepareCurrentYear(), prepareCurrentYear(path.join(process.cwd(), "cinemeta"))])
        .then(result => console.log(`Validated current-year defaults: ${JSON.stringify(result)}`))
        .catch(error => { console.error(`Current-year validation failed: ${(error as Error).message}`); process.exitCode = 1; });
}
