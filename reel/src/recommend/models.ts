import type { FeatureRow } from "./features.ts";

/** Learns one user's ratings from feature rows and predicts ratings for new rows. */
export interface RatingModel {
  readonly name: string;
  fitPredict(train: FeatureRow[], y: number[], test: FeatureRow[]): Promise<number[]>;
}

const clampRating = (x: number) => Math.min(5, Math.max(0.5, x));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 3);

/** Predicts the user's average rating for everything. */
export class UserMeanModel implements RatingModel {
  readonly name = "user mean";
  async fitPredict(_train: FeatureRow[], y: number[], test: FeatureRow[]) {
    const m = mean(y);
    return test.map(() => m);
  }
}

/** Predicts from TMDB's public score, linearly rescaled to the user's ratings. */
export class TmdbScoreModel implements RatingModel {
  readonly name = "TMDB score";
  async fitPredict(train: FeatureRow[], y: number[], test: FeatureRow[]) {
    const score = (r: FeatureRow) => (typeof r.vote_average === "number" ? r.vote_average : null);
    const pairs = train.flatMap((r, i) => {
      const s = score(r);
      const target = y[i];
      return s != null && target != null ? [[s, target] as const] : [];
    });
    const [a, b] = fitLine(pairs);
    const m = mean(y);
    return test.map((r) => {
      const s = score(r);
      return s == null ? m : clampRating(a + b * s);
    });
  }
}

/** Numeric matrix with standardised columns; strings are one-hot encoded, missing values imputed. */
export function toMatrix(
  train: FeatureRow[],
  test: FeatureRow[],
): { X: number[][]; T: number[][] } {
  const columns = new Set<string>();
  const categories = new Map<string, Set<string>>();
  for (const row of train) {
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === "string") {
        let set = categories.get(k);
        if (!set) {
          set = new Set();
          categories.set(k, set);
        }
        set.add(v);
      } else {
        columns.add(k);
      }
    }
  }
  const numeric = [...columns].filter((c) => !categories.has(c));
  const encode = (row: FeatureRow) => [
    ...numeric.map((c) => (typeof row[c] === "number" ? (row[c] as number) : Number.NaN)),
    ...[...categories].flatMap(([k, values]) => [...values].map((v) => (row[k] === v ? 1 : 0))),
  ];
  const X = train.map(encode);
  const T = test.map(encode);

  const width = X[0]?.length ?? 0;
  for (let j = 0; j < width; j++) {
    const col = X.map((r) => r[j] ?? Number.NaN).filter((v) => !Number.isNaN(v));
    const mu = mean(col);
    const sd = Math.sqrt(mean(col.map((v) => (v - mu) ** 2))) || 1;
    for (const r of [...X, ...T]) {
      const v = r[j] ?? Number.NaN;
      r[j] = Number.isNaN(v) ? 0 : (v - mu) / sd;
    }
  }
  return { X, T };
}

/** L2-regularised linear regression, solved in closed form. */
export class RidgeModel implements RatingModel {
  readonly name = "ridge regression";
  readonly #lambda: number;

  constructor(lambda = 5) {
    this.#lambda = lambda;
  }

  async fitPredict(train: FeatureRow[], y: number[], test: FeatureRow[]) {
    const { X, T } = toMatrix(train, test);
    const m = mean(y);
    const yc = y.map((v) => v - m);
    const d = X[0]?.length ?? 0;
    const A = Array.from({ length: d }, (_, i) =>
      Array.from({ length: d }, (_, j) => (i === j ? this.#lambda : 0)),
    );
    const b = new Array<number>(d).fill(0);
    X.forEach((row, n) => {
      for (let i = 0; i < d; i++) {
        b[i] = (b[i] ?? 0) + (row[i] ?? 0) * (yc[n] ?? 0);
        const Ai = A[i];
        if (!Ai) continue;
        for (let j = 0; j < d; j++) Ai[j] = (Ai[j] ?? 0) + (row[i] ?? 0) * (row[j] ?? 0);
      }
    });
    const w = solve(A, b);
    return T.map((row) => clampRating(m + row.reduce((s, v, i) => s + v * (w[i] ?? 0), 0)));
  }
}

/** Weighted average of the k most similar rated titles (cosine similarity on features). */
export class KnnModel implements RatingModel {
  readonly name = "k-nearest neighbours";
  readonly #k: number;

  constructor(k = 15) {
    this.#k = k;
  }

  async fitPredict(train: FeatureRow[], y: number[], test: FeatureRow[]) {
    const { X, T } = toMatrix(train, test);
    const m = mean(y);
    return T.map((row) => {
      const sims = X.map((x, i) => ({ s: cosine(row, x), r: y[i] ?? m }))
        .filter((n) => n.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, this.#k);
      const total = sims.reduce((s, n) => s + n.s, 0);
      if (total === 0) return m;
      return clampRating(m + sims.reduce((s, n) => s + n.s * (n.r - m), 0) / total);
    });
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function fitLine(pairs: readonly (readonly [number, number])[]): [number, number] {
  if (pairs.length < 2) return [mean(pairs.map((p) => p[1])), 0];
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  const sxx = pairs.reduce((s, [x]) => s + (x - mx) ** 2, 0);
  const sxy = pairs.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0);
  const b = sxx ? sxy / sxx : 0;
  return [my - b * mx, b];
}

/** Solve A·x = b with Gaussian elimination and partial pivoting. */
export function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i] ?? 0]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r]?.[col] ?? 0) > Math.abs(M[pivot]?.[col] ?? 0)) pivot = r;
    }
    [M[col], M[pivot]] = [M[pivot] ?? [], M[col] ?? []];
    const p = M[col]?.[col] ?? 0;
    if (Math.abs(p) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = (M[r]?.[col] ?? 0) / p;
      if (f === 0) continue;
      const Mr = M[r];
      const Mc = M[col];
      if (!Mr || !Mc) continue;
      for (let c = col; c <= n; c++) Mr[c] = (Mr[c] ?? 0) - f * (Mc[c] ?? 0);
    }
  }
  return M.map((row, i) => {
    const p = row[i] ?? 0;
    return Math.abs(p) < 1e-12 ? 0 : (row[n] ?? 0) / p;
  });
}
