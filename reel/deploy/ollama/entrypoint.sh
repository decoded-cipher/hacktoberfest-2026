#!/bin/sh
# Start Ollama, make sure the configured model is present, then keep serving.
# OLLAMA_MODEL can be a library model (qwen3:1.7b) or a GGUF on Hugging Face (hf.co/<user>/<repo>).
set -e
ollama serve &
server=$!
until ollama list >/dev/null 2>&1; do sleep 1; done
ollama pull "${OLLAMA_MODEL:-qwen3:1.7b}"
echo "Serving ${OLLAMA_MODEL:-qwen3:1.7b}"
wait "$server"
