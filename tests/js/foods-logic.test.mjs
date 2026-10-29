import test from "node:test";
import assert from "node:assert/strict";
import * as f from "../../custom_components/hass_recipes/frontend/foods-logic.js";

const food = (name, extra = {}) => ({ id: name, name, aliases: [], source: "none", unit_grams: {}, recipes: [], used_in: 0, ...extra });

test("a search puts exact, then starting, then containing matches first", () => {
  const foods = [food("Hvedemel"), food("Mel"), food("Kartoffelmel"), food("Smør")];
  assert.deepEqual(f.rankFoods(foods, [], "mel").map((x) => x.name), ["Mel", "Hvedemel", "Kartoffelmel"]);
  assert.deepEqual(f.rankFoods(foods, [], "zzz"), []);
});

test("another name of a food is found by the search", () => {
  const foods = [food("Olie", { aliases: ["olivenolie"] }), food("Smør")];
  assert.deepEqual(f.rankFoods(foods, [], "oliven").map((x) => x.name), ["Olie"]);
});

test("without a search the foods alike the names come first, then the recent ones, then A to Z", () => {
  const foods = [food("Bacon"), food("Sukker"), food("Mel"), food("Brun farin", { aliases: ["brown sugar"] })];
  assert.equal(f.rankFoods(foods, ["packed brown sugar"])[0].name, "Brun farin");
  assert.deepEqual(f.rankFoods(foods, ["noget andet"], "", ["Mel"]).map((x) => x.name), ["Mel", "Bacon", "Brun farin", "Sukker"]);
});

test("recent foods are newest first and not repeated", () => {
  assert.deepEqual(f.remember(["a", "b", "c"], "b"), ["b", "a", "c"]);
  assert.equal(f.remember(["1", "2", "3", "4", "5"], "6").length, 5);
});

test("a merge preview lists the new names, the weights that move and what is dropped", () => {
  const target = food("Mel", { aliases: ["hvedemel"], source: "frida", unit_grams: { dl: 60 }, recipes: ["a"], used_in: 1 });
  const other = food("Bagemel", { aliases: ["Hvedemel", "brødmel"], source: "usda", unit_grams: { dl: 55, spsk: 8 }, recipes: ["a", "b"], used_in: 2 });
  const p = f.mergePreview(target, [other]);
  assert.deepEqual(p.names, ["Bagemel", "brødmel"]);
  assert.deepEqual(p.weights, [["spsk", 8]]);
  assert.equal(p.nutrition, null);
  assert.deepEqual(p.dropped, ["Bagemel"]);
  assert.equal(p.recipes, 2);
});

test("a food without nutrition takes it from the one merged into it", () => {
  const p = f.mergePreview(food("Mel"), [food("Hvedemel", { source: "frida" })]);
  assert.equal(p.nutrition.name, "Hvedemel");
  assert.deepEqual(p.dropped, []);
});

test("ticks stay on the rows that are still there", () => {
  assert.deepEqual([...f.keepSelection(new Set(["a", "b", "c"]), ["b", "c", "d"])], ["b", "c"]);
});

test("names in the review list are ticked as r~name", () => {
  const ids = [f.reviewId("løg finthakket"), "food-id"];
  assert.deepEqual(f.reviewKeys(ids), ["løg finthakket"]);
});

test("a food's other names are found from the line's food or its words", () => {
  const groups = { hvedemel: ["Hvedemel", "mel"], mel: ["Hvedemel", "mel"] };
  assert.deepEqual(f.namesForLine(groups, ["Hvedemel"]), ["Hvedemel", "mel"]);
  assert.deepEqual(f.namesForLine(groups, ["finsigtet", "Mel!"]), ["Hvedemel", "mel"]);
  assert.deepEqual(f.namesForLine(groups, ["smør"]), []);
  assert.equal(f.nameKey("  Brun   Farin, 200 g"), "brun farin g");
});

test("a split of the energy becomes grams", () => {
  assert.deepEqual(f.gramsFromSplit(2000, f.MACRO_PRESETS[0].split), { protein: 100, carbs: 250, fat: 67 });
  assert.deepEqual(f.gramsFromSplit(1500, { protein: 30, carbs: 25, fat: 45 }), { protein: 113, carbs: 94, fat: 75 });
});

test("a split from body weight keeps protein at 1.6 g a kg", () => {
  assert.deepEqual(f.suggestFromWeight(1500, 78), { protein: 125, carbs: 156, fat: 42 });
  assert.equal(f.suggestFromWeight(600, 100).carbs, 0); // a small target leaves nothing for carbs: never negative
});

test("macro grams add up to energy with each share, and carbs can be fitted to the kcal goal", () => {
  const e = f.macroEnergy({ protein: 100, carbs: 250, fat: 67 });
  assert.equal(e.kcal, 2003);
  assert.deepEqual(e.share, { protein: 20, carbs: 50, fat: 30 });
  assert.deepEqual(f.macroEnergy({}), { kcal: 0, share: { protein: 0, carbs: 0, fat: 0 } });
  assert.equal(f.carbsToFit({ kcal: 2000, protein: 100, fat: 70 }), 243);
  assert.equal(f.carbsToFit({ kcal: 500, protein: 150, fat: 70 }), 0);
});

test("changing an entry sends only what the server takes for its kind", () => {
  const recipe = { kind: "recipe", recipe_id: "r1", name: "Boller", by: "yield", amount: "4", unit: "boller", kcal: 330, meal: "lunch" };
  assert.deepEqual(f.entryUpdate(recipe), { meal: "lunch", by: "yield", amount: 4 });
  const food = { kind: "food", food_id: "f1", amount: 60, unit: "g", name: "Mel", kcal: 206, meal: "breakfast" };
  assert.deepEqual(f.entryUpdate(food), { meal: "breakfast", amount: 60, unit: "g" });
  const quick = { kind: "quick", name: "Kage", kcal: "300", protein: "", fat: 12, meal: "snack" };
  assert.deepEqual(f.entryUpdate(quick), { meal: "snack", name: "Kage", kcal: 300, fat: 12 });
});
