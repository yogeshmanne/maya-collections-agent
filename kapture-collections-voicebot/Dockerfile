FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src
COPY prisma ./prisma

ENV NODE_ENV=production
EXPOSE 3000

# Run migrations then start — for a first deploy. In a real pipeline you'd
# run migrations as a separate release step, not on every container start.
CMD ["sh", "-c", "node src/db/migrate.js && node src/server.js"]
