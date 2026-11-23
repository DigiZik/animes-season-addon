import { Catalog } from "../src/stremio";
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
