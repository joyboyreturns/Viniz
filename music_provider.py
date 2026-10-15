"""Read public YouTube Music catalog metadata. Never downloads media."""
import json
import sys
import requests
import re
import unicodedata
from ytmusicapi import YTMusic


class TimedSession(requests.Session):
    def request(self, *args, **kwargs):
        kwargs.setdefault("timeout", 15)
        return super().request(*args, **kwargs)


def image(item):
    thumbs = item.get("thumbnails") or []
    return thumbs[-1].get("url", "") if thumbs else ""


def artists(item, fallback=None):
    return [{"name": a.get("name", ""), "id": a.get("id") or a.get("browseId", "")}
            for a in (item.get("artists") or fallback or []) if a.get("name")]


def song(item, fallback=None, artwork="", album=None):
    aid = item.get("videoId")
    if not aid or item.get("isAvailable") is False:
        return None
    people = artists(item, fallback)
    record = item.get("album")
    if not isinstance(record, dict):
        record = album or {"name": record if isinstance(record, str) else ""}
    return {"id": aid, "kind": "song", "title": item.get("title", "Untitled"),
            "artists": people, "artist": ", ".join(a["name"] for a in people),
            "album": record.get("name", ""), "albumId": record.get("id", ""),
            "image": image(item) or artwork, "duration": item.get("duration", ""),
            "durationSeconds": item.get("duration_seconds", 0),
            "explicit": bool(item.get("isExplicit")), "views": item.get("views"),
            "url": "https://www.youtube.com/watch?v=" + aid,
            "embedUrl": "https://www.youtube-nocookie.com/embed/" + aid,
            "provider": "YouTube Music"}


def album_card(item, fallback=None):
    people = artists(item, fallback)
    return {"id": item.get("browseId", ""), "kind": "album", "title": item.get("title", "Untitled"),
            "artists": people, "artist": ", ".join(a["name"] for a in people),
            "image": image(item), "year": item.get("year") or "", "type": item.get("type") or "Album",
            "provider": "YouTube Music"}


def artist_card(item):
    return {"id": item.get("browseId") or item.get("id", ""), "kind": "artist",
            "title": item.get("title") or item.get("artist") or item.get("name", "Unknown artist"),
            "image": image(item), "subscribers": item.get("subscribers", ""),
            "rank": item.get("rank"), "trend": item.get("trend"), "provider": "YouTube Music"}


def songs(items, **kwargs):
    return [s for item in items if (s := song(item, **kwargs))]


def run(operation, country, value):
    y = YTMusic(language="en", location="US" if country == "ZZ" else country, requests_session=TimedSession())
    def normalized(text):
        return re.sub(r"[^\w]", "", unicodedata.normalize("NFKC", str(text or "")).casefold())
    if operation == "artist-art":
        matches = y.search(value, filter="artists", limit=10)
        hit = next((a for a in matches if normalized(a.get("artist") or a.get("title")) == normalized(value)), None)
        return {"image": image(hit) if hit else ""}
    if operation in ("song-art", "album-art"):
        wanted = json.loads(value)
        def clean_title(text):
            text = str(text or "")
            if " - " in text and normalized(text.split(" - ", 1)[0]) in {normalized(a) for a in wanted["artists"]}:
                text = text.split(" - ", 1)[1]
            text = re.sub(r"[\[(](?:official(?: music)?(?: video| audio)?|lyrics?|audio|visualizer|4k(?: remaster)?)[^\])]*[\])]", "", text, flags=re.I)
            text = re.sub(r"\s*[\[(]?\s*\b(?:feat\.?|ft\.?|featuring)\s+.*$", "", text, flags=re.I)
            return normalized(text.strip())
        search_title = wanted["title"]
        if " - " in search_title and normalized(search_title.split(" - ", 1)[0]) in {normalized(a) for a in wanted["artists"]}:
            search_title = search_title.split(" - ", 1)[1]
        matches = y.search(search_title + " " + " ".join(wanted["artists"]), filter="albums" if operation == "album-art" else "songs", limit=10)
        hit = next((a for a in matches if clean_title(a.get("title")) == clean_title(wanted["title"])
                    and set(normalized(n) for n in wanted["artists"]) & set(normalized(n.get("name")) for n in a.get("artists", []))), None)
        if not hit and operation == "song-art":
            videos = y.search(search_title + " " + " ".join(wanted["artists"]), filter="videos", limit=10)
            hit = next((a for a in videos if clean_title(a.get("title")) == clean_title(wanted["title"])
                        and set(normalized(n) for n in wanted["artists"]) & set(normalized(n.get("name")) for n in a.get("artists", []))), None)
        return {"image": image(hit) if hit else ""}
    if operation in ("trending", "artists", "recent"):
        chart = y.get_charts(country)
        # Explicit country chart selection matters: YouTube's home/explore shelves can
        # follow the server's IP region even when the client location is configured.
        selected = (chart.get("countries") or {}).get("selected", {}).get("text", "")
        people = [artist_card(a) for a in chart.get("artists", [])]
        result = {"country": country, "countryName": selected,
                  "countries": (chart.get("countries") or {}).get("options", []),
                  "artists": people[:30], "items": [], "albums": [], "source": "youtube"}
        if operation == "artists":
            result["items"] = people[:50]
            result["label"] = "YouTube Music chart artists"
            return result
        if operation == "recent":
            releases = {}
            for person in people[:5]:
                try:
                    detail = y.get_artist(person["id"])
                    fallback = [{"name": person["title"], "id": person["id"]}]
                    for section in ("albums", "singles"):
                        for entry in (detail.get(section) or {}).get("results", [])[:5]:
                            card = album_card(entry, fallback)
                            if card["id"]:
                                releases[card["id"]] = card
                except Exception:
                    continue
            result["items"] = sorted(releases.values(), key=lambda a: str(a["year"]), reverse=True)[:30]
            result["label"] = "Recent releases from this country's chart artists"
            return result
        playlists = chart.get("videos") or []
        chosen = next((p for p in playlists if "daily top music" in p.get("title", "").lower()), None)
        chosen = chosen or next((p for p in playlists if "top 100 music" in p.get("title", "").lower()), None)
        chosen = chosen or next((p for p in playlists if "trending" in p.get("title", "").lower()), None)
        if not chosen:
            raise ValueError("YouTube Music has no public song chart for this country.")
        playlist = y.get_playlist(chosen["playlistId"], limit=40)
        result["items"] = songs(playlist.get("tracks", []))[:40]
        result["label"] = chosen["title"]
        result["chartUrl"] = "https://music.youtube.com/playlist?list=" + chosen["playlistId"]
        return result
    if operation == "search":
        return {"source": "youtube", "country": country, "label": "YouTube Music search",
                "items": songs(y.search(value, filter="songs", limit=30))[:30],
                "artists": [artist_card(a) for a in y.search(value, filter="artists", limit=8)][:8],
                "albums": [album_card(a) for a in y.search(value, filter="albums", limit=12)][:12]}
    if operation == "artist":
        detail = y.get_artist(value)
        fallback = [{"name": detail.get("name", ""), "id": value}]
        entries = (detail.get("songs") or {}).get("results", [])
        playlist_id = (detail.get("songs") or {}).get("browseId")
        if playlist_id:
            try:
                entries = y.get_playlist(playlist_id, limit=30).get("tracks", entries)
            except Exception:
                pass
        records = [(entry, section) for section in ("albums", "singles")
                   for entry in (detail.get(section) or {}).get("results", [])]
        return {"kind": "artist", "id": value, "title": detail.get("name", "Artist"),
                "image": image(detail), "description": detail.get("description", ""),
                "subscribers": detail.get("subscribers", ""),
                "items": songs(entries, fallback=fallback)[:30],
                "albums": [album_card(entry, fallback) for entry, _ in records],
                "artists": [artist_card(a) for a in (detail.get("related") or {}).get("results", [])][:12]}
    if operation == "album":
        detail = y.get_album(value)
        people = artists(detail)
        artwork = image(detail)
        return {"kind": "album", "id": value, "title": detail.get("title", "Album"),
                "image": artwork, "artists": people, "artist": ", ".join(a["name"] for a in people),
                "description": detail.get("description", ""), "year": detail.get("year", ""),
                "items": songs(detail.get("tracks", []), fallback=people, artwork=artwork,
                               album={"name": detail.get("title", ""), "id": value}), "albums": []}
    raise ValueError("Unknown catalog operation")


if __name__ == "__main__":
    try:
        print(json.dumps(run(*sys.argv[1:4]), ensure_ascii=False))
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
