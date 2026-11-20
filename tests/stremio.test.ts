import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { Catalog } from "../src/stremio";
import { Season } from "../src/query";
import { Anilist } from "../src/request";

afterEach(() => jest.restoreAllMocks());
const anime = { id: 205289, title: { english: "Norman the Snowman" }, genres: ["Fantasy"], tags: [], description: "Synopsis", seasonYear: 2026, coverImage: { large: "https://example.com/poster.jpg" } };
it("uses only the AniList seasonal request to build native IDs and fallback metadata", async () => {
    const network = jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { Page: { media: [anime] } } })));
    const catalog = new Catalog("unused"); await catalog.populate(2026, Season.FALL, "movie");
    expect(catalog.getMetas()[0]).toMatchObject({ id: "anilist:205289", type: "movie", name: "Norman the Snowman", releaseInfo: "2026" });
    expect(network).toHaveBeenCalledTimes(1);
    expect(network.mock.calls[0][0]).toBe("https://graphql.anilist.co");
    expect(network.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
});
it("does not append a partial season when one source ID is invalid", async () => {
    jest.spyOn(Anilist.prototype, "fetch").mockResolvedValue({ data: { Page: { media: [anime, { ...anime, id: "bad" }] } } });
    const catalog = new Catalog("unused"); await expect(catalog.populate(2026, Season.FALL, "series")).rejects.toThrow("Invalid source");
    expect(catalog.getMetas()).toEqual([]);
});
it("rejects an unexpected AniList response", async () => {
    jest.spyOn(Anilist.prototype, "fetch").mockResolvedValue({ data: null });
    await expect(new Catalog("unused").populate(2026, Season.FALL, "series")).rejects.toThrow("missing data.Page.media");
});
it("validates catalog writes instead of silently dropping bad entries", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "native-catalog-"));
    const file = path.join(root, "catalog.json"); await fs.writeFile(file, "previous");
    try {
        const catalog = new Catalog(file); catalog.addMeta({ id: "tt40145204", type: "movie", name: "Wrong ID" });
        await expect(catalog.writeToFile()).rejects.toThrow("anilist identity");
        expect(await fs.readFile(file, "utf8")).toBe("previous");
    } finally { if(path.dirname(root)!==path.resolve(os.tmpdir()))throw Error("Unsafe cleanup"); await fs.rm(root, { recursive: true, force: true }); }
});
