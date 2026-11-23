import { promises as fs } from "fs";
import path from "path";
import { monthToSeason, Season } from "./query";
import { Catalog, Manifest } from "./stremio";
import { TitleType, Meta, validateMeta } from "./native-meta";
export const SEASONS = [Season.WINTER, Season.SPRING, Season.SUMMER, Season.FALL];
export async function refreshCatalogs(root = process.cwd(), today = new Date(), history = false,
    fetchSeason = async (year: number, season: Season, type: TitleType): Promise<Meta[]> => {
        const catalog = new Catalog("unused");
        await catalog.populate(year, season, type);
        return catalog.getMetas();
    }) {
    const yearNow = today.getUTCFullYear();
    const manifest = await Manifest.fromFile(path.join(root, "manifest.json"));
    const pending: { file: string; metas: Meta[] }[] = [];
    const unique = (metas: Meta[]) => { const seen = new Set<string>(); return metas.filter(meta => !seen.has(meta.id) && !!seen.add(meta.id)); };
    const lastYear = manifest.getLastUpdate().getUTCFullYear();
    // At rollover, finalize the previous year (and any missed years) once.
    const firstYear = history ? 2001 : Number.isInteger(lastYear) && lastYear >= 2001 && lastYear <= yearNow ? lastYear : yearNow;
    let fetched = 0;
    for (let year = yearNow; year >= firstYear; year--) {
        for (const type of ["series", "movie"] as TitleType[]) {
            const annual: Meta[] = [];
            for (const season of SEASONS) {
                console.log(`Fetching ${year}/${season}/${type}`);
                const metas = await fetchSeason(year, season, type);
                metas.forEach(meta => validateMeta(meta, type));
                fetched++;
                annual.push(...metas);
                if (year === yearNow) {
                    pending.push({ file: `catalog/${type}/latest_anime_seasons/genre=${season}.json`, metas });
                    if (season === monthToSeason(today.getUTCMonth())) pending.push({ file: `catalog/${type}/latest_anime_seasons.json`, metas });
                }
            }
            pending.push({ file: `catalog/${type}/archive_anime_seasons/genre=${year}.json`, metas: unique(annual) });
            if (year === yearNow) pending.push({ file: `catalog/${type}/archive_anime_seasons.json`, metas: unique(annual) });
        }
    }
    // Finish all requested fetches before replacing any catalog sources.
    for (const entry of pending) {
        const file = path.join(root, entry.file), body = JSON.stringify({ metas: entry.metas }) + "\n";
        let previous: string | undefined;
        try { previous = await fs.readFile(file, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if (body !== previous) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, body); }
    }
    if (yearNow !== manifest.getLastUpdate().getUTCFullYear() || manifest.getSeasons()[0] !== monthToSeason(today.getUTCMonth())) await manifest.update(today);
    console.log(`Refresh complete: ${fetched} seasonal datasets fetched.`);
    return { fetched, firstYear, yearNow };
}
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== "--history")) {
        console.error("Usage: npm start [-- --history]"); process.exitCode = 1;
    } else refreshCatalogs(process.cwd(), new Date(), args.includes("--history"))
        .catch(error => { console.error("Refresh aborted:", error.message); process.exitCode = 1; });
}
