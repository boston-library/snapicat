import asyncio
import logging
from typing import List, Dict, Any, Optional
import re
import requests
from requests import Request, Session
from datetime import datetime
import uuid
import os
from urllib.parse import quote
import time

from .oclc_token_manager import OCLCTokenManager
from .constants import (
    OCLC_API_BASE_URL, BATCH_SIZE,
    DEFAULT_HEADERS, ERROR_MESSAGES
)

class OCLCService:
    """Service for interacting with OCLC API"""
    def __init__(self, token_manager: OCLCTokenManager):
        self.token_manager = token_manager
        self.wskey = os.environ.get('OCLC_WSKEY')
        self.secret = os.environ.get('OCLC_SECRET')
        self._correlation_id = str(uuid.uuid4())
        self.row_id = 0
        self.api_usage = None
        self._max_retries = 3
        self._retry_delay = 1  # seconds
        # Bounded concurrency for parallel HTTP calls
        self._concurrency_limit = 8
        self._sem = asyncio.Semaphore(self._concurrency_limit)

        if not self.wskey or not self.secret:
            raise ValueError(ERROR_MESSAGES['MISSING_CREDENTIALS'])

    async def batch_search(self, search_criteria: List[Dict[str, Any]], append_query: str, sorting_order: str, isRefining: bool) -> List[Dict[str, Any]]:
        """Perform batch search for multiple criteria"""
        results = []
        for i in range(0, len(search_criteria), BATCH_SIZE):
            batch = search_criteria[i:i + BATCH_SIZE]
            batch_results = await asyncio.gather(*[
                self._search_single_record(criteria, append_query.strip().replace('"', '\"'), sorting_order, isRefining)
                for criteria in batch
            ], return_exceptions=True)

            # Handle any exceptions in the batch
            for result in batch_results:
                if isinstance(result, dict) and 'error' in result:
                    logging.error(f"[{self._correlation_id}] Batch search error: {str(result)}")
                    if 'apiUsage' in result:
                        self.api_usage = result['apiUsage']
                        del result['apiUsage']
                    results.append(result)
                elif isinstance(result, dict) and 'statusCode' in result and result['statusCode'] == 429:
                    logging.warning(f"[{self._correlation_id}] Rate limit exceeded, for {datetime.today().isoformat()}")
                    return results, 0
                elif isinstance(result, dict) and 'data' in result:
                    self.api_usage = result.get('apiUsage')
                    results.append(result['data'])

            # Rate limiting
            if i + BATCH_SIZE < len(search_criteria):
                await asyncio.sleep(0.1)

        self.row_id = 0
        return results, self.api_usage

    async def search_single(self, criteria: Dict[str, Any], append_query: str, sorting_order: str, isRefining: bool) -> List[Dict[str, Any]]:
        """Search for a single record"""
        if not self.token_manager.can_make_request():
            raise ValueError("Insufficient API quota")

        result = await self._search_single_record(criteria, append_query.strip().replace('"', '\"'), sorting_order, isRefining)
        return [result] if result else []

    async def _search_single_record(self, criteria: Dict[str, Any], append_query: str, sorting_order: str, isRefining: bool) -> Dict[str, Any]:
        """Search for a single record using OCLC API with retry mechanism"""
        for attempt in range(self._max_retries):
            try:
                # Don't modify the original rowId if it exists
                if 'rowId' not in criteria:
                    criteria['rowId'] = self.row_id
                    self.row_id += 1

                access_token = self.token_manager.get_shared_token()
                headers = {
                    **DEFAULT_HEADERS,
                    'Authorization': f'Bearer {access_token}'
                }

                query = self._build_search_query(criteria, append_query)
                criteria['search_query'] = query
                if not query:
                    return self._build_error_response(criteria, ERROR_MESSAGES['NO_RESULTS'], isRefining)

                logging.info(f"[{self._correlation_id}] Query: {query}")

                url = f'{OCLC_API_BASE_URL}/search/brief-bibs?q={query}&orderBy={sorting_order}'


                session = Session()

                request = Request('GET', url, headers=headers)
                prepared_request = session.prepare_request(request)
                prepared_request.url = prepared_request.url

                async with self._sem:
                    response = await asyncio.to_thread(session.send, prepared_request, timeout=30)
                # Handle token expiration
                if response.status_code == 401:
                    if attempt < self._max_retries - 1:
                        logging.warning(f"[{self._correlation_id}] Token expired, retrying...")
                        await asyncio.sleep(self._retry_delay * (attempt + 1))
                        continue
                    else:
                        response.raise_for_status()

                response.raise_for_status()

                if int(response.headers.get('x-ratelimit-remaining-day')) == 0:
                    logging.warning(f"[{self._correlation_id}] Rate limit exceeded, for {datetime.today().isoformat()}")
                    return {
                        "statusCode": 429,
                    }

                data = response.json()

                if "numberOfRecords" in data and data["numberOfRecords"] == 0:
                    error_response = self._build_error_response(criteria, ERROR_MESSAGES['NO_RESULTS'], isRefining)
                    error_response['apiUsage'] = response.headers.get('x-ratelimit-remaining-day')
                    return error_response

                parsed_data = self._parse_search_response(data, criteria, isRefining)
                return {
                    "data": parsed_data,
                    "apiUsage": response.headers.get('x-ratelimit-remaining-day'),
                }

            except requests.exceptions.RequestException as e:
                if attempt == self._max_retries - 1:
                    logging.error(f"[{self._correlation_id}] API request failed after {self._max_retries} attempts: {str(e)}")

                    # Try to extract OCLC API error message
                    error_message = str(e)
                    if hasattr(e, 'response') and e.response is not None:
                        try:
                            error_data = e.response.json()
                            if 'detail' in error_data:
                                error_message = error_data['detail']
                            elif 'title' in error_data:
                                error_message = error_data['title']
                        except:
                            # If we can't parse the JSON, use the original error
                            pass

                    return self._build_error_response(criteria, error_message, isRefining)
                logging.warning(f"[{self._correlation_id}] API request failed (attempt {attempt + 1}/{self._max_retries}): {str(e)}")
                await asyncio.sleep(self._retry_delay * (attempt + 1))

            except Exception as e:
                logging.error(f"[{self._correlation_id}] Unexpected error: {str(e)}")
                return self._build_error_response(criteria, str(e), isRefining)

    def _build_search_query(self, criteria: Dict[str, Any], append_query: str) -> str:
        """Build OCLC search query from criteria with embedded operators"""
        # Fields that cannot be the first index in an OCLC query (extract base field name)
        restricted_first_fields = {'dd', 'yr', 'li', 'ln', 'll', 'mt', 'cs', 'x0', 'x4', 'l8', 'zu', 'sh', 'sg', 'pc', 'lv'}

        # If append_query is provided, prioritize it over criteria
        if append_query and append_query.strip():
            if self._contains_placeholders(append_query):
                # Template-based query with placeholders like ti:{} & pn:USA
                processed_query = self._build_append_query(criteria, append_query)
                if processed_query and processed_query.strip():
                    # Check if the processed query already has field/value pairs (supports ':' and '=' operators)
                    has_field_pairs = re.search(r"[A-Za-z][A-Za-z0-9]*\s*[:=]", processed_query) is not None
                    if has_field_pairs and not processed_query.strip().startswith(('AND ', 'OR ', 'NOT ')):
                        # It's a complete query, use as-is
                        query = processed_query
                    else:
                        # It might be just a fragment, use criteria as base
                        base_query = self._build_query_from_criteria(criteria, restricted_first_fields)
                        query = f"{base_query} AND {processed_query}" if base_query != 'kw:book' else processed_query
                else:
                    query = self._build_query_from_criteria(criteria, restricted_first_fields)
            else:
                # Direct field:value pairs like ti:Some title & pn:USA, extract fields and build query from them only
                append_fields = self._extract_fields_from_query(append_query)
                if append_fields:
                    query_parts = []
                    for field, operator, value in append_fields:
                        if value and str(value).strip():
                            clean_value = str(value).strip().replace('"', '\"')
                            query_part = f'{field}{operator}{clean_value}'

                            if len(query_parts) == 0 and field in restricted_first_fields:
                                query_parts.append('kw:book')

                            query_parts.append(query_part)

                    query = ' AND '.join(query_parts) if query_parts else 'kw:book'
                else:
                    # Fallback to criteria if no valid fields found in append_query
                    query = self._build_query_from_criteria(criteria, restricted_first_fields)
        else:
            # No append_query provided, use criteria only
            query = self._build_query_from_criteria(criteria, restricted_first_fields)

        query = self._encode_ampersands_in_field_values(query)
        return query

    def _extract_fields_from_query(self, query: str) -> List[tuple[str, str, str]]:
        """Extract field/value pairs (with operator) from a query string like 'ti:Book Title & pn=USA' or 'ti:Book Title AND au:Author'"""
        fields: List[tuple[str, str, str]] = []
        if not query or not query.strip():
            return fields

        # Split by logical separators, but only treat '&' as a separator when followed by a field name and operator
        parts = re.split(r"\s*(?:AND\s+|OR\s+|NOT\s+|&\s+(?=[A-Za-z][A-Za-z0-9]*[:=]))", query.strip())

        for part in parts:
            part = part.strip()
            if not part:
                continue

            # Check if this part contains a field operator value pattern (':' or '=')
            match = re.match(r"^([A-Za-z][A-Za-z0-9]*)(:|=)\s*(.+)$", part)
            if match:
                field = match.group(1).strip()
                operator = match.group(2)
                value = match.group(3).strip()
                # Remove quotes if present
                value = value.strip('"\'')
                fields.append((field, operator, value))

        return fields

    def _extract_url_params_from_append_query(self, query: str) -> Dict[str, str]:
        """Extract URL params like '&itemSubType=book-printbook&inCatalogLanguage=eng'."""
        params: Dict[str, str] = {}
        if not query:
            return params
        for match in re.finditer(r"&([A-Za-z][A-Za-z0-9_]*)=([^&\s]+)", query):
            params[match.group(1)] = match.group(2)
        return params

    def _contains_placeholders(self, query: str) -> bool:
        """Check if query contains template placeholders like ti:{}"""
        if not query:
            return False
        return '{}' in query

    def _encode_ampersands_in_field_values(self, query: str) -> str:
        if not query or not query.strip():
            return query

        pattern = re.compile(
            r"(?P<field>[A-Za-z][A-Za-z0-9]*)(?P<op>:|!=|=)\s*(?P<value>.*?)(?=(?:\s+(?:AND|OR|NOT)\s+)|\s+&\s+[A-Za-z][A-Za-z0-9]*:|&[A-Za-z][A-Za-z0-9_]*=|$)"
        )

        def repl(match: re.Match) -> str:
            field = match.group('field')
            op = match.group('op')
            value = match.group('value')
            value_encoded = value.replace('&', '%26')
            return f"{field}{op}{value_encoded}"

        return pattern.sub(repl, query)

    def _build_query_from_criteria(self, criteria: Dict[str, Any], restricted_first_fields: set) -> str:
        """Build query from criteria fields only"""
        query_parts = []

        for field, value in criteria.items():
            if field == 'rowId' or field.startswith('!'):
                continue
            if value and str(value).strip():
                clean_value = str(value).strip().replace('"', '\"')
                query_part = f'{field}:{clean_value}'

                # Check if the base field name is restricted for first position
                if len(query_parts) == 0 and field in restricted_first_fields:
                    # If this is the first field and it's restricted, add a default allowed field first
                    query_parts.append('kw:book')

                query_parts.append(query_part)

        return ' AND '.join(query_parts) if query_parts else 'kw:book'

    def _build_append_query(self, criteria: Dict[str, Any], append_query: str) -> str:
        """Build OCLC append query from criteria with embedded operators"""
        # Replace placeholders like ti:{} or au:{} with values from criteria; if missing, use ""
        pattern = re.compile(r"(\b[A-Za-z][A-Za-z0-9]*)(:|=)\s*\{\}")

        # Build a lookup of base_field -> value from criteria, stripping operators and colons
        field_to_value: Dict[str, Any] = {}
        for key, value in criteria.items():
            if key == 'rowId' or key.startswith('!'):
                continue
            base = key
            if key.startswith(('AND ', 'OR ', 'NOT ')):
                parts = key.split(' ', 1)
                if len(parts) > 1:
                    base = parts[1]
            base = base.rstrip(':')
            field_to_value[base] = value

        def repl(match: re.Match) -> str:
            field_name = match.group(1)  # e.g., 'ti'
            operator = match.group(2)    # ':' or '='
            field_token = f"{field_name}{operator}"
            base_field = field_name
            raw_value = field_to_value.get(base_field, None)
            # If no value provided, return only the field token (e.g., 'ti:')
            if raw_value is None or str(raw_value).strip() == "":
                return f"{field_token}"
            # Clean value and do not add surrounding quotation marks
            clean = str(raw_value).strip().replace('"', '')
            return f"{field_token}{clean}"

        return pattern.sub(repl, append_query)

    def _parse_search_response(self, response_data: Dict[str, Any], original_criteria: Dict[str, Any], isRefining: bool) -> Dict[str, Any]:
        """Parse OCLC API response and extract only the requested fields, maintaining order"""
        try:
            result = {}

            # Always include OCLC number FIRST
            if "briefRecords" in response_data and response_data["briefRecords"]:
                record = response_data['briefRecords'][0]
                result['oclc_number'] = record.get('oclcNumber', '')
            else:
                result['oclc_number'] = ''

            # Add rowId after oclc_number if it exists
            if 'rowId' in original_criteria:
                result['rowId'] = original_criteria['rowId']

            # Define field mappings (base_field -> api_field)
            field_mappings = {
                'ti': 'title',
                'au': 'creator',
                'la': 'language',
                'pb': 'publisher',
                'pl': 'publicationPlace',
                'yr': 'machineReadableDate',
                'bn': 'isbns',
                'pn': 'contributor',
                'in': 'issns'
            }
            
            new_field_mappings = {
                'title': 'ti_new',
                'creator': 'au_new',
                'language': 'la_new',
                'publisher': 'pb_new',
                'publicationPlace': 'pl_new',
                'machineReadableDate': 'yr_new',
                'isbns': 'bn_new',
                'issns': 'in_new'
            }

            # Process fields in the order they appear in original criteria (excluding ! fields)
            if "briefRecords" in response_data and response_data["briefRecords"]:
                record = response_data['briefRecords'][0]
                for field_key in original_criteria.keys():
                    if field_key == 'rowId' or field_key.startswith('!'):
                        continue

                    # Add original field from criteria
                    result[field_key] = original_criteria[field_key]

                    # Extract base field name for mapping
                    base_field = field_key
                    if field_key.startswith(('AND ', 'OR ', 'NOT ')):
                        # Extract field name after operator
                        parts = field_key.split(' ', 1)
                        if len(parts) > 1:
                            base_field = parts[1].rstrip(':')
                    else:
                        base_field = field_key.rstrip(':')

                    # Add corresponding new field from API response if mapping exists
                    if base_field in field_mappings:
                        api_field = field_mappings[base_field]
                        new_field = f'{base_field}_new'

                        if api_field in record:
                            if api_field in ['isbns', 'issns'] and record[api_field]:
                                # Handle ISBNs/ISSNs - convert list to comma-separated string
                                result[new_field] = ','.join(record[api_field])
                            else:
                                result[new_field] = record.get(api_field, '')
                        else:
                            result[new_field] = ''

                # Map of OCLC API field names to their _new field names
                all_oclc_fields = {
                    'title': 'title_new',
                    'creator': 'creator_new',
                    'publisher': 'publisher_new',
                    'publicationPlace': 'publicationPlace_new',
                    'date': 'date_new',
                    'language': 'language_new',
                    'isbns': 'isbns_new',
                    'issns': 'issns_new',
                    'mergedOclcNumbers': 'mergedOclcNumbers_new',
                    'generalFormat': 'generalFormat_new',
                    'specificFormat': 'specificFormat_new',
                    'edition': 'edition_new',
                    'machineReadableDate': 'machineReadableDate_new',
                    'publicationDate': 'publicationDate_new'
                }

                # Add all available OCLC fields that aren't already included
                for oclc_field, new_field_name in all_oclc_fields.items():
                    if new_field_name not in result and oclc_field in record and result.get(new_field_mappings.get(oclc_field)) is None:
                        if oclc_field in ['isbns', 'issns', 'mergedOclcNumbers'] and record[oclc_field]:
                            # Handle array fields - convert to comma-separated string
                            result[new_field_name] = ','.join(record[oclc_field])
                        else:
                            result[new_field_name] = record.get(oclc_field, '')

                # Flatten any additional fields (including nested ones like catalogingInfo.*)
                flattened_field_mappings = {
                    'title_new': 'ti_new',
                    'creator_new': 'au_new',
                    'language_new': 'la_new',
                    'publisher_new': 'pb_new',
                    'publicationPlace_new': 'pl_new',
                    'date_new': 'yr_new',
                    'isbns_new': 'bn_new',
                    'issns_new': 'in_new'
                }
                
                flattened = self._flatten_brief_record(record)
                for flat_key, flat_value in flattened.items():
                    # Avoid overwriting fields already set above and skip original criteria keys
                    if flat_key not in result and flat_key not in original_criteria and result.get(flattened_field_mappings.get(flat_key)) is None:
                        result[flat_key] = flat_value

            # Add all fields that start with ! LAST
            for field in original_criteria:
                if field.startswith('!'):
                    result[field] = original_criteria[field]

            return result

        except Exception as e:
            logging.error(f"[{self._correlation_id}] Error parsing search response: {str(e)}")
            return self._build_error_response(original_criteria, f"Error parsing response: {str(e)}", isRefining)

    def _build_error_response(self, original_criteria: Dict[str, Any], error_message: str, isRefining: bool = False) -> Dict[str, Any]:
        """Build error response maintaining the same field order as successful responses"""
        result = {}

        # Always include OCLC number FIRST
        result['oclc_number'] = ""

        # Add rowId after oclc_number if it exists
        if 'rowId' in original_criteria:
            result['rowId'] = original_criteria['rowId']

        # Define field mappings (base_field -> api_field) to mirror _parse_search_response behavior
        field_mappings = {
            'ti': 'title',
            'au': 'creator',
            'la': 'language',
            'pb': 'publisher',
            'pl': 'publicationPlace',
            'yr': 'machineReadableDate',
            'bn': 'isbns',
            'pn': 'contributor',
            'in': 'issns'
        }

        # Add original search fields in order (excluding ! fields)
        for field_key in original_criteria.keys():
            if field_key == 'rowId' or field_key.startswith('!'):
                continue

            # Add original field from criteria
            result[field_key] = original_criteria[field_key]

            # Extract base field name for mapping
            base_field = field_key
            if field_key.startswith(('AND ', 'OR ', 'NOT ')):
                # Extract field name after operator
                parts = field_key.split(' ', 1)
                if len(parts) > 1:
                    base_field = parts[1].rstrip(':')
            else:
                base_field = field_key.rstrip(':')

            # Add empty _new field ONLY for fields that have mappings, matching _parse_search_response behavior
            if base_field in field_mappings:
                result[f'{base_field}_new'] = ""

        # Add error field
        result['error'] = error_message

        # Add all fields that start with ! LAST
        for field in original_criteria:
            if field.startswith('!'):
                result[field] = original_criteria[field]

        return result
    
    def _flatten_brief_record(self, data: Any, prefix: str = "", accumulator: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Flatten a brief record dict into flat keys with `_new` suffix.

        - Nested objects are flattened using `<parent>_<child>` names (camelCase preserved)
        - Lists are converted into comma separated values
        - `oclcNumber` is skipped (already exposed as `oclc_number`)
        """
        if accumulator is None:
            accumulator = {}

        if isinstance(data, dict):
            for key, value in data.items():
                if key == 'oclcNumber':
                    continue
                child_prefix = f"{prefix}{key}" if not prefix else f"{prefix}_{key}"
                self._flatten_brief_record(value, child_prefix, accumulator)
        elif isinstance(data, list):
            flat_key = f"{prefix}_new" if not prefix.endswith("_new") else prefix
            try:
                accumulator[flat_key] = ','.join(str(item) for item in data)
            except Exception:
                accumulator[flat_key] = ''
        else:
            flat_key = f"{prefix}_new" if not prefix.endswith("_new") else prefix
            accumulator[flat_key] = '' if data is None else data

        return accumulator

    async def generate_xml(self, oclc_numbers: List[str], format_type: str = "marcxml") -> str:
        """Generate XML for given OCLC numbers with specified format

        Args:
            oclc_numbers: List of OCLC numbers to fetch
            format_type: Either 'marcxml' for MARCXML format or 'marc' for raw MARC format
        """

        access_token = self.token_manager.get_shared_token()

        # Set appropriate Accept header based on format type
        if format_type == "marcxml":
            accept_header = 'application/marcxml+xml'
        else:  # marc format
            accept_header = 'application/marc'

        headers = {
            'Authorization': f'Bearer {access_token}',
            'Accept': accept_header
        }

        async def fetch_one(oclc_number: str) -> Optional[str]:
            try:
                async with self._sem:
                    response = await asyncio.to_thread(
                        requests.get,
                        f"{OCLC_API_BASE_URL}/manage/bibs/{oclc_number}",
                        headers=headers,
                        timeout=30
                    )
                response.raise_for_status()
                if int(response.headers.get('x-ratelimit-remaining-day', '1')) == 0:
                    logging.warning(f"[{self._correlation_id}] Rate limit may be exceeded soon - remaining day is 0")
                return response.text
            except Exception as e:
                logging.error(f"[{self._correlation_id}] Error fetching data for OCLC number {oclc_number}: {str(e)}")
                return None

        xml_records = [r for r in await asyncio.gather(*[fetch_one(n) for n in oclc_numbers]) if r]

        return self._combine_xml(xml_records, format_type)

    def _combine_xml(self, xml_records: List[str], format_type: str) -> str:
        """Combine multiple records into single document based on format type"""
        if not xml_records:
            if format_type == "marcxml":
                return '<?xml version="1.0" encoding="UTF-8"?>\n<collection xmlns="http://www.loc.gov/MARC21/slim">\n</collection>'
            else:  # marc format
                return ''  # Empty MARC file

        if format_type == "marcxml":
            # Handle MARCXML format
            combined = '<?xml version="1.0" encoding="UTF-8"?>\n'
            combined += '<collection xmlns="http://www.loc.gov/MARC21/slim">\n'

            for xml_record in xml_records:
                try:
                    start = xml_record.find('<record')
                    end = xml_record.find('</record>') + 9
                    if start != -1 and end != -1:
                        combined += '  ' + xml_record[start:end] + '\n'
                except Exception as e:
                    logging.warning(f"[{self._correlation_id}] Error processing MARCXML record: {str(e)}")
                    continue

            combined += '</collection>'
        else:  # marc format
            # Handle raw MARC format - just concatenate the records
            combined = ''
            for marc_record in xml_records:
                try:
                    # Raw MARC data is usually binary/text, just concatenate
                    combined += marc_record + '\n'
                except Exception as e:
                    logging.warning(f"[{self._correlation_id}] Error processing MARC record: {str(e)}")
                    continue

        return combined

    def _combine_marc_xml(self, xml_records: List[str]) -> str:
        """Combine multiple MARCXML records into single document (legacy method)"""
        # Keep this method for backward compatibility, but redirect to new method
        return self._combine_xml(xml_records, "marcxml")
