import { anilistId, fallbackMeta, validateMeta } from "../src/native-meta";

const anime = { id: 205289, title: { english: "Norman the Snowman: Kodomo-tachi no Hitotsuboshi", romaji: "Norman" },
    description: "Unneeded synopsis", genres: ["Fantasy"], startDate: { year: 2013 }, coverImage: { large: "https://example.com/poster.jpg" } };
afterEach(() => jest.restoreAllMocks());
it.each([1,"205289",Number.MAX_SAFE_INTEGER])("exports source identity %s without requests",id=>{
    const network=jest.spyOn(global,"fetch");expect(anilistId(id)).toBe(`anilist:${id}`);expect(network).not.toHaveBeenCalled();
});
it.each([undefined,null,false,{},"","0",0,-1,"01","1x","tt1234567","1.5",1.5,NaN,Infinity,"9007199254740992"])("rejects invalid identity %s",value=>expect(()=>anilistId(value)).toThrow("Invalid source"));
it("keeps only ID, type, full title, poster and year",()=>{
    const network=jest.spyOn(global,"fetch");expect(fallbackMeta(anime,"movie")).toEqual({id:"anilist:205289",type:"movie",name:anime.title.english,poster:anime.coverImage.large,releaseInfo:"2013"});expect(network).not.toHaveBeenCalled();
});
it.each([176373,213908,205289])("does not guess a different title for reported anime %i",id=>expect(fallbackMeta({...anime,id},"movie").id).toBe(`anilist:${id}`));
it("uses romaji and a minimal display fallback when optional fields are missing",()=>{
    expect(fallbackMeta({id:1,title:{english:" ",romaji:"Romaji"}},"series",2026)).toEqual({id:"anilist:1",type:"series",name:"Romaji",releaseInfo:"2026"});
    expect(fallbackMeta({id:1},"series")).toEqual({id:"anilist:1",type:"series",name:"Anime 1"});
});
it("omits invalid artwork and years without making more requests",()=>{
    const meta=fallbackMeta({id:1,coverImage:{large:"https://user:secret@example.com/poster.jpg"},startDate:{year:"2026"}},"series");expect(meta).toEqual({id:"anilist:1",type:"series",name:"Anime 1"});
});
it("validates native and IMDb identities separately and rejects unnecessary full metadata",()=>{
    const meta=fallbackMeta(anime,"movie");expect(()=>validateMeta(meta,"movie")).not.toThrow();
    expect(()=>validateMeta({...meta,id:"tt1234567"},"movie")).toThrow("anilist identity");
    expect(()=>validateMeta({...meta,id:"tt1234567"},"movie","imdb")).not.toThrow();
    expect(()=>validateMeta(meta,"series")).toThrow("type");
    for(const field of ["description","background","genres","behaviorHints","anilistId"])expect(()=>validateMeta({...meta,[field]:"unused"})).toThrow("full-metadata");
});
