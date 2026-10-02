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
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
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

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/search/multi?query=the+bear");
    expect(init.headers).toMatchObject({ Authorization: "Bearer secret" });
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
