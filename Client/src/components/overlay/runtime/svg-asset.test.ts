// Asset display (svg §2, §4, §5): strict parsing, allow-list, ID scoping, parts.
import { describe, expect, it } from "vitest";
import { AssetParseError, parseAsset, partsBelow, scopeIds, withParts } from "./svg-asset";
import { h, toMarkup } from "./vnode";

const ASSET = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">
  <defs><linearGradient id="r1"><stop offset="0" stop-color="#ff0000"/></linearGradient></defs>
  <g data-part="body"><rect width="100" height="50" fill="url(#r1)"/></g>
  <path data-part="p_needle" d="M50 50L50 5" stroke="#ffffff" transform="rotate(5)"/>
  <text x="5" y="20">A &amp; B <tspan>t</tspan></text>
</svg>`;

describe("parseAsset", () => {
  it("parses the normalized subset", () => {
    const a = parseAsset(ASSET);
    expect(a.viewBox).toEqual([0, 0, 100, 50]);
    expect(a.dropped).toBe(0);
    const markup = a.children.map(toMarkup).join("");
    expect(markup).toContain('<linearGradient id="r1">');
    expect(markup).toContain("A &amp; B <tspan>t</tspan>");
  });

  it("drops anything outside the allow-list (defense in depth)", () => {
    const a = parseAsset(`<svg viewBox="0 0 10 10"><script>alert(1)</script><image href="x"/><rect onclick="x()" width="1" fill="url(http://evil/x)" style="a"/><foreignObject/></svg>`);
    const markup = a.children.map(toMarkup).join("");
    expect(markup).toBe('<rect width="1"/>');
    expect(a.dropped).toBe(6);
  });

  it.each([
    ["DOCTYPE", '<!DOCTYPE svg><svg viewBox="0 0 1 1"/>'],
    ["unbalanced", '<svg viewBox="0 0 1 1"><g></svg>'],
    ["no svg root", "<g/>"],
    ["bad viewBox", '<svg viewBox="0 0 x 1"/>'],
    ["unknown entity", '<svg viewBox="0 0 1 1"><text>&nbsp;</text></svg>'],
  ])("rejects %s", (_, svg) => {
    expect(() => parseAsset(svg)).toThrow(AssetParseError);
  });
});

describe("scopeIds", () => {
  it("prefixes ids and url(#…) references per instance", () => {
    const a = parseAsset(ASSET);
    const one = scopeIds(a.children, "ovl-e_a-").map(toMarkup).join("");
    const two = scopeIds(a.children, "ovl-e_b-").map(toMarkup).join("");
    expect(one).toContain('id="ovl-e_a-r1"');
    expect(one).toContain('fill="url(#ovl-e_a-r1)"');
    expect(two).toContain('id="ovl-e_b-r1"');
    expect(one).not.toContain('"r1"');
  });
});

describe("withParts", () => {
  it("wraps animated parts outside their own transform and keeps other branches", () => {
    const nodes = parseAsset(ASSET).children;
    const below = partsBelow(nodes);
    const out = withParts(nodes, below, new Set(["p_needle"]), (id, node, children) =>
      h("g", { "data-ovl-part": id, transform: "rotate(30 50 50)" }, [{ ...node, children }]));
    const markup = out.map(toMarkup).join("");
    expect(markup).toContain('<g data-ovl-part="p_needle" transform="rotate(30 50 50)"><path data-part="p_needle" d="M50 50L50 5" stroke="#ffffff" transform="rotate(5)"/></g>');
    // Untouched branches keep their identity (no DOM work).
    const bodyIndex = nodes.findIndex((n) => typeof n !== "string" && n.attrs["data-part"] === "body");
    expect(out[bodyIndex]).toBe(nodes[bodyIndex]);
  });
});
