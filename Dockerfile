FROM node:20-alpine
RUN apk add --no-cache python3 make g++ sqlite sqlite-dev curl
WORKDIR /app
COPY package*.json ./
RUN npm install sqlite3 --build-from-source --sqlite=/usr
RUN npm install
COPY . .
EXPOSE 4096
CMD ["node", "server.js"]
