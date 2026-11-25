import { promises as fs } from "fs";
import path from "path";
import { Season, createSortedSeasonList, monthToSeason, query } from "./query";
import { Anilist } from "./request";
import { fallbackMeta, Meta, TitleType, validateMeta } from "./native-meta";
export type { Meta } from "./native-meta";

export type SeasonCatalogs = Record<TitleType, Meta[]>;
const SERIES_FORMATS = new Set(["TV", "TV_SHORT", "OVA", "SPECIAL", "ONA"]);

export async function fetchSeasonCatalogs(year: number, season: Season, onlyType?: TitleType): Promise<SeasonCatalogs> {
    const catalogs: SeasonCatalogs = { movie: [], series: [] };
    const seen = new Set<string>();
    const client = new Anilist();
    for (let page = 1; ; page++) {
        const response = await client.fetch(query(year, season, onlyType, page));
        const results = response?.data?.Page?.media;
        if (!Array.isArray(results)) throw new Error(`Unexpected AniList response for ${season}/${year}: missing data.Page.media`);
        const more = response.data.Page.pageInfo?.hasNextPage;
        if (typeof more !== "boolean") throw new Error("Missing AniList pagination state.");
        let fresh = 0;
        for (const anime of results) {
            if (typeof anime?.isAdult !== "boolean") throw new Error("Missing AniList adult classification.");
            if (anime.isAdult) continue;
            const type = onlyType || (anime.format === "MOVIE" ? "movie" : SERIES_FORMATS.has(anime.format) ? "series" : undefined);
            if (!type) throw new Error("Missing or unsupported AniList format.");
            const meta = fallbackMeta(anime, type, year);
            if (!seen.has(meta.id)) { seen.add(meta.id); catalogs[type].push(meta); fresh++; }
        }
        if (!more) break;
        if (!fresh || page >= 1000) throw new Error("AniList pagination did not advance.");
    }
    return catalogs;
}

export class Catalog {
    private metas: Meta[] = [];
    constructor(private pathFile: string) {}
    addMeta(meta: Meta) { this.metas.push(meta); }
    getMetas(): Meta[] { return this.metas; }
    async writeToFile() {
        for (const meta of this.metas) validateMeta(meta);
        await fs.writeFile(this.pathFile, JSON.stringify({ metas: this.metas }, null, 2) + "\n");
    }
    async populate(year: number, season: Season, type: TitleType) {
        // Append only after the entire season succeeds.
        this.metas.push(...(await fetchSeasonCatalogs(year, season, type))[type]);
    }
}
export type CatalogExtra = {
    name: string;
    options: string[];
    isRequired: boolean;
}
export type CatalogDescription = {
    id: string;
    type: TitleType;
    name: string;
    extra: CatalogExtra[];
    extraSupported: string[];
}
enum CatalogType {
    LATEST = "latest",
    ARCHIVE = "archive"
}
type AbstractManifest = {
    id: string;
    version: string;
    name: string;
    description: string;
    logo: string;
    resources: string[];
    types: string[];
    catalogs: CatalogDescription[];
    idPrefixes: string[];
    lastUpdatedAt?: Date;
}
export class Manifest implements AbstractManifest {
    async update(today: Date) {
        this.lastUpdatedAt = today;
        let [major, minor, patch] = this.version.split(".");
        this.version = `${major}.${Number.parseInt(minor)+1}.${patch}`;
        this.years = Manifest.dateToYears(today);
        this.seasons = Manifest.dateToSeasons(today);
        for (const catalog of this.catalogs) {
            if (catalog.id == "archive_anime_seasons") {
                catalog.extra[0].options = this.years;
                catalog.extra[0].isRequired = false;
            }
            else if (catalog.id == "latest_anime_seasons") {
                catalog.extra[0].options = this.seasons;
            }
        }
        await this.writeToFile();
    }

    /**
     * Create a file at path with the contents of metas
     */
    async writeToFile() {
        await fs.writeFile(this.pathFile, JSON.stringify({
            id: this.id,
            version: this.version,
            name: this.name,
            description: this.description,
            logo: this.logo,
            resources: this.resources,
            types: this.types,
            catalogs: this.catalogs,
            idPrefixes: this.idPrefixes,
            lastUpdatedAt: this.lastUpdatedAt,
        }, null, 2) + "\n");
    }

    getLastUpdate() : Date {
        return this.lastUpdatedAt;
    }
    private seasons: Season[];
    private years: string[];
    constructor(
        private pathFile: string,
        public id: string,
        public version: string,
        public name: string,
        public description: string,
        public logo: string,
        public resources: string[],
        public types: string[],
        public idPrefixes: string[],
        public catalogs: CatalogDescription[],
        public lastUpdatedAt: Date = new Date(1970, 0, 1)
    ){
        if (catalogs.length == 0) {
            this.catalogs = [];
            this.seasons = Manifest.dateToSeasons(lastUpdatedAt);
            this.years = Manifest.dateToYears(lastUpdatedAt);
            this.addCatalog("series", CatalogType.LATEST);
            this.addCatalog("movie", CatalogType.LATEST);
            this.addCatalog("series", CatalogType.ARCHIVE);
            this.addCatalog("movie", CatalogType.ARCHIVE);
        }
        else {
            this.catalogs = catalogs;
            this.seasons = catalogs.find(catalog => catalog.id == "latest_anime_seasons")?.extra[0].options as Season[];
            this.years = catalogs.find(catalog => catalog.id == "archive_anime_seasons")?.extra[0].options as string[];
        }
    }
    static fromObject(pathFile: string, obj: AbstractManifest) : Manifest {
        return new Manifest(
            pathFile,
            obj.id,
            obj.version,
            obj.name,
            obj.description,
            obj.logo,
            obj.resources,
            obj.types,
            obj.idPrefixes,
            obj.catalogs,
            obj?.lastUpdatedAt
        );
    }
    static default(pathFile: string) : Manifest {
        return Manifest.fromObject(pathFile, {
            id: "animes-season-addon",
            version: "1.2.0",
            name: "Animes' season",
            description: "A catalog addon for the latest anime seasons",
            logo: "https://digizik.github.io/animes-season-addon/logo.png",
            resources: ["catalog"],
            types: ["movie","series"],
            catalogs: [],
            idPrefixes: ["anilist"]
          } as AbstractManifest);
    }
    static async fromFile(filePath: string) : Promise<Manifest> {
        const manifest = await fs.readFile(filePath, "utf-8");
        const obj = JSON.parse(manifest);
        obj.lastUpdatedAt = new Date(obj.lastUpdatedAt);
        return Manifest.fromObject(filePath, obj);
    }
    getSeasons() : Season[] {
        return this.seasons;
    }
    getYears() : string[] {
        return this.years;
    }
    private static dateToYears(today: Date) : string[] {
        const years = []
        for (let y = today.getUTCFullYear(); y >= 2001; y--) {
            years.push(y.toString());
        }
        return years
    }
    private static dateToSeasons(today: Date) : Season[] {
        const currentMonth = today.getUTCMonth();
        const currentSeason = monthToSeason(currentMonth);
        return createSortedSeasonList(currentSeason);
    }
    private addCatalog(contentType: TitleType, catalogType: CatalogType) {
        this.catalogs.push({
            type: contentType,
            id: catalogType == CatalogType.LATEST ? "latest_anime_seasons" : "archive_anime_seasons",
            name: catalogType == CatalogType.LATEST ? "Anime Seasons" : "Anime Years",
            extra: [{ 
                name: "genre", 
                options: catalogType == CatalogType.LATEST ? this.seasons : this.years, 
                isRequired: false}
            ],
            "extraSupported": ["genre"]
          });
    }
}
  


export class Stremio {
    private static baseDir = ".";
    static async createManifestIfNotExists(filePath: string) : Promise<Manifest> {
        const manifestPath = `${this.baseDir}/${filePath}/manifest.json`;
        const dir = path.dirname(manifestPath);
        let manifest: Manifest;
        try {
            manifest = await Manifest.fromFile(manifestPath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            await fs.mkdir(dir, { recursive: true });
            manifest = Manifest.default(manifestPath);
            await manifest.writeToFile();
        }
        return manifest;
    }
    static async createCatalogIfNotExists(filePath: string) : Promise<Catalog> {
        const dir = path.dirname(`${this.baseDir}/catalog/${filePath}`);
        await fs.mkdir(dir, { recursive: true });
        return new Catalog(`${this.baseDir}/catalog/${filePath}`);
    }
}
