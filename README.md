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

## License

Copyright (c) 2026 joyboyreturns. All Rights Reserved.

This software is provided for personal, non-commercial use only. You may not modify, distribute, sublicense, or create derivative works without prior written permission. See the [LICENSE](LICENSE) file for details.
