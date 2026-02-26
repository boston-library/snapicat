"""Azure Function HTTP handler for generating MARC/MARCXML from OCLC numbers."""

import json
import logging
import os
from typing import Literal

import azure.functions as func
from pydantic import BaseModel, Field

from src.shared import auth_token_validation, constants, oclc_service, oclc_token_manager

logger = logging.getLogger(__name__)


class GenerateXmlRequestDTO(BaseModel):
    """Request body for generate XML: list of OCLC numbers and format."""

    books: list[str] = Field(default_factory=list)
    format: Literal["marcxml", "marc"] = "marcxml"


async def main(req: func.HttpRequest) -> func.HttpResponse:
    """Validate token, parse body, call oclc_service.generate_xml, return XML attachment."""
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
        dto = GenerateXmlRequestDTO.model_validate(body)
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
        format_type = dto.format or "marcxml"
        xml_str = svc.generate_xml(oclc_numbers=dto.books or [], format_type=format_type)
    except Exception as e:
        logger.exception("generate_xml: internal error")
        body = {"error": constants.ERROR_MESSAGES["server_error"]}
        if os.environ.get("FUNCTIONS_ENVIRONMENT") == "Development":
            body["detail"] = str(e)
        return func.HttpResponse(
            body=json.dumps(body),
            status_code=500,
            mimetype="application/json",
        )

    if format_type == "marcxml":
        content_type = "application/marcxml+xml"
        ext = "xml"
    else:
        content_type = "application/marc"
        ext = "mrc"
    body_bytes = xml_str.encode("utf-8")
    filename = f"export.{ext}"
    return func.HttpResponse(
        body=body_bytes,
        status_code=200,
        mimetype=content_type,
        headers={
            "Content-Type": content_type,
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )
