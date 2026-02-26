import json
import logging
import os
from typing import Optional

import azure.functions as func
from azure.functions import FunctionApp, AuthLevel

logger = logging.getLogger(__name__)

app = FunctionApp(http_auth_level=AuthLevel.FUNCTION)


def _error_response(message: str, detail: Optional[str] = None, status_code: int = 500) -> func.HttpResponse:
    body = {"error": message}
    if detail and os.environ.get("FUNCTIONS_ENVIRONMENT") == "Development":
        body["detail"] = detail
    return func.HttpResponse(
        body=json.dumps(body),
        status_code=status_code,
        mimetype="application/json",
    )


@app.function_name(name="search_books")
@app.route(route="search_books", methods=["POST"])
async def search_books(req: func.HttpRequest) -> func.HttpResponse:
    try:
        from src.search_books.handler import main
        return await main(req)
    except Exception as e:
        logger.exception("search_books function failed")
        return _error_response("An internal server error occurred.", detail=str(e))


@app.function_name(name="generate_xml")
@app.route(route="generate_xml", methods=["POST"])
async def generate_xml(req: func.HttpRequest) -> func.HttpResponse:
    try:
        from src.generate_xml.handler import main
        return await main(req)
    except Exception as e:
        logger.exception("generate_xml function failed")
        return _error_response("An internal server error occurred.", detail=str(e))
