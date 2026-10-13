"""Public catalog search; authenticated Hub results never expand to drafts."""
from flask import jsonify, request
from flask_login import current_user
from sqlalchemy.exc import SQLAlchemyError
from search_service import SearchService, SearchValidationError, parse_search


def register_search_api(app, db, Paper, Course, Module, Area, limiter, HubEntry=None, HubRevision=None):
    service = SearchService(db, Paper, Course, Module, Area, HubEntry, HubRevision)
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
            params = parse_search(request.args)
            if params['type'] == 'hub' and not current_user.is_authenticated:
                return jsonify(error='Sign in to search Innovation Hub.', code='AUTH_REQUIRED'), 401
            return jsonify(service.search(params, include_hub=current_user.is_authenticated))
        except SearchValidationError as error:
            return jsonify(error=str(error), code='SEARCH_VALIDATION_ERROR'), 400
        except (SQLAlchemyError, ValueError) as error:
            db.session.rollback()
            app.logger.error('Search failed category=%s', type(error).__name__)
            return jsonify(error='Search is unavailable. Please retry.', code='SEARCH_UNAVAILABLE'), 503
