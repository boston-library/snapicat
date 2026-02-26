"""Azure Function HTTP handler for batch book search."""

import json
import logging
import os
from typing import Any

import azure.functions as func

from src.shared import auth_token_validation, constants, oclc_service, oclc_token_manager
from src.search_books.dto_class import SearchRequestDTO

logger = logging.getLogger(__name__)


async def main(req: func.HttpRequest) -> func.HttpResponse:
    """Validate token, parse body with SearchRequestDTO, run batch_search in chunks, return JSON."""
    payload = await auth_token_validation.validate_token(req)
    if payload is None:
        return func.HttpResponse(
            body=json.dumps({"error": constants.ERROR_MESSAGES["missing_auth"]}),
            status_code=401,
            mimetype="application/json",
        )

    try:
        body = req.get_json()
    except ValueError:
        return func.HttpResponse(
            body=json.dumps({"error": constants.ERROR_MESSAGES["invalid_body"]}),
            status_code=400,
            mimetype="application/json",
        )

    try:
        dto = SearchRequestDTO.model_validate(body)
    except Exception:
        return func.HttpResponse(
            body=json.dumps({"error": constants.ERROR_MESSAGES["invalid_body"]}),
            status_code=400,
            mimetype="application/json",
        )

    token_mgr = oclc_token_manager.OCLCTokenManager()
    if not token_mgr.can_make_request():
        return func.HttpResponse(
            body=json.dumps({"error": constants.ERROR_MESSAGES["oclc_error"]}),
            status_code=503,
            mimetype="application/json",
        )

    svc = oclc_service.OCLCService(token_mgr)
    try:
        results_list: list[dict[str, Any]] = []
        api_usage_remaining: Any = None
        total_processed = 0
        books = dto.books or []
        for i in range(0, len(books), constants.BATCH_SIZE):
            chunk = books[i : i + constants.BATCH_SIZE]
            chunk_results, usage = svc.batch_search(
                chunk,
                append_query=dto.appendSearchQuery,
                sorting_order=dto.sortingOrder,
                is_refining=dto.isRefining,
            )
            results_list.extend(chunk_results)
            total_processed += len(chunk)
            if usage is not None:
                api_usage_remaining = usage

        return func.HttpResponse(
            body=json.dumps({
                "success": True,
                "books": results_list,
                "total_processed": total_processed,
                "api_usage_remaining": api_usage_remaining,
            }),
            status_code=200,
            mimetype="application/json",
        )
    except Exception as e:
        logger.exception("search_books: internal error")
        body = {"error": constants.ERROR_MESSAGES["server_error"]}
        if os.environ.get("FUNCTIONS_ENVIRONMENT") == "Development":
            body["detail"] = str(e)
        return func.HttpResponse(
            body=json.dumps(body),
            status_code=500,
            mimetype="application/json",
        )
