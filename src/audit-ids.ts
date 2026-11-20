import { promises as fs } from "fs";
import path from "path";
import { AnimeMappings, loadAnimeMappings, positiveId, readMappingSnapshots, writeMappingReport } from "./anime-mappings";

type Entry = { id: string; type: string; name: string; poster?: string; anilistId?: number; behaviorHints?: { defaultVideoId?: string } };
type CatalogFile = { relative: string; text: string; data: { metas: Entry[] } };

async function catalogFiles(root: string): Promise<CatalogFile[]> {
    const files: CatalogFile[] = [];
    async function walk(relative: string) {
        const entries = (await fs.readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
        for (const entry of entries) {
            const file = path.join(relative, entry.name);
            if (entry.isDirectory()) await walk(file);
            else if (entry.isFile() && file.endsWith(".json")) {
                const text = await fs.readFile(path.join(root, file), "utf8");
                const data = JSON.parse(text);
                if (!Array.isArray(data?.metas)) throw new Error(`Invalid catalog: ${file}`);
                files.push({ relative: file, text, data });
            } else throw new Error(`Unsupported catalog path: ${file}`);
        }
    }
    await walk("catalog");
    return files;
}

export function sourceAnilistId(meta: Entry): number | undefined {
    let posterId: number | undefined;
    if (typeof meta.poster === "string") {
        try {
            const url = new URL(meta.poster);
            if (/^(?:s\d+\.)?anilist\.co$/.test(url.hostname)) {
                const match = /\/media\/anime\/cover\/(?:large|medium|small|extraLarge)\/(?:[bn]x?|x)?(\d+)(?:[-.])/.exec(url.pathname);
                posterId = match ? positiveId(match[1]) : undefined;
            }
        } catch { /* A missing poster is not an identity source. */ }
    }
    const explicit = positiveId(meta.anilistId);
    if (meta.anilistId !== undefined && !explicit) throw new Error(`Invalid AniList provenance: ${meta.name}`);
    if (explicit && posterId && explicit !== posterId) throw new Error(`Conflicting AniList provenance: ${meta.name}`);
    return explicit ?? posterId;
}

export async function auditIds(options: { root?: string; mappings: AnimeMappings; repair?: boolean }) {
    const root = path.resolve(options.root || process.cwd());
    const files = await catalogFiles(root);
    const checks = new Map<number, string>();
    const findings = new Map<string, { anilistId: number; name: string; previousId: string; replacement: string; reason: string; files: string[] }>();
    let entries = 0, changedIds = 0, verifiedExisting = 0, nativeFallbacks = 0, changedFiles = 0;
    const prepared: { file: string; body: string }[] = [];
    // Validate all files before applying any repairs; never infer an identity from a title.
    for (const file of files) {
        for (const meta of file.data.metas) {
            entries++;
            const anilistId = sourceAnilistId(meta);
            if (!anilistId) throw new Error(`No authoritative source identity for ${file.relative}: ${meta.name}`);
            let preferred = checks.get(anilistId);
            if (!preferred) { preferred = options.mappings.preferredId(anilistId); checks.set(anilistId, preferred); }
            const wasVerified = options.mappings.verifies(anilistId, meta.id);
            if (wasVerified) verifiedExisting++;
            if (preferred.startsWith("anilist:")) nativeFallbacks++;
            if (meta.id !== preferred) changedIds++;
            if (!wasVerified || preferred.startsWith("anilist:")) {
                const key = `${anilistId}:${meta.id}`;
                let finding = findings.get(key);
                if (!finding) {
                    finding = { anilistId, name: meta.name, previousId: meta.id, replacement: preferred,
                        reason: options.mappings.get(anilistId)?.conflicted ? "conflicting-native-links" : preferred.startsWith("anilist:") ? (options.mappings.get(anilistId)?.kitsu.size ? "conflicting-kitsu-links" : "no-kitsu-link") : "unverified-previous-id", files: [] };
                    findings.set(key, finding);
                }
                finding.files.push(file.relative.split(path.sep).join("/"));
            }
            meta.id = preferred;
            meta.anilistId = anilistId;
            if (meta.type === "movie") meta.behaviorHints = { ...meta.behaviorHints, defaultVideoId: preferred };
        }
        const body = JSON.stringify(file.data, null, 2) + "\n";
        if (body !== file.text) prepared.push({ file: path.join(root, file.relative), body });
    }
    if (options.repair) for (const { file, body } of prepared) { await fs.writeFile(file, body); changedFiles++; }
    return { files: files.length, entries, uniqueAnime: checks.size, changedIds, verifiedExisting,
        unverifiedExisting: entries - verifiedExisting, nativeFallbacks, changedFiles,
        repair: !!options.repair, findings: [...findings.values()] };
}

export async function verifyNativeIds(root = process.cwd()) {
    const files = await catalogFiles(root);
    let entries = 0;
    for (const file of files) for (const meta of file.data.metas) {
        const source = sourceAnilistId(meta);
        if (!source || meta.anilistId !== source || !/^kitsu:[1-9]\d*$/.test(meta.id) && meta.id !== `anilist:${source}`) {
            throw new Error(`Unverified export identity in ${file.relative}: ${meta.name} (${meta.id})`);
        }
        if (meta.type === "movie" && meta.behaviorHints?.defaultVideoId !== meta.id) {
            throw new Error(`Movie stream identity differs from catalog identity: ${file.relative}: ${meta.name}`);
        }
        entries++;
    }
    return { files: files.length, entries };
}

if (require.main === module) {
    (async () => {
        const args = process.argv.slice(2);
        if (args.includes("--verify-native")) {
            console.log(`Verified native anime IDs: ${JSON.stringify(await verifyNativeIds())}`);
            return;
        }
        if (args.some(arg => arg !== "--repair" && !arg.startsWith("--snapshots="))) throw new Error("Supported options: --repair, --snapshots=directory, or --verify-native");
        const snapshots = args.find(arg => arg.startsWith("--snapshots="))?.slice("--snapshots=".length);
        const mappings = snapshots ? await readMappingSnapshots(snapshots) : await loadAnimeMappings();
        const report = await auditIds({ mappings, repair: args.includes("--repair") });
        const reportPath = path.resolve(".cache", "id-audit.json");
        await fs.mkdir(path.dirname(reportPath), { recursive: true });
        await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
        await writeMappingReport(mappings);
        const { findings, ...summary } = report;
        console.log(`Catalog identity audit: ${JSON.stringify(summary)}; report: ${reportPath}`);
    })().catch(async error => { await writeMappingReport().catch(() => {}); console.error((error as Error).message); process.exitCode = 1; });
}
