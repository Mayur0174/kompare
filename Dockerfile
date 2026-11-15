FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY --from=build /app/dist ./dist
RUN mkdir -p data && chown -R node:node /app
USER node
EXPOSE 8787
HEALTHCHECK CMD wget -qO- http://localhost:8787/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
