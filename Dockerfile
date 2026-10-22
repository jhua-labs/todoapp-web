# todoapp-web 镜像（AD-15）：多阶段构建，Node 24 构建 dist/，nginx 托管。
# 真实镜像构建与运行由 Story 4.2（OPS-1）在 staging 完成。

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.30-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/
EXPOSE 80
