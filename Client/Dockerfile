FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/out/standalone ./
COPY --from=build /app/out/static ./out/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
