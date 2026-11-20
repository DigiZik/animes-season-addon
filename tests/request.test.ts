type ResolverModule = typeof import("../src/request");
type MappingsModule = typeof import("../src/anime-mappings");
let request: ResolverModule;
let mappings: MappingsModule;
let fetchMock: jest.SpyInstance;
const rows = [
    { anilist_id: 205289, kitsu_id: 51003, mal_id: 63221, type: "MOVIE" },
    { anilist_id: 213908, type: "MOVIE" },
    { anilist_id: 176373, type: "MOVIE" },
    { anilist_id: 1, kitsu_id: 10, mal_id: 20, imdb_id: ["tt1234567"], themoviedb_id: { tv: 30 } },
];
const tsv = "title\tanilist\tkitsu\timdb\tmyanimelist\tthemoviedb\nNorman\t205289\t51003\t\t63221\t\nTest\t1\t10\ttt1234567\t20\t30\n";
function mockDatasets(fribb: unknown = rows, animeApi = tsv) {
    fetchMock.mockImplementation(async (url: string) => new Response(url.includes("Fribb") ? JSON.stringify(fribb) : animeApi));
}

beforeEach(() => {
    jest.resetModules();
    request = require("../src/request");
    mappings = require("../src/anime-mappings");
    fetchMock = jest.spyOn(global, "fetch");
    mockDatasets();
});
afterEach(() => jest.restoreAllMocks());

it("uses Norman's verified Kitsu ID without searching or shortening its title", async () => {
    const resolver = new request.IdResolver(request.IdSource.ANILIST, "205289", "Norman the Snowman: Kodomo-tachi no Hitotsuboshi", 2026, "movie");
    expect(await resolver.resolveAnimeId()).toBe("kitsu:51003");
    expect(await resolver.resolveImdb()).toBeUndefined();
    expect(await resolver.resolveKitsu()).toBe("kitsu:51003");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith("https://raw.githubusercontent.com/"))).toBe(true);
});

it.each(["213908", "176373", "999999"])("preserves AniList identity %s when no Kitsu cross-reference exists", async id => {
    const resolver = new request.IdResolver(request.IdSource.ANILIST, id, "Ambiguous title", 2026, "movie", () => "norman");
    expect(await resolver.resolveAnimeId()).toBe(`anilist:${id}`);
    expect(await resolver.resolveImdb()).toBeUndefined();
    expect(await resolver.resolveKitsu()).toBeUndefined();
});

it("shares exactly two bulk requests across concurrent lookups, targets, and resolver instances", async () => {
    const tasks = Array.from({ length: 100 }, () => new request.IdResolver(request.IdSource.ANILIST, "1").resolveAnimeId());
    expect(new Set(await Promise.all(tasks))).toEqual(new Set(["kitsu:10"]));
    const resolver = new request.IdResolver(request.IdSource.MAL, "20");
    expect(await resolver.resolveImdb()).toBe("tt1234567");
    expect(await resolver.resolveKitsu()).toBe("kitsu:10");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, options]) => options.signal instanceof AbortSignal)).toBe(true);
});

it("does not choose an arbitrary anime season from a shared franchise ID", async () => {
    mockDatasets([...rows, { anilist_id: 2, kitsu_id: 11, imdb_id: ["tt1234567"] }]);
    const resolver = new request.IdResolver(request.IdSource.IMDB, "tt1234567");
    expect(await resolver.resolveAnimeId()).toBeUndefined();
    expect(await resolver.resolveKitsu()).toBeUndefined();
});

it("keeps AniList identity when the cross-reference datasets disagree", async () => {
    mockDatasets(rows, tsv.replace("205289\t51003", "205289\t99999"));
    const resolver = new request.IdResolver(request.IdSource.ANILIST, "205289");
    expect(await resolver.resolveAnimeId()).toBe("anilist:205289");
    expect(await resolver.resolveKitsu()).toBeUndefined();
});

it("keeps distinct AniList seasons/editions when a provider combines them under one Kitsu ID", async () => {
    mockDatasets([...rows, { anilist_id: 2, kitsu_id: 10 }]);
    const resolver = new request.IdResolver(request.IdSource.ANILIST, "1");
    expect(await resolver.resolveAnimeId()).toBe("anilist:1");
    expect(await resolver.resolveKitsu()).toBeUndefined();
    expect(await new request.IdResolver(request.IdSource.ANILIST, "2").resolveAnimeId()).toBe("anilist:2");
});

it("rejects malformed IMDb/Kitsu mapping values instead of constructing kitsu:tt IDs", async () => {
    mockDatasets([{ anilist_id: 1, kitsu_id: "tt40145204", imdb_id: ["wrong", "tt", "https://example.com"] }], "title\tanilist\tkitsu\timdb\nTest\t1\t\t\n");
    const resolver = new request.IdResolver(request.IdSource.ANILIST, "1");
    expect(await resolver.resolveKitsu()).toBeUndefined();
    expect(await resolver.resolveImdb()).toBeUndefined();
    expect(await resolver.resolveAnimeId()).toBe("anilist:1");
});

it.each(["", "0", "-1", "1x", "1.5", "9007199254740992"])("rejects invalid source identity %s without network work", async id => {
    const resolver = new request.IdResolver(request.IdSource.ANILIST, id);
    expect(await resolver.resolveImdb()).toBeUndefined();
    await expect(resolver.resolveAnimeId()).rejects.toThrow("Invalid source AniList ID");
    expect(fetchMock).not.toHaveBeenCalled();
});

it("throws on mapping-provider failure and allows a later retry instead of caching a false identity", async () => {
    fetchMock.mockResolvedValue(new Response("unavailable", { status: 503 }));
    const resolver = new request.IdResolver(request.IdSource.ANILIST, "1");
    await expect(resolver.resolveImdb()).rejects.toThrow("HTTP 503");
    mockDatasets();
    expect(await resolver.resolveImdb()).toBe("tt1234567");
    expect(fetchMock).toHaveBeenCalledTimes(4);
});

it("rejects oversized responses before loading their body", async () => {
    fetchMock.mockResolvedValue(new Response("", { headers: { "content-length": String(17 * 1024 * 1024) } }));
    await expect(mappings.loadAnimeMappings()).rejects.toThrow("too large");
});

it("rejects malformed source schemas", () => {
    expect(() => new mappings.AnimeMappings([], tsv)).toThrow("Fribb");
    expect(() => new mappings.AnimeMappings(rows, "title\nMissing columns")).toThrow("animeApi");
});

it("does not read shifted or truncated TSV ID columns as mappings", () => {
    const index = new mappings.AnimeMappings([{ anilist_id: 5 }], "title\tanilist\tkitsu\timdb\nGood\t1\t10\t\nBad\ttab\t2\t99\t\nTruncated\t3\n");
    expect(index.preferredId(1)).toBe("kitsu:10");
    expect(index.preferredId(2)).toBe("anilist:2");
    expect(index.preferredId(3)).toBe("anilist:3");
});

it("protects verified native identities from legacy title-based ID patches", async () => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    const { Patches } = require("../src/patch");
    const { Catalog } = require("../src/stremio");
    const catalog = new Catalog("unused");
    catalog.addMeta({ id: "kitsu:46454", type: "series", name: "Arifureta: From Commonplace to World's Strongest Season 3", poster: "poster", anilistId: 154473 });
    const patches = new Patches();
    patches.loadCatalogManualFixPatches();
    patches.applyPatches(catalog, "series", "FALL");
    expect(catalog.getMetas()[0].id).toBe("kitsu:46454");
});

it("exports source provenance and native IDs from catalog generation", async () => {
    const { Catalog } = require("../src/stremio");
    const { Season } = require("../src/query");
    jest.spyOn(request.Anilist.prototype, "fetch").mockResolvedValue({ data: { Page: { media: [{
        id: 205289, title: { english: "Norman the Snowman" }, seasonYear: 2026,
        genres: ["Fantasy"], tags: [], description: "Anime", coverImage: { large: "poster" }
    }] } } });
    const catalog = new Catalog("unused");
    await catalog.populate(2026, Season.FALL, "movie");
    expect(catalog.getMetas()[0]).toMatchObject({ id: "kitsu:51003", anilistId: 205289, behaviorHints: { defaultVideoId: "kitsu:51003" } });
});
