import { promises as fs } from "fs";
import path from "path";
import { buildPages } from "./pagination";
import { CINEMETA_PAGINATED_ID } from "./cinemeta";

export async function buildAllPages(root = process.cwd()) {
    root = path.resolve(root);
    const native = await buildPages({ root });
    const cinemeta = await buildPages({ root: path.join(root, "cinemeta"), paginatedId: CINEMETA_PAGINATED_ID, offsetStep: 100, maxBytes: 1_000_000_000 - native.bytes });
    const destination = path.join(native.outputDir, "cinemeta");
    if (path.dirname(destination) !== native.outputDir || cinemeta.outputDir !== path.join(root, "cinemeta", ".pages")) throw new Error("Unsafe Cinemeta output path.");
    await fs.rename(cinemeta.outputDir, destination);
    return { bytes: native.bytes + cinemeta.bytes, files: native.files + cinemeta.files, native, cinemeta: { ...cinemeta, outputDir: destination } };
}
if (require.main === module) buildAllPages().then(result => console.log(`Built both exports: ${JSON.stringify(result)}`))
    .catch(error => { console.error((error as Error).message); process.exitCode = 1; });
