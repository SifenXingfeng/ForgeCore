-- Item deletion is already coordinated by the application (removeItem
-- removes all recipe ports). Dropping this composite FK prevents a factory
-- owner cascade from being blocked by a nullable, same-factory item link.
ALTER TABLE recipe_port DROP FOREIGN KEY fk_recipe_port_item;
