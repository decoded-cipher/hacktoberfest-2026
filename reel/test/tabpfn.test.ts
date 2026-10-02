import { describe, expect, it, vi } from "vitest";
import { TabPfnError, TabPfnModel, toCsv } from "../src/recommend/tabpfn.ts";

const signed = (name: string) => ({
  signed_urls: [`https://storage.example/${name}`],
  required_headers: { "x-goog-meta": name },
});

/** Fake Prior Labs API that records uploads and echoes one prediction per test row. */
function fakeApi(options: { fitBody?: string; predictStatus?: number } = {}) {
  const uploads = new Map<string, string>();
  const requests: {
    url: string;
    method: string;
    body?: unknown;
    headers?: RequestInit["headers"];
  }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const json =
      typeof init?.body === "string" && method === "POST" ? JSON.parse(init.body) : undefined;
    requests.push({ url, method, body: json, headers: init?.headers });

    if (method === "PUT") {
      uploads.set(url.split("/").at(-1) ?? "", String(init?.body));
      return new Response(null, { status: 200 });
    }
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.endsWith("/tabpfn/prepare_train_set_upload")) {
      return reply({
        train_set_upload_id: "tr1",
        x_train_info: signed("x_train"),
        y_train_info: signed("y_train"),
      });
    }
    if (url.endsWith("/tabpfn/fit")) {
      return new Response(options.fitBody ?? JSON.stringify({ fitted_train_set_id: "fit1" }));
    }
    if (url.endsWith("/tabpfn/prepare_test_set_upload")) {
      return reply({ test_set_upload_id: "te1", x_test_info: signed("x_test") });
    }
    if (url.endsWith("/tabpfn/predict")) {
      if (options.predictStatus)
        return reply({ message: "budget exceeded" }, options.predictStatus);
      const rows = (uploads.get("x_test") ?? "").split("\n").length - 1;
      return reply({
        prediction: Array.from({ length: rows }, (_, i) => 3 + i),
        task: "regression",
      });
    }
    return reply({ message: "not found" }, 404);
  });
  return { fetch, uploads, requests };
}

describe("TabPfnModel", () => {
  const train = [
    { year: 2016, language: "en", genre_drama: 1 },
    { year: 2024, language: "ko", genre_drama: 0 },
  ];

  it("runs upload → fit → predict and returns clamped predictions", async () => {
    const api = fakeApi();
    const model = new TabPfnModel({ apiKey: "key", fetch: api.fetch });

    const pred = await model.fitPredict(
      train,
      [4.5, 2],
      [train[0] ?? {}, train[1] ?? {}, train[0] ?? {}],
    );

    expect(pred).toEqual([3, 4, 5]); // 3, 4, 5 → 5 is the max
    expect(api.uploads.get("x_train")).toBe("year,language,genre_drama\n2016,en,1\n2024,ko,0");
    expect(api.uploads.get("y_train")).toBe("rating\n4.5\n2");
    const fit = api.requests.find((r) => r.url.endsWith("/fit"));
    expect(fit?.body).toMatchObject({ train_set_upload_id: "tr1", task: "regression" });
    const predict = api.requests.find((r) => r.url.endsWith("/predict"));
    expect(predict?.body).toMatchObject({
      test_set_upload_id: "te1",
      fitted_train_set_id: "fit1",
      task_config: { task: "regression", predict_params: { output_type: "mean" } },
    });
    expect(api.requests[0]?.headers).toMatchObject({ Authorization: "Bearer key" });
    const put = api.requests.find((r) => r.method === "PUT");
    expect(put?.headers).toMatchObject({ "x-goog-meta": expect.any(String) });
  });

  it("tolerates whitespace streamed before a slow fit's JSON", async () => {
    const api = fakeApi({ fitBody: `   \n  ${JSON.stringify({ fitted_train_set_id: "fit1" })}` });
    const model = new TabPfnModel({ apiKey: "key", fetch: api.fetch });
    await expect(model.fitPredict(train, [4, 2], train)).resolves.toHaveLength(2);
  });

  it("raises TabPfnError with the server message on failure", async () => {
    const api = fakeApi({ predictStatus: 429 });
    const model = new TabPfnModel({ apiKey: "key", fetch: api.fetch });
    await expect(model.fitPredict(train, [4, 2], train)).rejects.toThrow(/429.*budget exceeded/);
    await expect(model.fitPredict(train, [4, 2], train)).rejects.toBeInstanceOf(TabPfnError);
  });

  it("skips the API when there is nothing to predict", async () => {
    const api = fakeApi();
    expect(
      await new TabPfnModel({ apiKey: "k", fetch: api.fetch }).fitPredict(train, [1, 2], []),
    ).toEqual([]);
    expect(api.fetch).not.toHaveBeenCalled();
  });
});

describe("toCsv", () => {
  it("quotes values with commas or quotes and blanks missing values", () => {
    expect(toCsv(["a", "b", "c"], [{ a: 'Say "hi", ok', b: null, c: Number.NaN }])).toBe(
      'a,b,c\n"Say ""hi"", ok",,',
    );
  });
});
