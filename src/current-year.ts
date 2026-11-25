import { promises as fs } from "fs";
import path from "path";
import assert from "assert";
import { isDeepStrictEqual } from "util";
import { uniqueMetas } from "./pagination";
import { SEASONS, Season, seasonLabel, seasonFromLabel } from "./query";
import type { YearCatalogs } from "./stremio";
import type { Meta } from "./native-meta";

// Annual order comes from the yearly popularity query; seasons use trending.
export function yearCatalogs(year: number, data: YearCatalogs, defaultSeason?: Season) {
    const { annual, seasons } = data;
    if (seasons.length !== SEASONS.length) throw new Error("Expected all four seasonal datasets.");
    const sources: { file: string; metas: Meta[] }[] = [];
    const counts: Record<string, number> = {};
    for (const type of ["series", "movie"] as const) {
        for (const [index, season] of SEASONS.entries()) {
            const metas = uniqueMetas(seasons[index][type], type, `${year}/${season}/${type}`) as Meta[];
            if (defaultSeason !== undefined) {
                sources.push({ file: `catalog/${type}/trending_anime_seasons/genre=${seasonLabel(season)}.json`, metas });
                if (season === defaultSeason) sources.push({ file: `catalog/${type}/trending_anime_seasons.json`, metas });
            }
        }
        const metas = uniqueMetas(annual[type], type, `${year}/${type}`) as Meta[];
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
        const seasonal = manifest.catalogs.find((entry: any) => entry.type === type && entry.id === "trending_anime_seasons");
        const first = seasonFromLabel(seasonal?.extra?.find((extra: any) => extra.name === "genre")?.options?.[0]);
        assert(SEASONS.includes(first) && (defaultSeason === undefined || defaultSeason === first), "Invalid or inconsistent default season.");
        defaultSeason = first;
    }
    // Ranking scores stay in memory during refresh. Publishing validates exact
    // defaults, unique IDs and annual membership without another API request.
    const counts: Record<string, number> = {};
    for (const type of ["series", "movie"]) {
        const readMetas = async (file: string) => {
            const metas = (await read(file)).metas;
            assert.deepStrictEqual(metas, uniqueMetas(metas, type, file), `Duplicate catalog IDs: ${file}`);
            return metas as Meta[];
        };
        const cards = new Map<string, Meta[]>();
        for (const season of SEASONS) {
            const metas = await readMetas(`catalog/${type}/trending_anime_seasons/genre=${seasonLabel(season)}.json`);
            for (const meta of metas) {
                const matches = cards.get(meta.id);
                if (matches) matches.push(meta);
                else cards.set(meta.id, [meta]);
            }
            if (season === defaultSeason) assert.deepStrictEqual(await readMetas(`catalog/${type}/trending_anime_seasons.json`), metas, "Stale catalog: default season");
        }
        const annual = await readMetas(`catalog/${type}/archive_anime_seasons/genre=${year}.json`);
        assert.deepStrictEqual(annual.map(meta => meta.id).sort(), [...cards.keys()].sort(), "Stale catalog: annual membership");
        // Native cards must agree. Mapping can collapse multiple source titles:
        // popularity and trending may then retain different cards for one ID.
        for (const meta of annual) if (meta.id.startsWith("anilist:")) {
            assert(cards.get(meta.id)!.some(card => isDeepStrictEqual(card, meta)), `Stale catalog: annual card ${meta.id}`);
        }
        assert.deepStrictEqual(await readMetas(`catalog/${type}/archive_anime_seasons.json`), annual, "Stale catalog: default year");
        counts[type] = annual.length;
    }
    return { year, counts };
}

if (require.main === module) {
    prepareCurrentYear()
        .then(result => console.log(`Validated current-year defaults: ${JSON.stringify(result)}`))
        .catch(error => { console.error(`Current-year validation failed: ${(error as Error).message}`); process.exitCode = 1; });
}
