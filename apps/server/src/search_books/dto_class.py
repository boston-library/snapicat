"""Pydantic DTOs for search_books handler."""

from typing import Optional, Literal, List, Dict, Any
from pydantic import BaseModel, Field

class SearchBookDTO(BaseModel):
    """Data Transfer Object for a single book search that allows any OCLC search parameters including operators"""

    def __init__(self, **data):
        super().__init__(**data)

    @classmethod
    def __get_validators__(cls):
        yield cls.validate

    @classmethod
    def validate(cls, v):
        if isinstance(v, dict):
            return cls(**v)
        return v

    def __setattr__(self, name, value):
        # Allow any field name including those with operators and special characters
        super().__setattr__(name, value)

    def __getitem__(self, key):
        return getattr(self, key, None)

    def __setitem__(self, key, value):
        setattr(self, key, value)

    def __contains__(self, key):
        return hasattr(self, key)

    def keys(self):
        return self.__dict__.keys()

    def items(self):
        return self.__dict__.items()

    def get(self, key, default=None):
        return getattr(self, key, default)

    def model_dump(self, exclude_none=True, by_alias=True) -> Dict[str, Any]:
        """Return all fields as a dictionary, preserving field order"""
        result = {}
        for key, value in self.__dict__.items():
            if exclude_none and value is None:
                continue
            result[key] = value
        return result

    class Config:
        extra = "allow"  # Allow any additional fields
        validate_assignment = True

class SearchRequestDTO(BaseModel):
    """Data Transfer Object for search request"""
    sortingOrder: Literal["library", "recency", "bestMatch", "creator", "publicationDateAsc", "publicationDateDesc", "mostWidelyHeld", "title"] = Field("bestMatch", description="Sort order for results")
    books: List[Dict[str, Any]] = Field(
        ...,
        description="List of books to search for, each with its own search parameters including operators",
        examples=[
            {
                "ti:": "The Great Gatsby",
                "AND au:": "F. Scott Fitzgerald",
                "AND pb:": "Scribner",
                "AND yr:": "1925",
                "AND bn:": "9780743273565",
                "!isbn": "original_isbn_value"
            },
            {
                "ti:": "To Kill a Mockingbird",
                "AND au:": "Harper Lee",
                "AND pb:": "J.B. Lippincott & Co.",
                "AND yr:": "1960",
                "AND bn:": "9780061120084",
                "!isbn": "original_isbn_value"
            }
        ]
    )
    appendSearchQuery: Optional[str] = Field(
        default="",
        description="Additional query for searching books in OCLC API (deprecated - operators should be included in field names)",
        examples=[
            "",
        ]
    )
    isRefining: bool = Field(False, description="Whether the search is refining a previous search")
