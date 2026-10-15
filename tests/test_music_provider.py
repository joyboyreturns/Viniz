import unittest
import json
from unittest.mock import patch
from music_provider import song, songs, run


class CatalogNormalizationTests(unittest.TestCase):
    def test_album_track_with_string_album_keeps_browse_id(self):
        result = song({"videoId": "abcdefghijk", "title": "Track", "album": "Record"},
                      fallback=[{"name": "Artist", "id": "UCexample"}],
                      album={"name": "Record", "id": "MPREb_example"})
        self.assertEqual(result["albumId"], "MPREb_example")
        self.assertEqual(result["album"], "Record")
        self.assertEqual(result["artist"], "Artist")

    def test_search_track_keeps_structured_album(self):
        result = song({"videoId": "abcdefghijk", "title": "Track",
                       "album": {"name": "Other Record", "id": "MPREb_other"}})
        self.assertEqual(result["albumId"], "MPREb_other")

    def test_unavailable_and_missing_video_entries_are_excluded(self):
        result = songs([{"title": "Deleted"}, {"videoId": "abcdefghijk", "isAvailable": False},
                        {"videoId": "01234567890", "title": "Available"}])
        self.assertEqual([item["title"] for item in result], ["Available"])


class ArtworkMatchingTests(unittest.TestCase):
    def lookup(self, title, candidate_title, artist="Camila Cabello"):
        with patch("music_provider.YTMusic") as client:
            client.return_value.search.return_value = [{"title": candidate_title, "artists": [{"name": artist}], "thumbnails": [{"url": "https://example.test/cover.jpg"}]}]
            return run("song-art", "ZZ", json.dumps({"title": title, "artists": ["Camila Cabello"]}))

    def test_legacy_youtube_title_clutter_matches_the_recording(self):
        self.assertTrue(self.lookup("Camila Cabello - Havana (Audio) ft. Young Thug", "Havana (feat. Young Thug)")["image"])
        self.assertTrue(self.lookup("Camila Cabello - Havana (Lyrics)", "Havana")["image"])

    def test_unrelated_artist_is_rejected(self):
        self.assertFalse(self.lookup("Havana", "Havana", "Different Artist")["image"])

    def test_recording_versions_are_not_removed(self):
        self.assertFalse(self.lookup("Havana (Live)", "Havana")["image"])
