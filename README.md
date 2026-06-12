# Viniz

Viniz is a beautiful, self-hosted listening history and statistics dashboard for [Navidrome](https://www.navidrome.org/). It acts as a local ListenBrainz server, intercepting scrobbles from Navidrome to generate rich visualizations of your top tracks, artists, and albums.

## Features

- **Beautiful UI**: Modern, glassmorphism dashboard.
- **Top Stats**: View your most played tracks, albums, and artists.
- **Filtering**: Filter by Today, Last 7 Days, Last Month, etc.
- **Data Export/Import**: Easily backup and restore your listening history in JSON format.
- **Search**: Quickly find specific artists, albums, or tracks.
- **Local First**: Everything stays on your local network. No external services required.

## Installation

You can easily deploy Viniz using Docker Compose. Make sure you point Viniz to your Navidrome database so it can fetch track durations and metadata.

### 1. Configure Viniz

Create a `docker-compose.yml` file:

```yaml
version: '3.8'

services:
  viniz:
    image: joyboyreturns/viniz:latest # or build from source
    build: .
    container_name: viniz
    restart: unless-stopped
    ports:
      - "4096:4096"
    volumes:
      - ./viniz_data:/app/data
      # Important: Mount your Navidrome database read-only
      - /path/to/your/navidrome.db:/app/navidrome/navidrome.db:ro
    environment:
      - NODE_ENV=production
      - NAVIDROME_DB_PATH=/app/navidrome/navidrome.db
```

Start the container:
```bash
docker compose up -d
```

### 2. Configure Navidrome

You need to tell Navidrome to send its scrobbles to Viniz. Add these environment variables to your Navidrome `docker-compose.yml`:

```yaml
      - ND_LISTENBRAINZ_BASEURL=http://<viniz-ip>:4096/apis/listenbrainz/1/
      - ND_SCROBBLER_LISTENBRAINZ_URL=http://<viniz-ip>:4096/apis/listenbrainz/1/
      - ND_LISTENBRAINZTOKEN=viniz_token
      - ND_LISTENBRAINZ_ENABLED=true
```

Restart Navidrome, and your listening stats will start populating!

## Access

Open your browser and navigate to `http://localhost:4096`.
