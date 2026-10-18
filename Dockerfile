FROM node:20-slim
RUN apt-get update && apt-get install -y stockfish && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["node", "server.js"]
