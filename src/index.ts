import { promises as fs } from "fs";
import path from "path";
import { monthToSeason } from "./query";
import { fetchYearCatalogs, Manifest } from "./stremio";
import { Meta, validateMeta } from "./native-meta";
import { yearCatalogs } from "./current-year";
export async function refreshCatalogs(root = process.cwd(), today = new Date(), history = false,
    fetchYear = fetchYearCatalogs) {
    const yearNow = today.getUTCFullYear();
    const manifest = await Manifest.fromFile(path.join(root, "manifest.json"));
    const pending: { file: string; metas: Meta[] }[] = [];
    const lastYear = manifest.getLastUpdate().getUTCFullYear();
    // At rollover, finalize the previous year (and any missed years) once.
    const firstYear = history ? 2001 : Number.isInteger(lastYear) && lastYear >= 2001 && lastYear <= yearNow ? lastYear : yearNow;
    let fetched = 0;
    for (let year = yearNow; year >= firstYear; year--) {
        console.log(`Fetching ${year}`);
        const data = await fetchYear(year);
        for (const datasets of [data.annual, ...data.seasons]) for (const type of ["series", "movie"] as const) datasets[type].forEach(meta => validateMeta(meta, type));
        pending.push(...yearCatalogs(year, data, year === yearNow ? monthToSeason(today.getUTCMonth()) : undefined).sources);
        fetched++;
    }
    // Finish all requested fetches before replacing any catalog sources.
    let changed = false;
    for (const entry of pending) {
        const file = path.join(root, entry.file), body = JSON.stringify({ metas: entry.metas }, null, 2) + "\n";
        let previous: string | undefined;
        try { previous = await fs.readFile(file, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if (body !== previous) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, body); changed = true; }
    }
    if (changed || yearNow !== manifest.getLastUpdate().getUTCFullYear() || manifest.getSeasons()[0] !== monthToSeason(today.getUTCMonth())) await manifest.update(today);
    console.log(`Refresh complete: ${fetched} years fetched (movies and series together).`);
    return { fetched, firstYear, yearNow };
}
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== "--history")) {
        console.error("Usage: npm start [-- --history]"); process.exitCode = 1;
    } else refreshCatalogs(process.cwd(), new Date(), args.includes("--history"))
        .catch(error => { console.error("Refresh aborted:", error.message); process.exitCode = 1; });
}
