package com.forgemind.model;

/** Account-scoped factory archive metadata shown in the project picker. */
public record FactoryProjectSummary(
        String id,
        String name,
        String createdAt,
        String updatedAt,
        Integer version,
        Integer floorCount,
        Integer objectCount,
        Integer itemCount,
        Integer recipeCount,
        Boolean autosave
) {}
