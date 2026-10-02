# Fine-tuning Reel's message parser with Tinker

Reel turns chat messages like *"ep5 sev s2 mid tbh"* into structured JSON. Out of the box that needs an 8B model and a long prompt full of examples. This folder fine-tunes a smaller open-weight model with [Tinker](https://thinkingmachines.ai/tinker/) (LoRA) so it does the job with a one-line prompt, faster.

## Baselines (before fine-tuning)

From `pnpm eval:parser` on the 43 hand-labelled cases in `evals/data/parser-cases.jsonl`, run locally with Ollama on an M4 Pro:

| Model | Prompt | Exact match | p50 latency |
|---|---|---|---|
| qwen3:8b | full (rules + 15 examples) | 83.7% | 2.4 s |
| qwen3:1.7b | full | 79.1% | 0.9 s |
| qwen3:8b | compact (one line, no examples) | 55.8% | 2.1 s |

The goal: a fine-tuned small model with the **compact** prompt that matches or beats the 8B model with the full prompt, at a fraction of the latency.

## 1. Build the dataset

```sh
pnpm train:dataset
```

Writes `training/data/train.jsonl`: ~2,400 synthetic chats generated from real titles and the nicknames people type (*sev*, *got*, *tlou*), many episode and rating formats (`s2e5`, `2x05`, `9/10`, `★★★★½`), typos, slang and Hinglish (*"kal raat dune 2 dekhi"*). Each has the exact JSON the parser should return. Sentences from the eval set are excluded, so the eval measures generalisation.

## 2. Train with Tinker

Needs a Tinker API key ([console](https://tinker-console.thinkingmachines.ai)) and [uv](https://docs.astral.sh/uv/). The scripts declare their own Python dependencies, so there is nothing else to install.

```sh
export TINKER_API_KEY=...
uv run training/tinker/train.py
```

Defaults: `Qwen/Qwen3.5-4B`, LoRA rank 16, 2 epochs, batch 32, learning rate 2e-4, 200 examples held out for Tinker's own eval loss. Override any of them, e.g. `uv run training/tinker/train.py model_name=Qwen/Qwen3-8B num_epochs=3`.

Checkpoints and metrics go to `training/out/reel-parser-<model>/`.

## 3. Export and run it locally

Merge the LoRA into the base model:

```sh
uv run training/tinker/export.py training/out/reel-parser-qwen3.5-4b
```

Convert to GGUF with [llama.cpp](https://github.com/ggml-org/llama.cpp) and load it into Ollama:

```sh
git clone --depth 1 https://github.com/ggml-org/llama.cpp ~/llama.cpp
RUN=training/out/reel-parser-qwen3.5-4b
uv run --with-requirements ~/llama.cpp/requirements/requirements-convert_hf_to_gguf.txt \
  ~/llama.cpp/convert_hf_to_gguf.py $RUN/hf-model --outfile $RUN/reel-parser.gguf --outtype q8_0
cp training/Modelfile $RUN/ && (cd $RUN && ollama create reel-parser -f Modelfile)
```

If llama.cpp can't convert the base model's architecture yet, train on a model it supports instead (e.g. `model_name=Qwen/Qwen3-8B`).

## 4. Measure it

```sh
pnpm eval:parser --model reel-parser --prompt compact
```

Results land in `evals/results/`. To use it in the bot, set in `.env`:

```sh
LLM_MODEL=reel-parser
LLM_PROMPT=compact
```
