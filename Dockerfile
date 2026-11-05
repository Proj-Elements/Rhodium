FROM node:22.23.4-alpine3.24 AS base
RUN apk add --no-cache openssl libc6-compat

# One install for the whole build. Both the builder and the Prisma CLI copied into
# the runner come from this stage, so the two can no longer drift (the previous
# `npm ci --omit=dev` here plus `npm install` in the builder produced two
# different trees and mutated the lockfile during the build).
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
# The license initializer runs explicitly with a secret in the builder stage.
RUN npm ci --ignore-scripts && npx prisma generate

FROM base AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The hpsetup key is only available during this layer and is never baked into the image.
RUN --mount=type=secret,id=heroui_key,required=true \
    HEROUI_KEY="$(cat /run/secrets/heroui_key)" CI=1 npx -y hpsetup@4.7.4 react --auto --no-cache && \
    npm run build

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
# Do not run the server as root; the runtime only reads the bundle and talks to Postgres.
USER node
EXPOSE 3030
CMD ["sh", "-c", "node ./node_modules/prisma/build/index.js migrate deploy && node server.js"]
