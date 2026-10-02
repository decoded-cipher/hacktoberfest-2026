# /// script
# requires-python = ">=3.11"
# dependencies = ["tinker-cookbook"]
# ///
"""Fine-tune a small open-weight model on Reel's message-parsing task with Tinker (LoRA SFT).

    pnpm train:dataset                         # build training/data/train.jsonl first
    export TINKER_API_KEY=...                  # from https://tinker-console.thinkingmachines.ai
    uv run training/tinker/train.py            # defaults below; override with key=value args
    uv run training/tinker/train.py model_name=Qwen/Qwen3-8B num_epochs=2

The run directory (training/out/<run>) gets checkpoints.jsonl; export.py reads the final
sampler checkpoint from it.
"""

import asyncio
import sys
from pathlib import Path

import chz
from tinker_cookbook import cli_utils, model_info
from tinker_cookbook.renderers import TrainOnWhat
from tinker_cookbook.supervised import train
from tinker_cookbook.supervised.data import FromConversationFileBuilder
from tinker_cookbook.supervised.types import ChatDatasetBuilderCommonConfig

TRAINING_DIR = Path(__file__).resolve().parent.parent
DEFAULT_MODEL = "Qwen/Qwen3.5-4B"


def build_config_blueprint(model_name: str) -> chz.Blueprint[train.Config]:
    renderer_name = model_info.get_recommended_renderer_name(model_name)
    common_config = ChatDatasetBuilderCommonConfig(
        model_name_for_tokenizer=model_name,
        renderer_name=renderer_name,
        max_length=1024,  # a system prompt + one short message + JSON fits easily
        batch_size=32,
        train_on_what=TrainOnWhat.ALL_ASSISTANT_MESSAGES,
    )
    dataset = FromConversationFileBuilder(
        common_config=common_config,
        file_path=str(TRAINING_DIR / "data" / "train.jsonl"),
        test_size=200,
    )
    run_name = model_name.split("/")[-1].lower()
    return chz.Blueprint(train.Config).apply(
        {
            "log_path": str(TRAINING_DIR / "out" / f"reel-parser-{run_name}"),
            "model_name": model_name,
            "recipe_name": "reel_parser_sft",
            "renderer_name": renderer_name,
            "dataset_builder": dataset,
            "learning_rate": 2e-4,
            "lr_schedule": "linear",
            "num_epochs": 2,
            "lora_rank": 16,
            "eval_every": 10,
            "save_every": 0,
        }
    )


def main(config: train.Config) -> None:
    cli_utils.check_log_dir(config.log_path, behavior_if_exists="ask")
    asyncio.run(train.main(config))


if __name__ == "__main__":
    model_name = cli_utils.model_name_from_argv(sys.argv[1:], default=DEFAULT_MODEL)
    blueprint = build_config_blueprint(model_name)
    blueprint.make_from_argv(sys.argv[1:])
    main(blueprint.make())
