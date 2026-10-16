# syntax=docker/dockerfile:1
# 卫戍协议：盟约 · 服务器生产容器镜像
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    SP_VERIFY=off \
    SP_COMBAT=client \
    TRUST_PROXY=auto

WORKDIR /app

# 代码、依赖与素材已完整打包在镜像中，无需联网二次下载
COPY package.json package-lock.json ./
COPY node_modules ./node_modules
COPY shared ./shared
COPY server ./server
COPY data ./data
COPY public ./public
COPY docs/research ./docs/research
COPY tools/doctor.mjs ./tools/doctor.mjs

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1

CMD ["node", "server/index.js"]
