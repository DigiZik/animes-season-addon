import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { exportCinemeta, imdbIndex, CINEMETA_PAGINATED_ID } from "../src/cinemeta";
import { verifyIds } from "../src/verify-ids";
import { buildAllPages } from "../src/build-pages";
import { verifyPages } from "../src/verify-pages";

jest.setTimeout(30000);
const movie = (id: number, imdb: unknown, tmdb?: unknown) => ({ anilist_id: id, type: "MOVIE", imdb_id: imdb, themoviedb_id: tmdb });
const series = (id: number, imdb: unknown) => ({ anilist_id: id, type: "TV", imdb_id: imdb });
it("uses exact IDs and skips missing, conflicting, multipart and wrong-type movie mappings", () => {
    const index = imdbIndex([movie(1, "tt1234567"), movie(2, ["tt2222222", "tt3333333"]), movie(3, "tt4444444", { tv: 30 }),
        movie(4, "tt5555555", { movie: [40, 41] }), movie(5, "wrong"), movie(6, "tt6666666"), movie(6, "tt7777777")]);
    expect(index.get("movie:1")).toBe("tt1234567");
    for(const id of [2,3,4,5,6])expect(index.get(`movie:${id}`)).toBeFalsy();
});
it("rejects IDs shared across movies or content types, but permits shared series franchise IDs", () => {
    const index = imdbIndex([movie(1,"tt1111111"),movie(2,"tt1111111"),movie(3,"tt2222222"),series(4,"tt2222222"),series(5,"tt3333333"),series(6,"tt3333333")]);
    expect(index.get("movie:1")).toBeNull(); expect(index.get("movie:2")).toBeNull(); expect(index.get("movie:3")).toBeNull();
    expect(index.get("series:4")).toBeNull(); expect(index.get("series:5")).toBe("tt3333333"); expect(index.get("series:6")).toBe("tt3333333");
});
it.each([[], {}, [{ anilist_id: 1 }]])("refuses an unusable conversion dataset", value => expect(() => imdbIndex(value)).toThrow());

let root: string;
const item = (id: number) => ({ id: `anilist:${id}`, type: "series", name: `Full title ${id}`, poster: "https://example.com/poster.jpg", releaseInfo: "2026" });
beforeEach(async () => {
    root=await fs.mkdtemp(path.join(os.tmpdir(),"cinemeta-export-"));
    await fs.mkdir(path.join(root,"catalog/series"),{recursive:true});
    await fs.writeFile(path.join(root,"catalog/series/latest_anime_seasons.json"),JSON.stringify({metas:[item(1),item(2),item(3)]}));
    await fs.writeFile(path.join(root,"manifest.json"),JSON.stringify({id:"native",name:"Anime",version:"1.20.5",idPrefixes:["anilist"],catalogs:[{id:"latest_anime_seasons",type:"series",name:"Anime Seasons",extra:[],extraSupported:[]}]}));
});
afterEach(async()=>{jest.restoreAllMocks();if(path.dirname(root)!==path.resolve(os.tmpdir()))throw Error("Unsafe cleanup");await fs.rm(root,{recursive:true,force:true});});
it("performs one bulk request for the separate feed, retaining fallback metadata and first occurrence order", async()=>{
    const network=jest.spyOn(global,"fetch").mockResolvedValue(new Response(JSON.stringify([series(1,"tt1234567"),series(2,"tt1234567")])));
    expect(await exportCinemeta(root)).toMatchObject({inputEntries:3,exportedEntries:1,omittedOrDeduplicated:2});
    const exported=JSON.parse(await fs.readFile(path.join(root,"cinemeta/catalog/series/latest_anime_seasons.json"),"utf8"));
    expect(exported.metas).toEqual([{...item(1),id:"tt1234567"}]);expect(network).toHaveBeenCalledTimes(1);
    expect(await verifyIds(root)).toMatchObject({entries:3});expect(await verifyIds(path.join(root,"cinemeta"),"imdb")).toMatchObject({entries:1});
});
it.each(["20","50","invalid"])("uses fixed 100-item pages even with a stale page-size variable of %s",async staleSize=>{
    await exportCinemeta(root,[series(1,"tt1234567"),series(2,"tt7654321")]);
    const network=jest.spyOn(global,"fetch").mockRejectedValue(new Error("Publishing must be offline"));
    const before=process.env.PAGINATION_PAGE_SIZE;process.env.PAGINATION_PAGE_SIZE=staleSize;
    try{
        const built=await buildAllPages(root);
        const a=await verifyPages(root);
        const b=await verifyPages(path.join(root,"cinemeta"),{offsetStep:100,output:built.cinemeta.outputDir,expectedId:CINEMETA_PAGINATED_ID});
        expect(built.native.pageSize).toBe(100);expect(a.pageSize).toBe(100);expect(a.titles).toBe(3);expect(b.titles).toBe(2);expect(a.bytes).toBe(built.bytes);expect(a.files).toBe(built.files);
        expect(network).not.toHaveBeenCalled();
    }finally{if(before===undefined)delete process.env.PAGINATION_PAGE_SIZE;else process.env.PAGINATION_PAGE_SIZE=before;}
});
it("keeps the previous export intact on provider failure or invalid input",async()=>{
    await exportCinemeta(root,[series(1,"tt1234567")]);
    const file=path.join(root,"cinemeta/catalog/series/latest_anime_seasons.json"),before=await fs.readFile(file);
    const network=jest.spyOn(global,"fetch").mockResolvedValue(new Response("unavailable",{status:503}));
    await expect(exportCinemeta(root)).rejects.toThrow("HTTP 503");expect(network).toHaveBeenCalledTimes(1);expect(await fs.readFile(file)).toEqual(before);
    await expect(exportCinemeta(root,[series(99,"tt1234567")])).rejects.toThrow("no titles");expect(await fs.readFile(file)).toEqual(before);
});
it("fails oversized or invalid downloads without retries or cache fallback",async()=>{
    const network=jest.spyOn(global,"fetch").mockResolvedValue(new Response("",{headers:{"content-length":String(17*1024*1024)}}));
    await expect(exportCinemeta(root)).rejects.toThrow("oversized");expect(network).toHaveBeenCalledTimes(1);
});

it("removes stale export files while preserving unmapped empty variants",async()=>{
    await exportCinemeta(root,[series(1,"tt1234567")]);
    const stale=path.join(root,"cinemeta/catalog/series/stale.json");await fs.writeFile(stale,JSON.stringify({metas:[]}));
    await exportCinemeta(root,[series(1,"tt1234567")]);await expect(fs.stat(stale)).rejects.toMatchObject({code:"ENOENT"});
});

it.each([100,205])("traverses %i Cinemeta items without unused offsets or extra empty pages",async count=>{
    const metas=Array.from({length:count},(_,i)=>item(i+1));
    await fs.writeFile(path.join(root,"catalog/series/latest_anime_seasons.json"),JSON.stringify({metas}));
    const manifest=JSON.parse(await fs.readFile(path.join(root,"manifest.json"),"utf8"));manifest.catalogs[0].extra=[{name:"genre",options:["2026"],isRequired:false}];
    await fs.writeFile(path.join(root,"manifest.json"),JSON.stringify(manifest));await fs.mkdir(path.join(root,"catalog/series/latest_anime_seasons"));
    await fs.writeFile(path.join(root,"catalog/series/latest_anime_seasons/genre=2026.json"),JSON.stringify({metas}));
    await exportCinemeta(root,metas.map((meta,i)=>series(i+1,"tt"+(1000000+i))));
    const built=await buildAllPages(root);expect(built.cinemeta.pageSize).toBe(100);expect(built.cinemeta.files).toBeLessThan(30);
    await verifyPages(path.join(root,"cinemeta"),{offsetStep:100,output:built.cinemeta.outputDir,expectedId:CINEMETA_PAGINATED_ID});
    const base=path.join(built.cinemeta.outputDir,"paginated/catalog/series/latest_anime_seasons");
    const lastData=Math.floor((count-1)/100)*100,terminal=Math.ceil(count/100)*100;
    expect(JSON.parse(await fs.readFile(base+`/skip=${lastData}.json`,"utf8")).metas).toHaveLength(count-lastData);
    expect(JSON.parse(await fs.readFile(base+`/skip=${terminal}.json`,"utf8"))).toEqual({metas:[]});
    await expect(fs.stat(base+`/skip=${terminal+100}.json`)).rejects.toMatchObject({code:"ENOENT"});
    await expect(fs.stat(base+"/skip=1.json")).rejects.toMatchObject({code:"ENOENT"});
});
