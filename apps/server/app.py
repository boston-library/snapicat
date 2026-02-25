import os
import json
import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Load environment variables from .env file if it exists
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # python-dotenv not available, continue without .env loading

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="Worldcat OCLC API Server",
    description="Standalone version of Worldcat OCLC APIs",
    version="1.0.0"
)

# Configure CORS - read allowed origins from environment
cors_origins_env = os.environ.get("CORS_ORIGINS", "")
if cors_origins_env.strip():
    # Split by comma and strip whitespace
    allowed_origins = [origin.strip() for origin in cors_origins_env.split(",") if origin.strip()]
else:
    # Default to all origins if not specified
    allowed_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if "*" in allowed_origins:
    origins_display = "All"
else:
    origins_display = ", ".join(allowed_origins)


class MockHttpRequest:
    """Mock Azure Functions HttpRequest from FastAPI Request"""

    def __init__(self, fastapi_request: Request, body: dict = None):
        self._fastapi_request = fastapi_request
        self._body = body or {}
        self.method = fastapi_request.method
        self.headers = dict(fastapi_request.headers)

    def get_json(self):
        """Return the request body as JSON"""
        return self._body


async def call_azure_handler(request: Request, handler):
    """Call an Azure-style handler (main(req)) from FastAPI. Handler is from src.*.handler."""
    try:
        body = {}
        if request.method in ["POST", "PUT", "PATCH"]:
            try:
                body = await request.json()
            except Exception:
                body = {}

        mock_req = MockHttpRequest(request, body)
        response = await handler(mock_req)

        # Convert Azure Functions response to FastAPI response
        if hasattr(response, 'status_code') and hasattr(response, 'get_body'):
            # Azure Functions response
            status_code = response.status_code
            headers = getattr(response, 'headers', {})

            # Get response body
            if hasattr(response, 'get_body'):
                body_content = response.get_body()
                if isinstance(body_content, bytes):
                    body_content = body_content.decode('utf-8')
            else:
                body_content = ""

            # Try to parse as JSON
            try:
                json_data = json.loads(body_content)
                return JSONResponse(content=json_data, status_code=status_code, headers=headers)
            except:
                # Return as plain text
                from fastapi.responses import Response
                return Response(content=body_content, status_code=status_code, headers=headers)

        # Fallback
        return JSONResponse(content={"error": "Invalid response format"}, status_code=500)

    except Exception as e:
        logger.error(f"Error calling handler: {e}")
        return JSONResponse(
            content={"error": str(e), "message": "Internal server error"},
            status_code=500
        )


@app.post("/api/search_books")
async def search_books(request: Request):
    """Search books API endpoint (delegates to src.search_books.handler.main)."""
    from src.search_books.handler import main as handler
    return await call_azure_handler(request, handler)


@app.post("/api/generate_xml")
async def generate_xml(request: Request):
    """Generate XML API endpoint (delegates to src.generate_xml.handler.main)."""
    from src.generate_xml.handler import main as handler
    return await call_azure_handler(request, handler)


@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "message": "Worldcat OCLC API Server (Standalone)",
        "status": "healthy",
        "framework": "FastAPI",
        "endpoints": [
            "/api/search_books",
            "/api/generate_xml"
        ]
    }


@app.get("/health")
async def health():
    """Detailed health check"""
    return {
        "status": "healthy",
        "version": "1.0.0",
        "framework": "FastAPI (Standalone)",
        "endpoints": [
            "/api/search_books",
            "/api/generate_xml"
        ],
        "environment": {
            "oclc_wskey": "configured" if os.environ.get('OCLC_WSKEY') else "missing",
            "oclc_secret": "configured" if os.environ.get('OCLC_SECRET') else "missing",
            "azure_client_id": "configured" if os.environ.get('AZURE_CLIENT_ID') else "missing",
            "azure_tenant_id": "configured" if os.environ.get('AZURE_TENANT_ID') else "missing",
        }
    }


if __name__ == "__main__":
    import uvicorn

    # Get configuration from environment
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8080"))
    auto_reload = os.environ.get("AUTO_RELOAD", "true") == "true"

    print("🚀 Starting Worldcat OCLC Standalone API Server")
    print(f"📍 Host: {host}")
    print(f"🔌 Port: {port}")
    print(f"🌐 CORS Origins: {origins_display}")

    uvicorn.run(
        "app:app",
        host=host,
        port=port,
        reload=auto_reload,
        log_level="info"
    )