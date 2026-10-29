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
