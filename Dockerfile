# Stage 1: build
FROM node:24-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++   # compile bcrypt
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev                   # drop dev deps, keep compiled bcrypt

# Stage 2: run
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
USER node
EXPOSE 3000
CMD ["node", "dist/main"]
