# Viniz

Viniz is a beautiful, self-hosted listening history and statistics dashboard for [Navidrome](https://www.navidrome.org/). It acts as a local ListenBrainz server, intercepting scrobbles from Navidrome to generate rich visualizations of your top tracks, artists, and albums.

> **License**: All Rights Reserved. See [LICENSE](LICENSE). You may use this software for personal, non-commercial use only. Modification, distribution, and commercial use are prohibited.

## Quick Start (Docker)

```yaml
services:
  viniz:
    image: ghcr.io/joyboyreturns/viniz:latest
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

```bash
docker compose up -d
```

Then configure Navidrome:
```
ND_LISTENBRAINZ_BASEURL=http://viniz:4096/apis/listenbrainz/1/
ND_SCROBBLER_LISTENBRAINZ_URL=http://viniz:4096/apis/listenbrainz/1/
ND_LISTENBRAINZENABLED=true
ND_LISTENBRAINZTOKEN=viniz_token
```

Open **http://localhost:4096**.

## AI Setup Prompt

```
I want to set up Viniz, a Navidrome listening history dashboard.

Prerequisites:
- Docker and Docker Compose installed
- Navidrome already running (container name: <navidrome_container_name>)
- Path to Navidrome database file: <path_to_navidrome.db>
- Navidrome and Viniz should be on the same Docker network

Steps:
1. Create docker-compose.yml using ghcr.io/joyboyreturns/viniz:latest
2. Set the Navidrome DB volume mount to the correct path
3. Set NAVIDROME_HOST to the Navidrome container name
4. Set NAVIDROME_USER and NAVIDROME_PASS for cover art
5. Run: docker compose up -d
6. Add ListenBrainz env vars to Navidrome's docker-compose.yml
7. Restart Navidrome
8. Verify: curl http://localhost:4096/api/stats/summary
```

## Features

- **Beautiful UI**: Modern, glassmorphism dashboard.
- **Top Stats**: View your most played tracks, albums, and artists.
- **Filtering**: Filter by Today, Last 7 Days, Last Month, etc.
- **Data Export/Import**: Easily backup and restore your listening history in JSON format.
- **Search**: Quickly find specific artists, albums, or tracks.
- **Local First**: Everything stays on your local network. No external services required.

## Music discovery and library management

Viniz can also show popular and recent YouTube music videos, Spotify search and new releases, and a sortable view of the music indexed by Navidrome. YouTube discovery uses `yt-dlp` to search public YouTube metadata and needs no API key; results are cached for ten minutes to limit requests. Popular and recent feeds are ranked YouTube searches, not official chart positions. YouTube videos play through YouTube's embedded player. Spotify previews appear only when Spotify provides a preview clip; otherwise, the card opens Spotify. Spotify credentials stay in the server environment.

To enable Spotify discovery, copy `.env.example` to `.env` (keep `.env` private) and add credentials from a Spotify developer app:

```dotenv
MUSIC_REGION=US
SPOTIFY_CLIENT_ID=your-spotify-client-id
SPOTIFY_CLIENT_SECRET=your-spotify-client-secret
```

YouTube discovery and the Navidrome storage view need no provider credentials. Restart Viniz after changing Spotify credentials.

The import action is enabled in the local Docker Compose setup. It asks for confirmation that you are authorized to download the selected recording, then uses the existing `scripts/import-music.py` workflow. It does not download audio through Spotify. Navidrome scans the music folder on its configured schedule. Deleting a song permanently removes its audio file (and its matching `.lrc` sidecar) from `/mnt/cloud_storage/music`; Viniz hides it immediately while Navidrome updates its index on its next scan.

## License

Copyright (c) 2026 joyboyreturns. All Rights Reserved.

This software is provided for personal, non-commercial use only. You may not modify, distribute, sublicense, or create derivative works without prior written permission. See the [LICENSE](LICENSE) file for details.
