FROM mcr.microsoft.com/presidio-analyzer:latest

USER root

# Configure pip timeout and retries to prevent network download timeouts
ENV PIP_DEFAULT_TIMEOUT=120 \
    PIP_RETRIES=5

# Install Spanish spaCy model
RUN poetry run python -m spacy download es_core_news_md

# Copy Spanish analyzer, NLP, and custom recognizers configs
COPY analyzer.yaml /app/presidio_analyzer/conf/analyzer.yaml
COPY nlp.yaml /app/presidio_analyzer/conf/nlp.yaml
COPY recognizers.yaml /app/presidio_analyzer/conf/recognizers.yaml

ENV ANALYZER_CONF_FILE=/app/presidio_analyzer/conf/analyzer.yaml
ENV NLP_CONF_FILE=/app/presidio_analyzer/conf/nlp.yaml
ENV RECOGNIZER_REGISTRY_CONF_FILE=/app/presidio_analyzer/conf/recognizers.yaml
ENV PORT=3000

EXPOSE 3000
