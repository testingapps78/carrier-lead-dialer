import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Reads the REAL token values from app/globals.css and checks WCAG AA for every text/surface pairing used in the UI.
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function block(selector: string): Record<string, [number, number, number]> {
  const start = css.indexOf(selector + " {");
  assert.ok(start >= 0, `block ${selector} not found`);
  const body = css.slice(start, css.indexOf("}", start));
  const out: Record<string, [number, number, number]> = {};
  for (const m of body.matchAll(/--([a-z-]+):\s*(\d+) (\d+) (\d+);/g)) out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  return out;
}

type RGB = [number, number, number];
const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = (c: RGB) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a: RGB, b: RGB) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const mix = (fg: RGB, bg: RGB, a: number): RGB => [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)) as RGB;

for (const [name, selector] of [["light", ":root"], ["dark", '[data-theme="dark"]']] as const) {
  const t = block(selector);

  test(`${name}: body and muted text pass AA on page, card and inset`, () => {
    for (const bg of ["bg", "card", "inset"]) {
      assert.ok(ratio(t.text, t[bg]) >= 4.5, `text on ${bg}`);
      assert.ok(ratio(t["text-muted"], t[bg]) >= 4.5, `text-muted on ${bg}: ${ratio(t["text-muted"], t[bg]).toFixed(2)}`);
    }
  });

  test(`${name}: amber as text (accent-ink) passes AA on surfaces and on its own 10% tint`, () => {
    for (const bg of ["bg", "card", "inset"]) {
      assert.ok(ratio(t["accent-ink"], t[bg]) >= 4.5, `accent-ink on ${bg}: ${ratio(t["accent-ink"], t[bg]).toFixed(2)}`);
      assert.ok(ratio(t["accent-ink"], mix(t.accent, t[bg], 0.1)) >= 4.5, `accent-ink on accent/10 over ${bg}`);
    }
  });

  test(`${name}: text on an amber fill (buttons, the Call tile) passes AA, and the dark button on it too`, () => {
    assert.ok(ratio(t["accent-text"], t.accent) >= 4.5, `accent-text on accent: ${ratio(t["accent-text"], t.accent).toFixed(2)}`);
    assert.ok(ratio(t.accent, t["accent-text"]) >= 4.5, "amber text on the dark Dial button");
  });

  test(`${name}: status colors pass AA as text on surfaces and on their 10% tints (status chips)`, () => {
    for (const tok of ["success", "warning", "danger", "info", "violet"]) {
      for (const bg of ["bg", "card"]) {
        assert.ok(ratio(t[tok], t[bg]) >= 4.5, `${tok} on ${bg}: ${ratio(t[tok], t[bg]).toFixed(2)}`);
        assert.ok(ratio(t[tok], mix(t[tok], t[bg], 0.1)) >= 4.5, `${tok} on ${tok}/10 over ${bg}: ${ratio(t[tok], mix(t[tok], t[bg], 0.1)).toFixed(2)}`);
      }
    }
    assert.ok(ratio(t["text-muted"], mix(t.slate, t.card, 0.1)) >= 4.5, "muted on the neutral (New) chip");
  });

  test(`${name}: the amber fill and focus ring are visible against the card (3:1 for UI components)`, () => {
    assert.ok(ratio(t.accent, t.card) >= 3, `accent vs card: ${ratio(t.accent, t.card).toFixed(2)}`);
  });
}

test("the no-script fallback (system dark) uses the same values as the dark theme", () => {
  const fallback = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
  const dark = block('[data-theme="dark"]');
  for (const [k, v] of Object.entries(dark)) assert.ok(fallback.includes(`--${k}: ${v.join(" ")};`), `fallback missing --${k}`);
});
