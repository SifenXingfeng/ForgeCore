"""Schemas for reusable and shareable factory blueprints."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.factory import (
    FactoryObjectPayload,
    FloorPayload,
    InventoryPayload,
    ItemPayload,
    RecipePayload,
)


class BlueprintFactoryData(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    width_m: float = Field(gt=0, le=500)
    length_m: float = Field(gt=0, le=500)
    grid_size_m: float = Field(gt=0, le=5)
    schema_version: int = Field(default=4, ge=1)


class BlueprintDesignSnapshot(BaseModel):
    factory: BlueprintFactoryData
    floors: list[FloorPayload] = Field(min_length=1)
    objects: list[FactoryObjectPayload]
    items: list[ItemPayload]
    recipes: list[RecipePayload]
    inventory: list[InventoryPayload]


class BlueprintCreate(BaseModel):
    factory_id: str
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=4000)
    tags: list[str] = Field(default_factory=list, max_length=8)
    is_public: bool = False

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, values: list[str]) -> list[str]:
        result: list[str] = []
        for value in values:
            tag = value.strip().lower()
            if not tag or tag in result:
                continue
            if len(tag) > 32:
                raise ValueError("each tag must be at most 32 characters")
            result.append(tag)
        return result


class BlueprintUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=4000)
    tags: list[str] | None = Field(default=None, max_length=8)
    is_public: bool | None = None

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return None
        return BlueprintCreate.normalize_tags(values)


class BlueprintBrief(BaseModel):
    id: str
    owner_id: str
    name: str
    description: str
    tags: list[str]
    is_public: bool
    fork_count: int
    star_count: int
    is_starred: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class BlueprintDetail(BlueprintBrief):
    snapshot: BlueprintDesignSnapshot


class BlueprintPage(BaseModel):
    items: list[BlueprintBrief]
    total: int
    page: int
    page_size: int


class BlueprintForkRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)


class BlueprintForkResult(BaseModel):
    blueprint_id: str
    factory_id: str
    factory_name: str


class BlueprintForkEntry(BaseModel):
    id: str
    factory_id: str
    owner_id: str
    created_at: datetime

    model_config = {"from_attributes": True}


class BlueprintExportData(BaseModel):
    name: str
    description: str = ""
    tags: list[str] = Field(default_factory=list, max_length=8)
    snapshot: BlueprintDesignSnapshot


class BlueprintExport(BaseModel):
    format: Literal["forgecore-blueprint"] = "forgecore-blueprint"
    schema_version: Literal[1] = 1
    exported_at: datetime
    blueprint: BlueprintExportData


class BlueprintImportRequest(BlueprintExport):
    is_public: bool = False
