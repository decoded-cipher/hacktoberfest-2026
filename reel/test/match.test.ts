import { describe, expect, it } from "vitest";
import type { SearchResult } from "../src/tmdb/client.ts";
import { libraryKey, matchTitle, normalize, similarity } from "../src/tmdb/match.ts";

const title = (over: Partial<SearchResult> & Pick<SearchResult, "tmdbId" | "title">) =>
  ({
    kind: "movie",
    year: null,
    overview: "",
    posterPath: null,
    popularity: 10,
    voteAverage: 7,
    voteCount: 100,
    ...over,
  }) satisfies SearchResult;

const dune2021 = title({ tmdbId: 438631, title: "Dune", year: 2021, popularity: 150 });
const dune1984 = title({ tmdbId: 841, title: "Dune", year: 1984, popularity: 40 });
const dunePart2 = title({ tmdbId: 693134, title: "Dune: Part Two", year: 2024, popularity: 300 });
const severance = title({
  tmdbId: 95396,
  title: "Severance",
  kind: "tv",
  year: 2022,
  popularity: 120,
});
const severanceFilm = title({ tmdbId: 9999, title: "Severance", year: 2006, popularity: 8 });
const officeUS = title({
  tmdbId: 2316,
  title: "The Office",
  kind: "tv",
  year: 2005,
  popularity: 200,
});
const officeUK = title({
  tmdbId: 2996,
  title: "The Office",
  kind: "tv",
  year: 2001,
  popularity: 60,
});

describe("normalize", () => {
  it("lowercases, strips punctuation, accents and a leading 'the'", () => {
    expect(normalize("The Lord of the Rings: The Return of the King")).toBe(
      "lord of the rings the return of the king",
    );
    expect(normalize("Amélie")).toBe("amelie");
    expect(normalize("Fast & Furious")).toBe("fast and furious");
  });
});

describe("similarity", () => {
  it("is 1 for identical strings and lower for different ones", () => {
    expect(similarity("dune", "dune")).toBe(1);
    expect(similarity("dune", "dune part two")).toBeLessThan(1);
    expect(similarity("dune", "barbie")).toBe(0);
  });
});

describe("matchTitle", () => {
  it("returns none for no results", () => {
    expect(matchTitle({ query: "x" }, [])).toEqual({ status: "none" });
  });

  it("asks when the same title exists in several years", () => {
    const result = matchTitle({ query: "Dune" }, [dune2021, dune1984, dunePart2]);
    expect(result.status).toBe("ambiguous");
  });

  it("uses the year hint to pick one", () => {
    expect(matchTitle({ query: "Dune", year: 1984 }, [dune2021, dune1984, dunePart2])).toEqual({
      status: "match",
      title: dune1984,
    });
  });

  it("uses the kind hint to pick the show over the film", () => {
    expect(matchTitle({ query: "Severance", kind: "tv" }, [severance, severanceFilm])).toEqual({
      status: "match",
      title: severance,
    });
  });

  it("prefers a title already in the user's library", () => {
    const library = new Set([libraryKey("tv", officeUK.tmdbId)]);
    expect(matchTitle({ query: "the office" }, [officeUS, officeUK], library)).toEqual({
      status: "match",
      title: officeUK,
    });
  });

  it("asks between same-name shows with no other signal", () => {
    expect(matchTitle({ query: "the office" }, [officeUS, officeUK]).status).toBe("ambiguous");
  });

  it("limits candidates to three", () => {
    const many = [1, 2, 3, 4, 5].map((n) => title({ tmdbId: n, title: "Untitled" }));
    const result = matchTitle({ query: "Untitled" }, many);
    expect(result.status === "ambiguous" && result.candidates).toHaveLength(3);
  });
});
