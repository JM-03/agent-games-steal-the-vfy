FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json && npm prune --omit=dev
COPY circuits ./circuits
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
