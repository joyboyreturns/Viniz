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

- **Consistent UI**: Shared studio design across Music, Listening, For you, Timeline, Insights, History, Library and Year. Dark and light themes, responsive artwork grids, charts, tables and dialogs.
- **Top Stats**: View your most played tracks, albums, and artists.
- **Filtering**: Filter by Today, Last 7 Days, Last Month, etc.
- **Data Export/Import**: Easily backup and restore your listening history in JSON format.
- **Search**: Quickly find specific artists, albums, or tracks.
- **Local First**: Everything stays on your local network. No external services required.

The shared visual system lives in `public/studio.css`, loaded after the base layout and music workspace styles. All eight tabs are directly accessible in the mobile navigation.

## Music discovery and library management

Viniz opens into a dedicated music discovery dashboard inspired by media request libraries: country charts, artwork, artist pages, album tracklists, playback, download activity and collection management.

- **Country charts:** choose Worldwide or any supported YouTube Music chart country. The feed uses public daily/top music video chart playlists, rather than keyword search or the server's IP location. Chart artists include ranks and movement when YouTube supplies them.
- **Artist and album pages:** click an artist for songs, albums, singles and related artists; click an album for its tracklist. Search returns songs, artists and albums separately.
- **Releases:** recent albums/singles from the selected country's leading chart artists, ordered by release year. This is a discovery selection, not an exhaustive list of every new release in that country.
- **Collection:** audio storage totals, free drive space, per-artist and per-album storage shares, complete sortable lists, and exact artist/album song drilldowns. Audio totals come from Navidrome and exclude artwork and lyric sidecars.
- **Downloads:** progress and logs for imports, saved in the browser so an active job can reconnect after a refresh. Saved songs are marked in discovery when their artist and title match the library.

Public catalog metadata comes from `ytmusicapi` through `music_provider.py`; downloads use the existing `yt-dlp` importer. No YouTube API key or Spotify account is required. Catalog responses are cached for 15 minutes, concurrent duplicate requests share one lookup, and provider work is limited to four processes. The optional Spotify discovery API remains available for clients with server credentials, but the dashboard uses YouTube Music.

Rebuild and deploy with `docker compose up -d --build`. If you maintain Spotify API clients, `.env.example` documents the optional credentials. The app's service worker cache is versioned to load the redesigned interface.

Artist credits are indexed individually in Viniz: a collaboration belongs to every credited artist across artist pages, playback, listening statistics and storage views. Original song credits remain visible. Artist storage includes each credited song; collection storage counts each audio file once. Multiple-value Navidrome credits are preferred, and legacy comma/featuring strings are normalized without splitting band names on `&` or `/`.

Artwork is cached in `data/artwork/`. Viniz uses existing Navidrome covers first, then validated YouTube Music artist/song matches, with a local recording match for legacy upload titles. **Repair artwork** in My collection refreshes missing portraits and covers; its status is available at `GET /api/artwork/repair`. Unmatched entries use a decorative fallback without being cached as successful artwork.

The import action is enabled in the local Docker Compose setup. It asks for confirmation that you are authorized to download the selected recording, then uses the existing `scripts/import-music.py` workflow. It does not download audio through Spotify. Navidrome scans the music folder on its configured schedule. Deleting a song permanently removes its audio file (and its matching `.lrc` sidecar) from `/mnt/cloud_storage/music`; Viniz hides it immediately while Navidrome updates its index on its next scan.

## License

Copyright (c) 2026 joyboyreturns. All Rights Reserved.

This software is provided for personal, non-commercial use only. You may not modify, distribute, sublicense, or create derivative works without prior written permission. See the [LICENSE](LICENSE) file for details.
