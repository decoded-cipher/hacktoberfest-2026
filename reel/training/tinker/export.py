# /// script
# requires-python = ">=3.11"
# dependencies = ["tinker-cookbook"]
# ///
"""Download a trained Reel parser from Tinker and merge it into a full Hugging Face model.

    uv run training/tinker/export.py training/out/reel-parser-qwen3.5-4b [base_model]

Writes <run>/adapter (raw Tinker LoRA) and <run>/hf-model (merged weights). Convert the
merged model to GGUF for Ollama with llama.cpp — see training/README.md.
"""

import json
import sys
from pathlib import Path

from tinker_cookbook import weights


def final_sampler_path(run_dir: Path, base_model: str | None) -> tuple[str, str]:
    """Return (sampler tinker:// path, base model) for the run's last sampler checkpoint."""
    records = [json.loads(line) for line in (run_dir / "checkpoints.jsonl").read_text().splitlines() if line]
    with_sampler = [r for r in records if r.get("sampler_path")]
    if not with_sampler:
        sys.exit(f"No sampler checkpoint in {run_dir / 'checkpoints.jsonl'}")
    if base_model is None:
        config_file = run_dir / "config.json"
        base_model = json.loads(config_file.read_text()).get("model_name") if config_file.exists() else None
    if not base_model:
        sys.exit("Couldn't find the base model in config.json; pass it as the second argument.")
    return with_sampler[-1]["sampler_path"], base_model


def main() -> None:
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__)
    run_dir = Path(sys.argv[1]).resolve()
    sampler_path, base_model = final_sampler_path(run_dir, sys.argv[2] if len(sys.argv) == 3 else None)
    print(f"Base model: {base_model}\nCheckpoint: {sampler_path}")

    adapter_dir = weights.download(tinker_path=sampler_path, output_dir=str(run_dir / "adapter"))
    weights.build_hf_model(
        base_model=base_model,
        adapter_path=adapter_dir,
        output_path=str(run_dir / "hf-model"),
    )
    print(f"Merged model written to {run_dir / 'hf-model'}")


if __name__ == "__main__":
    main()
