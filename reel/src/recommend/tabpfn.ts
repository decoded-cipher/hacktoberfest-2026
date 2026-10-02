import { z } from "zod";
import type { FeatureRow } from "./features.ts";
import type { RatingModel } from "./models.ts";

const BASE_URL = "https://api.priorlabs.ai";

const SignedUpload = z.object({
  signed_urls: z.array(z.string()).min(1),
  required_headers: z.record(z.string(), z.string()).default({}),
});

const PrepareTrain = z.object({
  train_set_upload_id: z.string(),
  x_train_info: SignedUpload,
  y_train_info: SignedUpload,
});
const Fit = z.object({ fitted_train_set_id: z.string() });
const PrepareTest = z.object({ test_set_upload_id: z.string(), x_test_info: SignedUpload });
const Predict = z.object({ prediction: z.array(z.number()) });

export class TabPfnError extends Error {}

export interface TabPfnOptions {
  apiKey: string;
  modelPath?: string;
  fetch?: typeof fetch;
}

/**
 * TabPFN regression through the Prior Labs REST API:
 * upload train CSVs → fit → upload test CSV → predict (mean).
 */
export class TabPfnModel implements RatingModel {
  readonly name = "TabPFN";
  readonly #apiKey: string;
  readonly #modelPath: string;
  readonly #fetch: typeof fetch;

  constructor(options: TabPfnOptions) {
    this.#apiKey = options.apiKey;
    this.#modelPath = options.modelPath ?? "v3.5_default";
    this.#fetch = options.fetch ?? fetch;
  }

  async fitPredict(train: FeatureRow[], y: number[], test: FeatureRow[]): Promise<number[]> {
    if (test.length === 0) return [];
    const columns = Object.keys(train[0] ?? test[0] ?? {});

    const prep = PrepareTrain.parse(
      await this.#post("/tabpfn/prepare_train_set_upload", {
        x_train_info: { format: "csv" },
        y_train_info: { format: "csv" },
      }),
    );
    await Promise.all([
      this.#upload(prep.x_train_info, toCsv(columns, train)),
      this.#upload(
        prep.y_train_info,
        toCsv(
          ["rating"],
          y.map((rating) => ({ rating })),
        ),
      ),
    ]);

    const fit = Fit.parse(
      await this.#post("/tabpfn/fit", {
        train_set_upload_id: prep.train_set_upload_id,
        task: "regression",
        tabpfn_config: { model_path: this.#modelPath },
      }),
    );

    const testPrep = PrepareTest.parse(
      await this.#post("/tabpfn/prepare_test_set_upload", {
        fitted_train_set_id: fit.fitted_train_set_id,
        x_test_info: { format: "csv" },
      }),
    );
    await this.#upload(testPrep.x_test_info, toCsv(columns, test));

    const result = Predict.parse(
      await this.#post("/tabpfn/predict", {
        test_set_upload_id: testPrep.test_set_upload_id,
        fitted_train_set_id: fit.fitted_train_set_id,
        task_config: { task: "regression", predict_params: { output_type: "mean" } },
      }),
    );
    if (result.prediction.length !== test.length) {
      throw new TabPfnError(`Expected ${test.length} predictions, got ${result.prediction.length}`);
    }
    return result.prediction.map((p) => Math.min(5, Math.max(0.5, p)));
  }

  async #post(path: string, body: unknown): Promise<unknown> {
    const res = await this.#fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.#apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // Long fits stream whitespace before the JSON body, so read it all and trim.
    const text = (await res.text()).trim();
    if (!res.ok)
      throw new TabPfnError(`TabPFN ${path} failed (${res.status}): ${text.slice(0, 300)}`);
    return JSON.parse(text);
  }

  async #upload(target: z.infer<typeof SignedUpload>, csv: string): Promise<void> {
    const url = target.signed_urls[0];
    if (!url) throw new TabPfnError("No signed upload URL");
    const res = await this.#fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "text/csv", ...target.required_headers },
      body: csv,
    });
    if (!res.ok) throw new TabPfnError(`TabPFN upload failed (${res.status})`);
  }
}

export function toCsv(columns: string[], rows: FeatureRow[]): string {
  const cell = (v: FeatureRow[string] | undefined) => {
    if (v == null || (typeof v === "number" && !Number.isFinite(v))) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join(
    "\n",
  );
}
