FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/
RUN npm ci --workspace @egomot/api --include-workspace-root

COPY apps/api ./apps/api
RUN npm run prisma:generate --workspace @egomot/api

EXPOSE 3000
CMD ["npm", "run", "dev", "--workspace", "@egomot/api"]
