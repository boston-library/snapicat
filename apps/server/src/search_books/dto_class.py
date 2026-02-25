"""Pydantic DTOs for search_books handler."""

from typing import Any, Optional

from pydantic import BaseModel, Field


class SearchRequestDTO(BaseModel):
    """Request body for batch book search."""

    books: list[dict[str, Any]] = Field(default_factory=list)
    appendSearchQuery: Optional[str] = None
    sortingOrder: Optional[str] = None
    isRefining: Optional[bool] = None
