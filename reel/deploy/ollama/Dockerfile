# Ollama serving an open-weight model on a private network (e.g. a Render private service).
FROM ollama/ollama:latest
ENV OLLAMA_HOST=0.0.0.0:11434
COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
