-- The browser save schema evolves faster than the normalized MVP tables.
-- Keep one canonical, lossless project payload per factory while retaining
-- the existing relational tables for legacy compatibility and later indexing.
ALTER TABLE factory
    ADD COLUMN save_json JSON NULL AFTER depth;

