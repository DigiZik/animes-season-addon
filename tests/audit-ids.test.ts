import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { AnimeMappings } from "../src/anime-mappings";
import { auditIds, sourceAnilistId, verifyNativeIds } from "../src/audit-ids";

let root: string;
const mappings = new AnimeMappings([
    { anilist_id: 205289, kitsu_id: 51003 }, { anilist_id: 213908 }, { anilist_id: 176373 }
], "title\tanilist\tkitsu\timdb\nNorman\t205289\t51003\t\n");
const item = (anilist: number, id: string, name: string) => ({ id, type: "movie", name,
    poster: `https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx${anilist}-image.jpg`,
    behaviorHints: { defaultVideoId: id }, description: "Preserve metadata" });
const relative = "catalog/movie/archive_anime_seasons/genre=2026.json";
async function write(file: string, value: unknown) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), JSON.stringify(value, null, 2) + "\n"); }
async function read(file = relative) { return JSON.parse(await fs.readFile(path.join(root, file), "utf8")); }

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "anime-id-audit-"));
    await write(relative, { metas: [item(205289, "tt40145204", "Norman"), item(213908, "tt39215225", "Rusuban"), item(176373, "tt42411584", "Shiranuhi")] });
});
afterEach(async () => {
    if (path.dirname(root) !== path.resolve(os.tmpdir())) throw new Error("Unsafe test cleanup path");
    await fs.rm(root, { recursive: true, force: true });
});

it("audits without modifying files by default", async () => {
    const before = await fs.readFile(path.join(root, relative));
    const result = await auditIds({ root, mappings });
    expect(result).toMatchObject({ entries: 3, uniqueAnime: 3, changedIds: 3, unverifiedExisting: 3, changedFiles: 0 });
    expect(await fs.readFile(path.join(root, relative))).toEqual(before);
});

it("repairs all three reported mismatches, provenance, and movie playback IDs", async () => {
    expect((await auditIds({ root, mappings, repair: true })).changedFiles).toBe(1);
    const data = await read();
    expect(data.metas.map((meta: any) => meta.id)).toEqual(["kitsu:51003", "anilist:213908", "anilist:176373"]);
    expect(data.metas.map((meta: any) => meta.behaviorHints.defaultVideoId)).toEqual(data.metas.map((meta: any) => meta.id));
    expect(data.metas.map((meta: any) => meta.anilistId)).toEqual([205289, 213908, 176373]);
    expect(data.metas.every((meta: any) => meta.description === "Preserve metadata")).toBe(true);
    expect(await verifyNativeIds(root)).toEqual({ files: 1, entries: 3 });
    expect((await auditIds({ root, mappings, repair: true })).changedFiles).toBe(0);
});

it("checks a repeated anime once and repairs every occurrence", async () => {
    await write("catalog/movie/latest_anime_seasons.json", { metas: [item(205289, "tt40145204", "Norman")] });
    const result = await auditIds({ root, mappings, repair: true });
    expect(result).toMatchObject({ files: 2, entries: 4, uniqueAnime: 3, changedIds: 4 });
    expect((await read("catalog/movie/latest_anime_seasons.json")).metas[0].id).toBe("kitsu:51003");
});

it("does not partially repair files when source identity is missing or contradictory", async () => {
    const before = await fs.readFile(path.join(root, relative));
    await write("catalog/movie/unknown.json", { metas: [{ ...item(1, "tt1234567", "Unknown"), poster: "https://example.com/1.jpg" }] });
    await expect(auditIds({ root, mappings, repair: true })).rejects.toThrow("No authoritative source identity");
    expect(await fs.readFile(path.join(root, relative))).toEqual(before);
    await write("catalog/movie/unknown.json", { metas: [{ ...item(205289, "tt1234567", "Conflict"), anilistId: 1 }] });
    await expect(auditIds({ root, mappings, repair: true })).rejects.toThrow("Conflicting AniList provenance");
    expect(await fs.readFile(path.join(root, relative))).toEqual(before);
});

it("supports original AniList poster prefixes and refuses lookalike domains", () => {
    for (const prefix of ["", "b", "bx", "n", "nx"]) {
        expect(sourceAnilistId({ ...item(199, "tt0245429", "Anime"), poster: `https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/${prefix}199-poster.jpg` })).toBe(199);
    }
    expect(sourceAnilistId({ ...item(199, "tt0245429", "Anime"), poster: "https://anilist.co.example.com/media/anime/cover/large/199.jpg" })).toBeUndefined();
});

it("rejects IMDb IDs and inconsistent playback IDs in published source data", async () => {
    await expect(verifyNativeIds(root)).rejects.toThrow("Unverified export identity");
    await auditIds({ root, mappings, repair: true });
    const data = await read(); data.metas[0].behaviorHints.defaultVideoId = "tt40145204";
    await write(relative, data);
    await expect(verifyNativeIds(root)).rejects.toThrow("Movie stream identity differs");
});
