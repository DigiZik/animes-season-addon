import { promises as fs } from "fs";
import path from "path";
import { buildPages } from "./pagination";
import { convertCatalogs, downloadMappings } from "./mappings";
import { prepareCurrentYear } from "./current-year";

export async function buildAllPages(root = process.cwd(), rows?: unknown) {
    root = path.resolve(root);
    await prepareCurrentYear(root);
    const { converted, report } = await convertCatalogs(root, rows ?? await downloadMappings());
    const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
    manifest.idPrefixes = ["kitsu", "tt"];
    manifest.version = "1.5.0";
    const result = await buildPages({ root, catalogs: converted, publishedManifest: manifest });
    console.log(`Catalog mapping: ${JSON.stringify(report)}`);
    return { ...result, mapping: report };
}
if (require.main === module) buildAllPages().then(async result => {
    console.log(`Built unified export: ${JSON.stringify(result)}`);
    const report = result.mapping;
    if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
        `\n### Catalog mapping\n\nKitsu: ${report.kitsu}; IMDb fallback: ${report.imdb}; unmapped/conflicting: ${report.omitted}; duplicates removed: ${report.duplicates}. Counts include repeated entries across catalog variants.\n`);
})
    .catch(error => { console.error((error as Error).message); process.exitCode = 1; });
