FROM node:20-alpine AS base
RUN apk add --no-cache openssl libc6-compat

# One install for the whole build. Both the builder and the Prisma CLI copied into
# the runner come from this stage, so the two can no longer drift (the previous
# `npm ci --omit=dev` here plus `npm install` in the builder produced two
# different trees and mutated the lockfile during the build).
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci && npx prisma generate

FROM base AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3030
# Standalone output bundles the server's runtime deps; the Prisma CLI (with its
# build assets and engines) is added only for `migrate deploy` at startup.
# Run the CLI via its real package entrypoint: the .bin shim would resolve the
# schema wasm relative to .bin/ and fail.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=deps --chown=node:node /app/node_modules/prisma ./node_modules/prisma
COPY --from=deps --chown=node:node /app/node_modules/@prisma ./node_modules/@prisma
# Do not run the server as root; nothing here is written to at runtime.
USER node
EXPOSE 3030
CMD ["sh", "-c", "node ./node_modules/prisma/build/index.js migrate deploy && node server.js"]
