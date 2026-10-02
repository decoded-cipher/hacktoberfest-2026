import { describe, expect, it, vi } from "vitest";
import { TmdbClient, TmdbError } from "../src/tmdb/client.ts";

const searchBody = {
  results: [
    {
      id: 95396,
      media_type: "tv",
      name: "Severance",
      first_air_date: "2022-02-17",
      overview: "Office workers' memories are surgically divided.",
      poster_path: "/sev.jpg",
      popularity: 120.5,
      vote_average: 8.4,
      vote_count: 2500,
    },
    { id: 1, media_type: "person", name: "Adam Scott" },
    {
      id: 693134,
      media_type: "movie",
      title: "Dune: Part Two",
      release_date: "2024-02-27",
      overview: "Paul Atreides unites with the Fremen.",
      poster_path: null,
      popularity: 300,
      vote_average: 8.2,
      vote_count: 6000,
    },
  ],
};

function mockFetch(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
}

describe("TmdbClient.search", () => {
  it("maps movies and shows and drops people", async () => {
    const fetch = mockFetch(searchBody);
    const tmdb = new TmdbClient({ accessToken: "t", fetch });

    const results = await tmdb.search("sev");

    expect(results).toEqual([
      expect.objectContaining({ tmdbId: 95396, kind: "tv", title: "Severance", year: 2022 }),
      expect.objectContaining({
        tmdbId: 693134,
        kind: "movie",
        title: "Dune: Part Two",
        year: 2024,
      }),
    ]);
  });

  it("sends the bearer token and query", async () => {
    const fetch = mockFetch(searchBody);
    await new TmdbClient({ accessToken: "secret", fetch }).search("the bear");

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toContain("/search/multi?query=the+bear");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer secret" });
  });

  it("caches responses until the TTL expires", async () => {
    let now = 0;
    const fetch = mockFetch(searchBody);
    const tmdb = new TmdbClient({ accessToken: "t", fetch, ttlMs: 1000, now: () => now });

    await tmdb.search("sev");
    await tmdb.search("sev");
    expect(fetch).toHaveBeenCalledTimes(1);

    now = 1001;
    await tmdb.search("sev");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("throws TmdbError on HTTP errors", async () => {
    const tmdb = new TmdbClient({ accessToken: "bad", fetch: mockFetch({}, 401) });

    await expect(tmdb.search("x")).rejects.toBeInstanceOf(TmdbError);
  });
});

describe("TmdbClient.details", () => {
  it("maps a movie with its director, cast and keywords", async () => {
    const fetch = mockFetch({
      id: 693134,
      title: "Dune: Part Two",
      release_date: "2024-02-27",
      runtime: 167,
      genres: [{ id: 1, name: "Science Fiction" }],
      original_language: "en",
      credits: {
        cast: [{ name: "Timothée Chalamet" }, { name: "Zendaya" }],
        crew: [
          { name: "Denis Villeneuve", job: "Director" },
          { name: "Hans Zimmer", job: "Original Music Composer" },
        ],
      },
      keywords: { keywords: [{ name: "desert" }] },
    });
    const d = await new TmdbClient({ accessToken: "t", fetch }).details("movie", 693134);

    expect(d).toMatchObject({
      kind: "movie",
      year: 2024,
      runtime: 167,
      genres: ["Science Fiction"],
      directors: ["Denis Villeneuve"],
      cast: ["Timothée Chalamet", "Zendaya"],
      keywords: ["desert"],
      status: null,
    });
  });

  it("maps a show with creators, seasons and the next episode", async () => {
    const fetch = mockFetch({
      id: 95396,
      name: "Severance",
      first_air_date: "2022-02-17",
      episode_run_time: [50],
      status: "Returning Series",
      created_by: [{ name: "Dan Erickson" }],
      seasons: [
        { season_number: 0, episode_count: 3, air_date: null },
        { season_number: 1, episode_count: 9, air_date: "2022-02-17" },
      ],
      next_episode_to_air: {
        season_number: 2,
        episode_number: 1,
        name: "Hello",
        air_date: "2025-01-17",
      },
      keywords: { results: [{ name: "office" }] },
    });
    const d = await new TmdbClient({ accessToken: "t", fetch }).details("tv", 95396);

    expect(d).toMatchObject({
      runtime: 50,
      directors: ["Dan Erickson"],
      keywords: ["office"],
      status: "Returning Series",
      seasons: [{ seasonNumber: 1, episodeCount: 9, airDate: "2022-02-17" }],
      nextEpisodeToAir: { seasonNumber: 2, episodeNumber: 1, name: "Hello" },
    });
  });
});

describe("TmdbClient.findByImdbId", () => {
  it("returns the movie or show for an IMDb id", async () => {
    const fetch = mockFetch({ movie_results: [], tv_results: [{ id: 95396, name: "Severance" }] });
    const found = await new TmdbClient({ accessToken: "t", fetch }).findByImdbId("tt11280740");

    expect(found).toMatchObject({ kind: "tv", tmdbId: 95396 });
    expect(String(fetch.mock.calls[0]?.[0])).toContain("/find/tt11280740?external_source=imdb_id");
  });
});
