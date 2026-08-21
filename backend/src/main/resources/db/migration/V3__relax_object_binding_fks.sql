-- Object bindings are nullable references in the client save contract. A
-- composite FK cannot SET NULL without nulling factory_id, so the repository
-- validates recipeId/itemId within the same factory during save instead.
ALTER TABLE factory_object DROP FOREIGN KEY fk_object_recipe;
ALTER TABLE factory_object DROP FOREIGN KEY fk_object_item;
