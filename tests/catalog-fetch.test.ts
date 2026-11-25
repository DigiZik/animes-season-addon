import { Catalog, fetchSeasonCatalogs } from "../src/stremio";
import { Anilist } from "../src/request";
import { Season } from "../src/query";
afterEach(()=>jest.restoreAllMocks());
const anime=(id:number,isAdult=false)=>({id,isAdult,title:{english:`Title ${id}`}});
const response=(media:any[],hasNextPage=false)=>({data:{Page:{media,pageInfo:{hasNextPage}}}});
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
