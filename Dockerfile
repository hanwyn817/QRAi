FROM node:20-alpine AS web-builder

WORKDIR /app/web
COPY web/package.json web/package.json
COPY web/package-lock.json web/package-lock.json
COPY web/tsconfig.json web/tsconfig.json
COPY web/vite.config.ts web/vite.config.ts
COPY web/index.html web/index.html
COPY web/src web/src
RUN npm ci
RUN npm run build

FROM node:20-alpine

WORKDIR /app
COPY package.json package.json
COPY package-lock.json package-lock.json
COPY tsconfig.json tsconfig.json
COPY src src
COPY scripts scripts
COPY migrations migrations
COPY resources resources
RUN npm ci --omit=dev

COPY --from=web-builder /app/web/dist /app/web/dist

ENV NODE_ENV=production
ENV PORT=8787

CMD ["npm", "run", "start"]
