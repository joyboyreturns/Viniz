# Viniz

Viniz is a beautiful, self-hosted listening history and statistics dashboard for [Navidrome](https://www.navidrome.org/). It acts as a local ListenBrainz server, intercepting scrobbles from Navidrome to generate rich visualizations of your top tracks, artists, and albums.

## AI Setup Prompt

If an AI coding assistant is helping you set up Viniz, use this prompt:

```
I want to set up Viniz, a Navidrome listening history dashboard.

Prerequisites:
- Docker and Docker Compose installed
- Navidrome already running (container name: <navidrome_container_name>)
- Path to Navidrome database file: <path_to_navidrome.db>
- Navidrome and Viniz should be on the same Docker network

Steps to complete:
1. Clone: git clone https://github.com/joyboyreturns/Viniz.git && cd Viniz
2. Update docker-compose.yml:
   - Set the Navidrome DB volume mount to the correct path
   - Change NAVIDROME_HOST to the Navidrome container name
   - Set NAVIDROME_USER and NAVIDROME_PASS
   - Ensure Viniz is on the same Docker network as Navidrome
3. Run: docker compose up -d
4. Configure Navidrome env vars:
   - ND_LISTENBRAINZ_BASEURL=http://viniz:4096/apis/listenbrainz/1/
   - ND_SCROBBLER_LISTENBRAINZ_URL=http://viniz:4096/apis/listenbrainz/1/
   - ND_LISTENBRAINZTOKEN=viniz_token
   - ND_LISTENBRAINZ_ENABLED=true
5. Restart Navidrome
6. Verify: curl http://localhost:4096/api/stats/summary
```

## Features

- **Beautiful UI**: Modern, glassmorphism dashboard.
- **Top Stats**: View your most played tracks, albums, and artists.
- **Filtering**: Filter by Today, Last 7 Days, Last Month, etc.
- **Data Export/Import**: Easily backup and restore your listening history in JSON format.
- **Search**: Quickly find specific artists, albums, or tracks.
- **Local First**: Everything stays on your local network. No external services required.

## Installation

### 1. Configure Viniz

Create a `docker-compose.yml` file:

```yaml
services:
  viniz:
    build: .
    container_name: viniz
    restart: unless-stopped
    ports:
      - "4096:4096"
    volumes:
      - ./data:/app/data
      - /path/to/your/navidrome.db:/app/navidrome/navidrome.db:ro
    environment:
      - NODE_ENV=production
      - NAVIDROME_DB_PATH=/app/navidrome/navidrome.db
      - NAVIDROME_HOST=navidrome
      - NAVIDROME_PORT=4533
      - NAVIDROME_USER=admin
      - NAVIDROME_PASS=your_password_here
```

> **Important**: If Navidrome is not on the default Docker network, add Viniz to the same network:
> ```yaml
> networks:
>   - your_shared_network
> 
> networks:
>   your_shared_network:
>     external: true
> ```

Start the container:
```bash
docker compose up -d
```

### 2. Configure Navidrome

You need to tell Navidrome to send its scrobbles to Viniz. Add these environment variables to your Navidrome `docker-compose.yml`:

```yaml
      - ND_LISTENBRAINZ_BASEURL=http://viniz:4096/apis/listenbrainz/1/
      - ND_SCROBBLER_LISTENBRAINZ_URL=http://viniz:4096/apis/listenbrainz/1/
      - ND_LISTENBRAINZTOKEN=viniz_token
      - ND_LISTENBRAINZ_ENABLED=true
```

> If Viniz and Navidrome are not on the same Docker network, replace `viniz` with the Viniz container's IP or host IP.

Restart Navidrome, and your listening stats will start populating!

## Access

Open your browser and navigate to `http://localhost:4096`.
