import type { TitleType } from "./native-meta";

export enum Season {
    WINTER = "WINTER", // December to February
    SPRING = "SPRING", // March to May
    SUMMER = "SUMMER", // June to August
    FALL = "FALL" // September to November
}

/**
 * Convert month to season
 * @param month Month must be between 0 and 11
 */
export function monthToSeason(month: number): Season {
    if (!Number.isInteger(month)) throw new Error("Month must be between 0 and 11");
    if (month === 11 || month >= 0 && month <= 1) return Season.WINTER;
    if (month >= 2 && month <= 4) return Season.SPRING;
    if (month >= 5 && month <= 7) return Season.SUMMER;
    if (month >= 8 && month <= 10) return Season.FALL;
    throw new Error("Month must be between 0 and 11");
}

/**
 * Create a sorted list of seasons based on the first season provided
 * @param firstSeason current season of the year that should be first in the list of seasons
 * @returns Sorted list of seasons with the first season being the one passed as argument
 */
export function createSortedSeasonList(firstSeason: Season): Season[] {
  switch (firstSeason) {
    case Season.WINTER:
      return [Season.WINTER, Season.SPRING, Season.SUMMER, Season.FALL];
    case Season.SPRING:
      return [Season.SPRING, Season.SUMMER, Season.FALL, Season.WINTER];
    case Season.SUMMER:
      return [Season.SUMMER, Season.FALL, Season.WINTER, Season.SPRING];
    case Season.FALL:
      return [Season.FALL, Season.WINTER, Season.SPRING, Season.SUMMER];
    default:
      throw new Error("Invalid season");
  }
}

/**
 * Generate query string for GraphQL based on template and arguments
 * @param year Queried year
 * @param season Queried season
 * @returns The query string
 */
export function query(year: number, season: Season, format: TitleType = "movie", page = 1): string{
    if (!Number.isSafeInteger(page) || page < 1) throw new Error("Invalid AniList page.");
    if (year < 2000 || year > (new Date()).getUTCFullYear()) throw new Error("Year must be between 2000 and now");
    const formatFilter = format === "movie" ? "format:MOVIE" : "format_in:[TV,TV_SHORT,OVA,SPECIAL,ONA]";
    return `query {
        Page(perPage: 50, page: ${page}) {
          pageInfo { hasNextPage }
          media(seasonYear:${year}, season:${season}, sort:[POPULARITY_DESC,ID_DESC], type:ANIME, isAdult:false, ${formatFilter}) {
            id
            isAdult
            title {
              romaji
              english
            }
            startDate { year }
            coverImage {
              large
            }
          }
        }
      }`
}
