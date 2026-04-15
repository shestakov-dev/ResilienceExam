FROM node:22-alpine AS base

WORKDIR /usr/src/app

# Use the repository lockfile through corepack-managed pnpm.
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

FROM base AS build

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY test ./test

RUN pnpm run build

FROM base AS runtime

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=build /usr/src/app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/src/server.js"]