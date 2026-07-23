FROM debian:bookworm-slim AS rclone
ARG TARGETARCH
ARG RCLONE_VERSION=1.74.4
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) \
        archive="rclone-v${RCLONE_VERSION}-linux-amd64.zip"; \
        checksum="fe435e0c36228e7c2f116a8701f01127bb1f694005fc11d1f27186c8bca4115d" ;; \
      arm64) \
        archive="rclone-v${RCLONE_VERSION}-linux-arm64.zip"; \
        checksum="97685285c9ad6a0cf17d5844115d2a67245af6444db672187074bd9c358de419" ;; \
      *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fL --retry 3 --retry-delay 2 \
      "https://downloads.rclone.org/v${RCLONE_VERSION}/${archive}" \
      -o /tmp/rclone.zip; \
    echo "${checksum}  /tmp/rclone.zip" | sha256sum -c -; \
    unzip -q /tmp/rclone.zip -d /tmp/rclone; \
    install -D -m 0755 \
      "/tmp/rclone/rclone-v${RCLONE_VERSION}-linux-${TARGETARCH}/rclone" \
      /out/rclone

FROM node:24-bookworm-slim AS build
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ make python3 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund \
    && npm rebuild better-sqlite3-multiple-ciphers --build-from-source

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
RUN npm run build \
    && npm prune --omit=dev \
    && node -e "const Database=require('better-sqlite3-multiple-ciphers');const db=new Database(':memory:');db.prepare('SELECT 1').get();db.close()"

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    CONFIG_DIR=/config \
    FILES_DIR=/files \
    RCLONE_PATH=/usr/local/bin/rclone \
    LIBREOFFICE_PATH=/usr/bin/soffice \
    HOME=/tmp \
    XDG_CACHE_HOME=/tmp/.cache \
    NODE_OPTIONS=--max-old-space-size=512

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates tini libreoffice-writer libreoffice-calc libreoffice-impress fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 yunpaste \
    && useradd --system --uid 10001 --gid 10001 \
      --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin yunpaste \
    && install -d -o yunpaste -g yunpaste -m 0700 /config /files

ARG APP_VERSION=1.13.0
ARG VCS_REF=unknown
ARG RCLONE_VERSION=1.74.4
ENV APP_VERSION=${APP_VERSION}

LABEL org.opencontainers.image.title="云粘贴" \
      org.opencontainers.image.description="自托管的多用户网络粘贴板与文件管理系统" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      io.yunpaste.rclone.version="${RCLONE_VERSION}"

COPY --from=rclone /out/rclone /usr/local/bin/rclone
RUN env -u RCLONE_VERSION /usr/local/bin/rclone version \
    | grep -F "rclone v${RCLONE_VERSION}"
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server
COPY --chmod=0555 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

USER 10001:10001
EXPOSE 8787
VOLUME ["/config", "/files"]

HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:8787/readyz',{signal:AbortSignal.timeout(7000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server/index.mjs"]
