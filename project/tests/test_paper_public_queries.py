"""Public Papers search, filtering, and pagination tests."""
from datetime import datetime
import os
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from app import app, db, Paper, User


class PublicPaperQueryTests(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        with app.app_context():
            db.session.remove()
            db.engine.dispose()

    def setUp(self):
        app.config.update(TESTING=True, SECRET_KEY="public-query-test")
        self.client = app.test_client()
        with app.app_context():
            db.create_all()
            owner = User(
                id=100,
                username="query-owner",
                email="query-owner@example.test",
                role="teacher",
            )
            owner.set_password("test-only-password")
            db.session.add(owner)
            db.session.flush()

            publication_types = [
                "Research Article", "Review", "Book Chapter", "Learning Resource",
            ]
            difficulties = ["Beginner", "Intermediate", "Advanced"]
            for paper_id in range(1, 64):
                boundary = paper_id == 51
                db.session.add(Paper(
                    id=paper_id,
                    slug=f"query-paper-{paper_id}",
                    title="Boundary Paper Fifty One" if boundary else f"Query Paper {paper_id:02d}",
                    authors=["Boundary Author" if boundary else f"Author {paper_id % 9}"],
                    year=1960 + paper_id,
                    journal="Boundary Journal" if boundary else "Query Journal",
                    publication_type=publication_types[paper_id % len(publication_types)],
                    topics=["BoundaryTopic" if boundary else f"Topic {paper_id % 7}"],
                    difficulty=difficulties[paper_id % len(difficulties)],
                    estimated_reading_minutes=5 + paper_id,
                    abstract="Boundary abstract" if boundary else f"Abstract {paper_id}",
                    learning_objectives=["Learn safely"],
                    keywords=["BoundaryKeyword" if boundary else f"Keyword {paper_id % 5}"],
                    featured=paper_id % 3 == 0,
                    open_access=True,
                    resource_category="Recommended" if paper_id % 5 == 0 else (
                        "Course Resource" if paper_id % 7 == 0 else "Foundational"
                    ),
                    status="published",
                    created_by_id=owner.id,
                    created_at=datetime(2026, 1, 1),
                    updated_at=datetime(2026, 1, 1),
                    published_at=datetime(2026, 1, min(paper_id, 28)),
                ))

            for paper_id, status in [(64, "draft"), (65, "archived")]:
                db.session.add(Paper(
                    id=paper_id,
                    slug=f"hidden-{paper_id}",
                    title=f"Hidden {status} BoundarySecret",
                    authors=["Hidden Author"],
                    year=2026,
                    journal="Hidden",
                    publication_type="Research Article",
                    topics=["HiddenTopic"],
                    difficulty="Beginner",
                    estimated_reading_minutes=5,
                    abstract="Hidden",
                    learning_objectives=[],
                    keywords=["BoundarySecret"],
                    featured=True,
                    open_access=False,
                    resource_category="Recommended",
                    status=status,
                    created_by_id=owner.id,
                ))
            db.session.commit()

    def tearDown(self):
        with app.app_context():
            db.session.remove()
            db.drop_all()

    def get(self, query=""):
        response = self.client.get(f"/api/papers{query}")
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.json

    def test_published_only_and_totals(self):
        payload = self.get("?page=1&perPage=12")
        self.assertEqual(payload["libraryTotal"], 63)
        self.assertEqual(payload["pagination"], {
            "page": 1, "perPage": 12, "total": 63, "totalPages": 6,
        })
        self.assertTrue(all("Hidden" not in paper["title"] for paper in payload["papers"]))

    def test_boundary_record_after_fifty_is_searchable(self):
        for query in ["?q=Boundary", "?topic=BoundaryTopic", "?author=boundary%20author"]:
            with self.subTest(query=query):
                payload = self.get(query)
                self.assertEqual([paper["id"] for paper in payload["papers"]], [51])

    def test_search_covers_existing_server_fields(self):
        for term in ["Fifty One", "Boundary Author", "Boundary Journal", "Boundary abstract",
                     "BoundaryTopic", "BoundaryKeyword"]:
            with self.subTest(term=term):
                self.assertEqual(self.get(f"?q={term.replace(' ', '%20')}")["papers"][0]["id"], 51)

    def test_difficulty_publication_type_and_year(self):
        payload = self.get("?difficulty=Beginner&publicationType=Learning%20Resource&year=2011")
        self.assertEqual([paper["id"] for paper in payload["papers"]], [51])

    def test_recommended_view_uses_combined_semantics(self):
        payload = self.get("?view=recommended&perPage=50")
        self.assertGreater(payload["pagination"]["total"], 12)
        self.assertTrue(all(
            paper["featured"] or paper["resourceCategory"] == "Recommended"
            for paper in payload["papers"]
        ))
        self.assertTrue(any(not paper["featured"] for paper in payload["papers"]))
        scores = [
            int(paper["featured"]) * 2 + int(paper["resourceCategory"] == "Recommended")
            for paper in payload["papers"]
        ]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_resources_view_uses_combined_semantics(self):
        payload = self.get("?view=resources&perPage=50")
        allowed = {"Review", "Book Chapter", "Learning Resource"}
        self.assertTrue(all(
            paper["publicationType"] in allowed or paper["resourceCategory"] == "Course Resource"
            for paper in payload["papers"]
        ))
        self.assertTrue(any(
            paper["publicationType"] == "Research Article"
            and paper["resourceCategory"] == "Course Resource"
            for paper in payload["papers"]
        ))

    def test_sorting_operates_before_pagination(self):
        newest = self.get("?sort=newest&perPage=12")["papers"]
        oldest = self.get("?sort=oldest&perPage=12")["papers"]
        reading = self.get("?sort=readingTime&perPage=12")["papers"]
        title = self.get("?sort=title&perPage=12")["papers"]
        self.assertEqual([paper["year"] for paper in newest], sorted((paper["year"] for paper in newest), reverse=True))
        self.assertEqual([paper["year"] for paper in oldest], sorted(paper["year"] for paper in oldest))
        self.assertEqual([paper["estimatedReadingMinutes"] for paper in reading], list(range(6, 18)))
        self.assertEqual([paper["title"] for paper in title], sorted(paper["title"] for paper in title))

    def test_out_of_range_page_normalizes_to_last_page(self):
        payload = self.get("?page=999&perPage=12")
        self.assertEqual(payload["pagination"]["page"], 6)
        self.assertEqual(len(payload["papers"]), 3)

    def test_invalid_query_parameters_return_json_400(self):
        for query, field in [
            ("?page=0", "page"), ("?page=nope", "page"), ("?perPage=51", "perPage"),
            ("?difficulty=Expert", "difficulty"), ("?publicationType=Video", "publicationType"),
            ("?view=secret", "view"), ("?year=nope", "year"), ("?sort=random", "sort"),
        ]:
            with self.subTest(query=query):
                response = self.client.get(f"/api/papers{query}")
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json["code"], "VALIDATION_ERROR")
                self.assertEqual(response.json["field"], field)

    def test_facets_come_from_all_published_papers(self):
        payload = self.get("?q=Query%20Paper%2001&perPage=1")
        facets = payload["availableFilters"]
        self.assertIn("BoundaryTopic", facets["topics"])
        self.assertIn("Boundary Author", facets["authors"])
        self.assertIn(2011, facets["years"])
        self.assertNotIn("HiddenTopic", facets["topics"])
        self.assertEqual(set(facets["difficulties"]), {"Beginner", "Intermediate", "Advanced"})

    def test_highlights_are_stable_and_not_the_current_page(self):
        first = self.get("?page=1&sort=oldest")
        last = self.get("?page=6&sort=title")
        self.assertEqual([paper["id"] for paper in first["highlights"]],
                         [paper["id"] for paper in last["highlights"]])
        self.assertEqual(len(first["highlights"]), 12)

    def test_all_pages_have_no_duplicates_or_omissions(self):
        for view in ["all", "recommended", "resources"]:
            with self.subTest(view=view):
                first = self.get(f"?view={view}&page=1&perPage=7&sort=title")
                ids = []
                for page in range(1, first["pagination"]["totalPages"] + 1):
                    ids.extend(paper["id"] for paper in self.get(
                        f"?view={view}&page={page}&perPage=7&sort=title"
                    )["papers"])
                self.assertEqual(len(ids), first["pagination"]["total"])
                self.assertEqual(len(ids), len(set(ids)))

    def test_response_reports_normalized_filters(self):
        filters = self.get(
            "?q=Boundary&topic=BoundaryTopic&author=Boundary%20Author&difficulty=Beginner"
            "&publicationType=Learning%20Resource&year=2011&view=recommended&sort=title"
        )["filters"]
        self.assertEqual(filters["author"], "Boundary Author")
        self.assertEqual(filters["year"], 2011)
        self.assertEqual(filters["view"], "recommended")
        self.assertEqual(filters["sort"], "title")

    def test_hidden_records_never_enter_search_views_or_facets(self):
        self.assertEqual(self.get("?q=BoundarySecret")["pagination"]["total"], 0)
        self.assertEqual(self.get("?topic=HiddenTopic")["pagination"]["total"], 0)
        self.assertEqual(self.get("?author=Hidden%20Author")["pagination"]["total"], 0)
        self.assertNotIn(64, [paper["id"] for paper in self.get("?view=recommended&perPage=50")["papers"]])


if __name__ == "__main__":
    unittest.main()
