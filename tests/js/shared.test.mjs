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

test("scaleIngredient", () => {
  assert.equal(s.scaleIngredient("200 g mel", 2), "400 g mel");
  assert.equal(s.scaleIngredient("1/2 tsk salt", 3), "1½ tsk salt");
  assert.equal(s.scaleIngredient("salt", 2), "salt");
});

test("substitutes", () => {
  assert.deepEqual(s.splitSubs("a || b || c"), { main: "a", alts: ["b", "c"] });
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
