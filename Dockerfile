FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
USER node
EXPOSE 3000
# Apply migrations (and optionally seed) before starting the server.
CMD ["sh", "-c", "node dist/db/migrate.js && if [ \"$SEED\" = \"true\" ]; then node dist/db/seed.js; fi && node dist/server.js"]
