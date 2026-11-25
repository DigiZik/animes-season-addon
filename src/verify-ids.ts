import path from "path";
import { catalogFiles } from "./catalog-files";
import { validateMeta } from "./native-meta";

export async function verifyIds(root = process.cwd(), kind: "anilist" | "imdb" | "mixed" = "anilist") {
    const files = await catalogFiles(root);
    let entries = 0;
    const unique = new Set<string>();
    for (const file of files) for (const meta of file.data.metas) {
        try { validateMeta(meta, file.type, kind); }
        catch (error) { throw new Error(`${file.relative}: ${(error as Error).message}`); }
        unique.add(meta.id);
        entries++;
    }
    return { files: files.length, entries, uniqueTitles: unique.size };
}
if (require.main === module) Promise.all([verifyIds(), verifyIds(path.join(process.cwd(), ".pages"), "mixed")])
    .then(([source, published]) => console.log(`Verified source and published identities: ${JSON.stringify({ source, published })}`))
    .catch(error => { console.error((error as Error).message); process.exitCode = 1; });
