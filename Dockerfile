FROM node:20-alpine
RUN apk add --no-cache python3 py3-pip py3-virtualenv ffmpeg make g++ sqlite sqlite-dev curl \
    && virtualenv /opt/music-env \
    && /opt/music-env/bin/pip install --no-cache-dir yt-dlp spotdl syncedlyrics mutagen ytmusicapi
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 4096
CMD ["node", "server.js"]
