# Dev-oriented image: runs `next dev` with hot reload against the compose network.
# A multi-stage production build (next build / standalone) is a later hardening step.
FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
