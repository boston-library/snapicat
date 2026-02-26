"""Azure Function HTTP handler for generating MARC/MARCXML from OCLC numbers."""

import azure.functions as func
import json
import logging
from typing import List, Literal
from pydantic import BaseModel, Field
import uuid

from src.shared.oclc_service import OCLCService
from src.shared.oclc_token_manager import OCLCTokenManager
from src.shared.auth_token_validation import validate_token

class GenerateXmlRequestDTO(BaseModel):
    """Data Transfer Object for XML generation request"""
    books: List[str] = Field(..., description="List of OCLC numbers")
    format: Literal["marcxml", "marc"] = Field("marcxml", description="Format type: 'marcxml' for MARCXML format (application/marcxml+xml), 'marc' for raw MARC format (application/marc)")

async def main(req: func.HttpRequest) -> func.HttpResponse:
    """Generate XML for OCLC records"""
    correlation_id = str(uuid.uuid4())
    logging.info(f'[{correlation_id}] Processing XML generation request')

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
            xml_request = GenerateXmlRequestDTO.model_validate(req_body)
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

        # Generate XML with specified format
        xml_content = await oclc_service.generate_xml(xml_request.books, xml_request.format)

        if not xml_content:
            return func.HttpResponse(
                json.dumps({
                    "success": False,
                    "error": "No records found for the provided OCLC numbers"
                }),
                status_code=404,
                headers={"Content-Type": "application/json"}
            )

        # Set appropriate content type and filename based on format
        if xml_request.format == "marcxml":
            content_type = "application/xml"
            filename = "oclc_records_marcxml.xml"
        else:
            content_type = "application/marc"
            filename = "oclc_records.marc"

        # Return XML response
        return func.HttpResponse(
            xml_content if isinstance(xml_content, (str, bytes)) else str(xml_content),
            status_code=200,
            headers={
                "Content-Type": content_type,
                "Content-Disposition": f"attachment; filename={filename}"
            }
        )

    except ValueError as e:
        logging.error(f"[{correlation_id}] Validation error: {str(e)}")
        return func.HttpResponse(
            json.dumps({
                "success": False,
                "error": str(e),
                "message": "Validation error"
            }),
            status_code=400,
            headers={"Content-Type": "application/json"}
        )
    except Exception as e:
        logging.exception(f"[{correlation_id}] Error generating XML: %s", e)
        return func.HttpResponse(
            json.dumps({
                "success": False,
                "error": str(e),
                "message": "Error generating XML"
            }),
            status_code=500,
            headers={"Content-Type": "application/json"}
        )
