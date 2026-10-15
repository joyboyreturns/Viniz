import unittest
from music_provider import song, songs


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
