from typing import Dict
from datetime import datetime

# API Configuration
OCLC_API_BASE_URL = "https://metadata.api.oclc.org/worldcat"
OCLC_OAUTH_URL = "https://oauth.oclc.org/token"
OCLC_OAUTH_SCOPE = "WorldCatMetadataAPI:view_brief_bib WorldCatMetadataAPI:manage_bibs"

# Azure Configuration
AZURE_AD_ISSUER_BASE = "https://login.microsoftonline.com"
AZURE_AD_DISCOVERY_PATH = "/discovery/v2.0/keys"

# Search Configuration
BATCH_SIZE = 100

# Field Mappings
SEARCH_FIELD_MAPPING: Dict[str, str] = {
    'title': 'ti',
    'author': 'au',
    'publisher': 'pb',
    'isbn': 'bn',
    'issn': 'in',
    'subject': 'su',
    'keyword': 'kw',
    'year': 'yr'
}

# HTTP Headers
DEFAULT_HEADERS = {
    'Content-Type': 'application/json'
}

# Error Messages
ERROR_MESSAGES = {
    'UNAUTHORIZED': 'Unauthorized access',
    'INVALID_TOKEN': 'Invalid or expired token',
    'MISSING_CREDENTIALS': 'OCLC credentials not found in environment variables',
    'API_ERROR': 'OCLC API request failed',
    'VALIDATION_ERROR': 'Invalid request data',
    'NO_RESULTS': 'No records found for the provided criteria',
    'RATE_LIMIT_EXCEEDED': f'Rate limit exceeded for today - {datetime.today().isoformat()}',
}
