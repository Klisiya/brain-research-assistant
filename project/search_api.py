"""One public search boundary with no session-dependent content expansion."""
from flask import jsonify, request
from sqlalchemy.exc import SQLAlchemyError
from search_service import SearchService, SearchValidationError, parse_search


def register_search_api(app, db, Paper, Course, Module, Area, limiter):
    service = SearchService(db, Paper, Course, Module, Area)
    app.extensions['search_service'] = service

    @app.after_request
    def search_headers(response):
        if request.path == '/api/search':
            response.headers['Cache-Control'] = 'private, no-store'
            response.headers['X-Content-Type-Options'] = 'nosniff'
            response.vary.add('Cookie')
        return response

    @app.get('/api/search')
    @limiter.limit('120/minute', exempt_when=lambda: app.testing)
    def search_public():
        try:
            return jsonify(service.search(parse_search(request.args)))
        except SearchValidationError as error:
            return jsonify(error=str(error), code='SEARCH_VALIDATION_ERROR'), 400
        except (SQLAlchemyError, ValueError) as error:
            db.session.rollback()
            app.logger.error('Search failed category=%s', type(error).__name__)
            return jsonify(error='Search is unavailable. Please retry.', code='SEARCH_UNAVAILABLE'), 503
