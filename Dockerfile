# 念念（Particle Diary）生产镜像
#
# 多阶段构建：
#   Stage 1 (build)   — 装全量依赖（含 vite/tsc）编译前端到 dist/
#   Stage 2 (runtime) — 只装生产依赖，体积更小
#
# 构建：docker build -t particle-diary .
# 运行：docker run -p 3001:3001 --env-file .env particle-diary

# ---------- Stage 1: 构建前端 ----------
FROM node:22-slim AS build
WORKDIR /app

# 先只复制清单文件，最大化 Docker 层缓存命中率
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------- Stage 2: 生产运行 ----------
FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
# 账号数据默认落在 /app/server/data；挂载持久卷时把此变量指向卷路径
ENV PARTICLE_DIARY_DATA_DIR=/app/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 从构建阶段取编译产物，单独复制 server 与 tsconfig（tsx 运行时需要）
COPY --from=build /app/dist ./dist
COPY server ./server
COPY tsconfig.json tsconfig.node.json ./

RUN mkdir -p /app/data

EXPOSE 3001

# 直接调用 tsx 二进制，不经过 npm，保证 SIGTERM 能正确传到 Node 进程
CMD ["/app/node_modules/.bin/tsx", "server/index.ts"]
