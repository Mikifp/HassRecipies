import test from "node:test";
import assert from "node:assert/strict";
import * as s from "../../custom_components/hass_recipes/frontend/recipes-shared.js";

test("esc escapes markup", () => {
  assert.equal(s.esc('<a href="x">&</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
});

test("minutes", () => {
  assert.equal(s.minutes(5), "5 min");
  assert.equal(s.minutes(90), "1 h 30 min");
  assert.equal(s.minutes(120), "2 h");
});

test("parseNumber and formatNumber", () => {
  assert.equal(s.parseNumber("1 1/2"), 1.5);
  assert.equal(s.parseNumber("½"), 0.5);
  assert.equal(s.parseNumber("2,5"), 2.5);
  assert.equal(s.formatNumber(1.5), "1½");
  assert.equal(s.formatNumber(2), "2");
});

test("amounts in parentheses scale with the ingredient", () => {
  assert.equal(s.scaleIngredient("100 g sukker (100 ml)", 2), "200 g sukker (200 ml)");
  assert.equal(s.scaleIngredient("2 dl mel (ca. 120 g)", 1.5), "3 dl mel (ca. 180 g)");
  assert.equal(s.scaleIngredient("1 tsk salt (fint)", 2), "2 tsk salt (fint)");
  assert.equal(s.scaleParen("ca. 120 g", 2), "ca. 240 g");
  assert.equal(s.scaleParen("100 ml", 1), "100 ml");
});

test("scaleIngredient", () => {
  assert.equal(s.scaleIngredient("200 g mel", 2), "400 g mel");
  assert.equal(s.scaleIngredient("1/2 tsk salt", 3), "1½ tsk salt");
  assert.equal(s.scaleIngredient("salt", 2), "salt");
});

test("substitutes", () => {
  assert.deepEqual(s.splitSubs("a || b || c"), { main: "a", alts: ["b", "c"], comment: "" });
  assert.equal(s.joinSubs("a", ["b", ""]), "a || b");
});

test("section headers", () => {
  assert.equal(s.isHeader("## Sauce"), true);
  assert.equal(s.isHeader("Sauce"), false);
  assert.equal(s.headerText("## Sauce"), "Sauce");
});

test("clock and duration", () => {
  assert.equal(s.clock(75), "01:15");
  assert.equal(s.clock(3725), "1:02:05");
  assert.equal(s.duration(90), "1 min 30 sec");
  assert.equal(s.duration(3600), "1 h");
});

test("baseServings", () => {
  assert.equal(s.baseServings("4 personer"), 4);
  assert.equal(s.baseServings(""), null);
});

test("ingredient notes", () => {
  assert.deepEqual(s.splitSubs("200 g butter || 180 g oil // room temperature"), {
    main: "200 g butter",
    alts: ["180 g oil"],
    comment: "room temperature",
  });
  assert.equal(s.joinSubs("200 g butter", [], " room  temperature "), "200 g butter // room temperature");
  assert.equal(s.joinSubs("200 g butter", ["180 g oil"]), "200 g butter || 180 g oil");
  assert.deepEqual(s.splitSub("200 g butter // soft"), ["200 g butter", ""]);
});

test("ingredients named in a step become chips", () => {
  const items = [
    { key: 0, text: "175 gram smør" },
    { key: 1, text: "2 stk røde løg" },
    { key: 2, text: "salt og peber" },
  ];
  const chip = (key, word) => `[${key}:${word}]`;
  const out = s.stepTextHtml("Smelt smørret og hak løg. Smag til med salt og peber.", items, chip);
  assert.equal(out.html, "Smelt [0:smørret] og hak [1:løg]. Smag til med [2:salt og peber].");
  assert.deepEqual([...out.placed].sort(), [0, 1, 2]);
});

test("an ingredient the step does not name is not placed", () => {
  const out = s.stepTextHtml("Rør sammen.", [{ key: 3, text: "1 dl mælk" }], () => "?");
  assert.equal(out.html, "Rør sammen.");
  assert.equal(out.placed.size, 0);
});

test("the food word is the noun, without units or remarks", () => {
  assert.equal(s.foodWords("1 ¹/₂ kilogram kartofler")[0], "kartofler");
  assert.equal(s.foodWords("2 stk røde løg")[0], "løg");
  assert.equal(s.foodWords("280 gram sukker jeg brugte halv brun farin")[0], "sukker");
});
