import { Catalog, fetchSeasonCatalogs, fetchYearCatalogs } from "../src/stremio";
import { Anilist } from "../src/request";
import { Season } from "../src/query";
afterEach(()=>jest.restoreAllMocks());
const anime=(id:number,isAdult=false)=>({id,isAdult,title:{english:`Title ${id}`}});
const response=(media:any[],hasNextPage=false)=>({data:{Page:{media,pageInfo:{hasNextPage}}}});
const ranked = (id: number, season: string | null, trending = 0, format = "TV") => ({ ...anime(id), season, trending, popularity: 100 - id, format });
it("uses one yearly sequence for popularity-ordered years and trending-ordered seasons", async () => {
    const fetch = jest.spyOn(Anilist.prototype, "fetch")
        .mockResolvedValueOnce(response([ranked(1, "WINTER"), ranked(2, "SPRING", 20, "MOVIE"), ranked(3, "WINTER", 10)], true))
        .mockResolvedValueOnce(response([ranked(3, "WINTER", 10), ranked(4, "WINTER", 10), ranked(5, null)]));
    const data = await fetchYearCatalogs(2026);
    expect(data.annual.series.map(m => m.id)).toEqual([1, 3, 4].map(id => `anilist:${id}`));
    expect(data.annual.movie.map(m => m.id)).toEqual(["anilist:2"]);
    expect(data.seasons[0].series.map(m => m.id)).toEqual([3, 4, 1].map(id => `anilist:${id}`));
    expect(data.seasons[1].movie).toEqual(data.annual.movie);
    expect(data.seasons[2]).toEqual({ movie: [], series: [] });
    expect(JSON.stringify(data)).not.toMatch(/trending|popularity/);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [q] of fetch.mock.calls) { expect(q).not.toMatch(/season:/); expect(q).toContain("seasonYear:2026"); expect(q).toContain("POPULARITY_DESC"); }
});
it("continues past unseasoned or adult-only pages but rejects repeated pages", async () => {
    const fetch = jest.spyOn(Anilist.prototype, "fetch")
        .mockResolvedValueOnce(response([ranked(1, null)], true))
        .mockResolvedValueOnce(response([{ ...ranked(2, "FALL"), isAdult: true }], true))
        .mockResolvedValueOnce(response([ranked(3, "FALL")]));
    expect((await fetchYearCatalogs(2026)).annual.series.map(m => m.id)).toEqual(["anilist:3"]);
    fetch.mockResolvedValue(response([ranked(1, null)], true));
    await expect(fetchYearCatalogs(2026)).rejects.toThrow("did not advance");
});
it("aborts the yearly result when a later page fails and accepts legitimate empty years", async () => {
    const fetch = jest.spyOn(Anilist.prototype, "fetch")
        .mockResolvedValueOnce(response([ranked(1, "WINTER")], true))
        .mockRejectedValueOnce(new Error("outage"));
    await expect(fetchYearCatalogs(2026)).rejects.toThrow("outage");
    fetch.mockResolvedValue(response([]));
    expect(await fetchYearCatalogs(2026)).toEqual({ annual: { movie: [], series: [] }, seasons: Array.from({ length: 4 }, () => ({ movie: [], series: [] })) });
});
it.each([
    { ...ranked(1, "FALL"), trending: undefined },
    { ...ranked(1, "FALL"), popularity: -1 },
    { ...ranked(1, "FALL"), season: undefined },
    { ...ranked(1, "FALL"), isAdult: undefined },
])("rejects incomplete or invalid yearly records", async row => {
    jest.spyOn(Anilist.prototype, "fetch").mockResolvedValue(response([row]));
    await expect(fetchYearCatalogs(2026)).rejects.toThrow();
});
it("fetches all pages, excludes adult entries, and deduplicates",async()=>{
    const fetch=jest.spyOn(Anilist.prototype,"fetch").mockResolvedValueOnce(response(Array.from({length:50},(_,i)=>anime(i+1)),true)).mockResolvedValueOnce(response([anime(50),anime(51),anime(52,true)]));
    const catalog=new Catalog("unused");await catalog.populate(2026,Season.FALL,"series");
    expect(catalog.getMetas()).toHaveLength(51);
    expect(fetch.mock.calls[1][0]).toContain("page: 2");
    expect(fetch.mock.calls.every(([q])=>q.includes("isAdult:false"))).toBe(true);
});

it("splits mixed seasonal pages by format without changing order, fallback data or adult exclusion", async () => {
    const formats = ["TV", "MOVIE", "TV_SHORT", "OVA", "SPECIAL", "ONA"];
    const items = formats.map((format, i) => ({ ...anime(i + 1), format, startDate: { year: 2025 }, coverImage: { large: "https://example.com/poster.jpg" } }));
    const fetch = jest.spyOn(Anilist.prototype, "fetch")
        .mockResolvedValueOnce(response(items.slice(0, 3), true))
        .mockResolvedValueOnce(response([items[2], ...items.slice(3), { ...anime(7, true), format: "MOVIE" }]));
    const catalogs = await fetchSeasonCatalogs(2026, Season.FALL);
    expect(catalogs.movie.map(meta => meta.id)).toEqual(["anilist:2"]);
    expect(catalogs.series.map(meta => meta.id)).toEqual(["anilist:1", "anilist:3", "anilist:4", "anilist:5", "anilist:6"]);
    expect(catalogs.movie[0]).toEqual({ id: "anilist:2", type: "movie", name: "Title 2", releaseInfo: "2025", poster: "https://example.com/poster.jpg" });
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [q] of fetch.mock.calls) {
        expect(q).toContain("format_in:[MOVIE,TV,TV_SHORT,OVA,SPECIAL,ONA]");
        expect(q).toContain("sort:[POPULARITY_DESC,ID_DESC]");
        expect(q).toContain("isAdult:false");
    }
});

it.each([undefined, "MUSIC"])("rejects unknown mixed-feed format %s instead of misclassifying it", async format => {
    jest.spyOn(Anilist.prototype, "fetch").mockResolvedValue(response([{ ...anime(1), format }]));
    await expect(fetchSeasonCatalogs(2026, Season.FALL)).rejects.toThrow("format");
});

it("rejects repeated combined pages instead of looping or retaining partial results", async () => {
    jest.spyOn(Anilist.prototype, "fetch").mockResolvedValue(response([{ ...anime(1), format: "TV" }], true));
    await expect(fetchSeasonCatalogs(2026, Season.FALL)).rejects.toThrow("did not advance");
});
it("does not retain partial results after a later page fails",async()=>{
    jest.spyOn(Anilist.prototype,"fetch").mockResolvedValueOnce(response([anime(1)],true)).mockRejectedValueOnce(new Error("outage"));
    const catalog=new Catalog("unused");await expect(catalog.populate(2026,Season.FALL,"series")).rejects.toThrow("outage");
    expect(catalog.getMetas()).toEqual([]);
});
it("rejects missing pagination state and adult classification",async()=>{
    jest.spyOn(Anilist.prototype,"fetch").mockResolvedValueOnce({data:{Page:{media:[]}}}).mockResolvedValueOnce(response([{id:1}]));
    await expect(new Catalog("unused").populate(2026,Season.FALL,"series")).rejects.toThrow("pagination");
    await expect(new Catalog("unused").populate(2026,Season.FALL,"series")).rejects.toThrow("classification");
});
