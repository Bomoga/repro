# Repro's sandbox image: the only place target-repo code, Semgrep, and gitleaks ever run
# (CLAUDE.md section 9). Containers from it run with --network none, so everything a scan needs,
# rules included, is baked in at build time.
#
# Build: npm run sandbox:build   (tags repro-sandbox:dev)

ARG GITLEAKS_VERSION=v8.30.1
FROM zricethezav/gitleaks:${GITLEAKS_VERSION} AS gitleaks
FROM node:22-bookworm-slim AS node

FROM python:3.12-slim-bookworm

ARG SEMGREP_VERSION=1.176.0
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir "semgrep==${SEMGREP_VERSION}" \
    && git config --system --add safe.directory '*'

COPY --from=gitleaks /usr/bin/gitleaks /usr/local/bin/gitleaks
# Node, for running JS/TS target repos' own test commands (Repair/Verify).
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# Semgrep registry packs, fetched once at build time (the run-time container has no network).
# p/javascript and p/typescript are merged and deduplicated by rule id into one "registry" pack.
COPY build/prepare-rules.py /opt/repro/build/prepare-rules.py
RUN mkdir -p /tmp/registry \
    && for p in javascript typescript python; do \
         curl -fsSL "https://semgrep.dev/c/p/$p" -o "/tmp/registry/$p.yml"; \
       done \
    && python3 /opt/repro/build/prepare-rules.py /opt/repro/rules registry /tmp/registry/*.yml \
    && rm -rf /tmp/registry

COPY rules/privacy-patterns /tmp/privacy-patterns
RUN python3 /opt/repro/build/prepare-rules.py /opt/repro/rules privacy-patterns /tmp/privacy-patterns/*.yml \
    && rm -rf /tmp/privacy-patterns

COPY gitleaks /opt/repro/gitleaks
COPY bin /opt/repro/bin

ENV PATH=/opt/repro/bin:$PATH \
    HOME=/tmp \
    SEMGREP_SEND_METRICS=off \
    SEMGREP_ENABLE_VERSION_CHECK=0 \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /workspace
