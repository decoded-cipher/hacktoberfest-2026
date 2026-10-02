import { describe, expect, it } from "vitest";
import { makeTitle, syntheticRatings } from "../evals/synthetic.ts";
import { featureRow, TasteProfile } from "../src/recommend/features.ts";
import {
  KnnModel,
  RidgeModel,
  solve,
  TmdbScoreModel,
  toMatrix,
  UserMeanModel,
} from "../src/recommend/models.ts";

const mae = (a: number[], b: number[]) =>
  a.reduce((s, x, i) => s + Math.abs(x - (b[i] ?? 0)), 0) / a.length;

/** Hold out the last 25% and score a model on it. */
async function holdoutMae(model: { fitPredict: KnnModel["fitPredict"] }) {
  const all = syntheticRatings(240);
  const train = all.slice(0, 180);
  const test = all.slice(180);
  const profile = new TasteProfile(train);
  const pred = await model.fitPredict(
    train.map((r) => featureRow(r.title, profile)),
    train.map((r) => r.rating),
    test.map((r) => featureRow(r.title, profile)),
  );
  return mae(
    pred,
    test.map((r) => r.rating),
  );
}

describe("TasteProfile.affinity", () => {
  it("ignores the title itself (leave-one-out)", () => {
    const a = makeTitle(1, { directors: ["X"] });
    const profile = new TasteProfile([{ title: a, rating: 5 }]);
    expect(profile.affinity(a, (t) => t.directors)).toEqual({ score: 0, count: 0 });
  });

  it("scores shared directors relative to the user's mean", () => {
    const rated = [
      { title: makeTitle(1, { directors: ["X"] }), rating: 5 },
      { title: makeTitle(2, { directors: ["Y"] }), rating: 1 },
    ];
    const profile = new TasteProfile(rated);
    const candidate = makeTitle(3, { directors: ["X"] });
    expect(profile.affinity(candidate, (t) => t.directors).score).toBeGreaterThan(0);
  });
});

describe("featureRow", () => {
  it("maps TV genre names onto movie genres", () => {
    const row = featureRow(
      makeTitle(1, { kind: "tv", genres: ["Sci-Fi & Fantasy"] }),
      new TasteProfile([]),
    );
    expect(row).toMatchObject({ is_tv: 1, genre_science_fiction: 1, genre_fantasy: 1 });
  });
});

describe("solve", () => {
  it("solves a small linear system", () => {
    const x = solve(
      [
        [2, 1],
        [1, 3],
      ],
      [3, 5],
    );
    expect(x[0]).toBeCloseTo(0.8);
    expect(x[1]).toBeCloseTo(1.4);
  });
});

describe("toMatrix", () => {
  it("one-hot encodes strings and imputes missing numbers with the mean", () => {
    const { X, T } = toMatrix(
      [
        { a: 1, lang: "en" },
        { a: 3, lang: "ko" },
      ],
      [{ a: null, lang: "fr" }],
    );
    expect(X[0]).toHaveLength(3); // a + lang=en + lang=ko
    expect(T[0]?.[0]).toBe(0); // missing → mean → 0 after standardising
    expect(X.map((r) => r[0])).toEqual([-1, 1]);
  });
});

describe("rating models on a synthetic viewer", () => {
  it("learned models beat the user-mean baseline", async () => {
    const baseline = await holdoutMae(new UserMeanModel());
    const ridge = await holdoutMae(new RidgeModel());
    const knn = await holdoutMae(new KnnModel());
    const tmdb = await holdoutMae(new TmdbScoreModel());

    expect(ridge).toBeLessThan(baseline * 0.8);
    expect(knn).toBeLessThan(baseline);
    expect(tmdb).toBeLessThan(baseline);
  });

  it("predictions stay within 0.5–5 stars", async () => {
    const rated = syntheticRatings(40);
    const profile = new TasteProfile(rated);
    const rows = rated.map((r) => featureRow(r.title, profile));
    const pred = await new RidgeModel(0.001).fitPredict(
      rows,
      rated.map(() => 5),
      rows,
    );
    for (const p of pred) {
      expect(p).toBeGreaterThanOrEqual(0.5);
      expect(p).toBeLessThanOrEqual(5);
    }
  });
});
