# Serveur MonMeeting : interface web + API (rédaction via Ollama, transcription via le service ASR).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
ARG VITE_MODE_ENTREPRISE=0
ENV VITE_MODE_ENTREPRISE=$VITE_MODE_ENTREPRISE
RUN npm run build:web

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev && npm install --no-save --omit=dev --ignore-scripts tsx \
    && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
USER node
EXPOSE 8787
CMD ["npx", "tsx", "server/index.ts"]
