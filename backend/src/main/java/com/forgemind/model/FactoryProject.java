package com.forgemind.model;

import com.fasterxml.jackson.databind.JsonNode;

/** A complete, lossless factory project payload plus its archive metadata. */
public record FactoryProject(
        FactoryProjectSummary project,
        JsonNode save
) {}

