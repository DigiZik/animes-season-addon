import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { verifyIds } from "../src/verify-ids";

let root: string;
const meta = {id:"anilist:205289",type:"movie",name:"Norman",poster:"https://example.com/poster.jpg"};
beforeEach(async()=>{root=await fs.mkdtemp(path.join(os.tmpdir(),"verify-native-"));await fs.mkdir(path.join(root,"catalog/movie"),{recursive:true});});
afterEach(async()=>{jest.restoreAllMocks();if(path.dirname(root)!==path.resolve(os.tmpdir()))throw Error("Unsafe cleanup");await fs.rm(root,{recursive:true,force:true});});
const write = (metas: unknown) => fs.writeFile(path.join(root,"catalog/movie/catalog.json"),JSON.stringify({metas}));
it("validates all entries without contacting providers or requiring artwork",async()=>{
    await write([meta,{id:"anilist:1",type:"movie",name:"Title"},meta]);
    const network=jest.spyOn(global,"fetch");expect(await verifyIds(root)).toEqual({files:1,entries:3,uniqueTitles:2});expect(network).not.toHaveBeenCalled();
});
it.each([
    {...meta,id:"kitsu:51003"}, {...meta,name:""}, {...meta,type:"series"}, {...meta,poster:"javascript:bad"}, {...meta,description:"unneeded"},
])("rejects invalid identities, types, display metadata or unnecessary fields",async value=>{await write([value]);await expect(verifyIds(root)).rejects.toThrow();});
it("checks IMDb exports with the required tt ID format",async()=>{
    await write([{...meta,id:"tt1234567"}]);
    await expect(verifyIds(root)).rejects.toThrow("anilist identity");expect((await verifyIds(root,"imdb")).entries).toBe(1);
});
it("refuses malformed and empty catalog trees",async()=>{
    await expect(verifyIds(root)).rejects.toThrow("No catalogs");await write(null);await expect(verifyIds(root)).rejects.toThrow("Invalid catalog");
});
