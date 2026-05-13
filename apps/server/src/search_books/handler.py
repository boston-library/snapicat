"""Azure Function HTTP handler for batch book search."""

import azure.functions as func
import json
import logging
import uuid
import asyncio
from typing import List, Dict, Any

from src.shared.oclc_service import OCLCService
from src.shared.oclc_token_manager import OCLCTokenManager
from src.shared.auth_token_validation import validate_token
from src.shared.constants import BATCH_SIZE
from src.search_books.dto_class import SearchRequestDTO

async def process_batch(
    oclc_service: OCLCService,
    books: List[Dict[str, Any]],
    append_query: str,
    sorting_order: str,
    is_refining: bool,
    correlation_id: str
) -> tuple[List[Dict[str, Any]], int]:
    """Process a batch of books and return results with API usage"""
    try:
        results, api_usage = await oclc_service.batch_search(
            books,
            append_query=append_query.strip() if append_query else '',
            sorting_order=sorting_order,
            isRefining=is_refining
        )
        return results, api_usage
    except Exception as e:
        logging.error(f"[{correlation_id}] Error processing batch: {str(e)}")
        return [], 0

async def main(req: func.HttpRequest) -> func.HttpResponse:
    """Search for books using OCLC API"""
    correlation_id = str(uuid.uuid4())

    logging.info(f'[{correlation_id}] Processing search request')
    try:
        # Validate Microsoft token
        decoded_token = await validate_token(req)
        if not decoded_token:
            logging.error(f"[{correlation_id}] Token validation failed")
            return func.HttpResponse(
                json.dumps({
                    "success": False,
                    "error": "Unauthorized",
                    "message": "Invalid token"
                }),
                status_code=401,
                headers={"Content-Type": "application/json"}
            )

        # Parse request body
        try:
            req_body = req.get_json()
        except (ValueError, TypeError):
            return func.HttpResponse(
                json.dumps({
                    "success": False,
                    "error": "Request body is required and must be valid JSON"
                }),
                status_code=400,
                headers={"Content-Type": "application/json"}
            )
        if not req_body:
            return func.HttpResponse(
                json.dumps({
                    "success": False,
                    "error": "Request body is required"
                }),
                status_code=400,
                headers={"Content-Type": "application/json"}
            )

        # Validate request body
        try:
            search_request = SearchRequestDTO.model_validate(req_body)
        except Exception as e:
            logging.error(f"[{correlation_id}] Validation error: {str(e)}")
            return func.HttpResponse(
                json.dumps({
                    "success": False,
                    "error": "Validation error",
                    "message": str(e)
                }),
                status_code=400,
                headers={"Content-Type": "application/json"}
            )

        # Initialize OCLC service
        try:
            token_manager = OCLCTokenManager()
            oclc_service = OCLCService(token_manager)
        except ValueError as ve:
            logging.error(f"[{correlation_id}] OCLC config error: {str(ve)}")
            return func.HttpResponse(
                json.dumps({
                    "success": False,
                    "error": "Service unavailable",
                    "message": "OCLC credentials not configured"
                }),
                status_code=503,
                headers={"Content-Type": "application/json"}
            )

        # Process books in batches
        all_results = []
        total_processed = 0
        api_usage = 0

        # Convert books to list of dictionaries
        books_data = search_request.books

        # Process in batches
        for i in range(0, len(books_data), BATCH_SIZE):
            batch = books_data[i:i + BATCH_SIZE]
            batch_results, batch_api_usage = await process_batch(
                oclc_service,
                batch,
                search_request.appendSearchQuery,
                search_request.sortingOrder,
                search_request.isRefining,
                correlation_id
            )

            all_results.extend(batch_results)
            total_processed += len(batch)
            api_usage = batch_api_usage  # Keep track of the latest API usage

            # Add a small delay between batches to prevent rate limiting
            if i + BATCH_SIZE < len(books_data):
                await asyncio.sleep(1)

        if not all_results:
            return func.HttpResponse(
                json.dumps({
                    "success": False,
                    "error": "No results found for the provided search criteria"
                }),
                status_code=404,
                headers={"Content-Type": "application/json"}
            )

        if api_usage == 0:
            logging.warning(f"[{correlation_id}] Rate limit exceeded, no results returned")
            return func.HttpResponse(
                json.dumps({
                    "success": False,
                    "error": "Rate limit exceeded",
                    "message": "No results returned due to rate limiting"
                }),
                status_code=429,
                headers={"Content-Type": "application/json"}
            )

        return func.HttpResponse(
            json.dumps({
                "success": True,
                "books": all_results,
                "total_processed": total_processed,
                "api_usage_remaining": api_usage
            }),
            status_code=200,
            headers={"Content-Type": "application/json"}
        )

    except Exception as e:
        logging.exception(f"[{correlation_id}] Error processing search request: %s", e)
        return func.HttpResponse(
            json.dumps({
                "success": False,
                "error": str(e),
                "message": "Error processing search request"
            }),
            status_code=500,
            headers={"Content-Type": "application/json"}
        )
