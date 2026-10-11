import test from "node:test";
import assert from "node:assert/strict";
import { translate, hasTranslation } from "../../custom_components/hass_recipes/frontend/recipes-i18n.js";

test("exact strings are translated", () => {
  assert.equal(translate("da", "Recipes"), "Opskrifter");
});

test("patterns carry names and numbers", () => {
  assert.equal(translate("da", "Deleted “Soup”."), "Slettede “Soup”.");
  assert.equal(translate("da", "Deleted 3 recipe(s)."), "Slettede 3 opskrift(er).");
});

test("unknown strings and languages stay English", () => {
  assert.equal(translate("da", "Nothing at all xyz"), "Nothing at all xyz");
  assert.equal(translate("en", "Recipes"), "Recipes");
  assert.equal(hasTranslation("da"), true);
  assert.equal(hasTranslation("xx"), false);
});
