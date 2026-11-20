import { promises as fs } from "fs";
import path from "path";
import type { Meta } from "./native-meta";

export async function catalogFiles(root: string) {
    const files: { relative: string; type: string; data: { metas: Meta[] } }[] = [];
    async function walk(relative: string, type?: string) {
        const entries = (await fs.readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            const file = path.join(relative, entry.name);
            if (entry.isDirectory()) await walk(file, type || entry.name);
            else if (entry.isFile() && entry.name.endsWith(".json")) {
                const data = JSON.parse(await fs.readFile(path.join(root, file), "utf8"));
                if (!Array.isArray(data?.metas) || (type !== "movie" && type !== "series")) throw new Error(`Invalid catalog: ${file}`);
                files.push({ relative: file, type, data });
            } else throw new Error(`Unsupported catalog path: ${file}`);
        }
    }
    await walk("catalog");
    if (!files.length) throw new Error("No catalogs found.");
    return files;
}
