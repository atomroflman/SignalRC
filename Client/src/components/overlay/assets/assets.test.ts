import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { contractsRoot, readContractJson } from "../testing/fixtures";
import { assetImageUrl, isNormalizedAssetSvg, rejectionCode, uploadResponseToState, uploadSvgAsset } from "./svg-asset";
import { SvgImportPreview } from "./svg-import-preview";
import type { AssetUploadResult, SvgImportState } from "./types";

interface Case { id: string; expected?: string; accepted: boolean }

const cases = readContractJson<{ cases: Case[] }>("fixtures/svg/cases.json").cases;
const expected = (name: string) => fs.readFileSync(path.join(contractsRoot, "fixtures/svg/expected", name), "utf8").trimEnd();
const gradients = expected("gradients-use.svg");

const accepted: AssetUploadResult = {
  assetId: "sha256-" + "a".repeat(64),
  svg: gradients,
  metadata: { assetId: "sha256-" + "a".repeat(64), width: 100, height: 100, parts: { bar: { tag: "g", bbox: [0, 0, 100, 100] } } },
  report: [{ code: "SVG_REMOVED_ELEMENT", count: 2, examples: ["script", "<b>x</b>"] }],
};

const render = (state: SvgImportState, locale: "de" | "en" = "de") =>
  renderToStaticMarkup(createElement(SvgImportPreview, { state, onConfirm: () => {}, onCancel: () => {}, locale }));

describe("normalized asset helpers", () => {
  it("accepts every golden output as canonical", () => {
    for (const c of cases.filter(c => c.expected)) expect(isNormalizedAssetSvg(expected(c.expected!)), c.id).toBe(true);
    expect(isNormalizedAssetSvg('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')).toBe(false);
    expect(isNormalizedAssetSvg('<?xml version="1.0"?>' + gradients)).toBe(false);
    expect(isNormalizedAssetSvg(42)).toBe(false);
  });

  it("builds an image URL that contains the asset only encoded", () => {
    const url = assetImageUrl(gradients);
    expect(url.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(url).not.toContain("<");
    expect(decodeURIComponent(url.slice(url.indexOf(",") + 1))).toBe(gradients);
  });
});

describe("upload response mapping", () => {
  it("accepts only canonical sanitized output", () => {
    const state = uploadResponseToState(200, accepted, "x.svg");
    expect(state.kind).toBe("accepted");
    expect(uploadResponseToState(200, { ...accepted, svg: "<svg onload='x()'/>" }).kind).toBe("failed");
    expect(uploadResponseToState(200, { ...accepted, assetId: "x" }).kind).toBe("failed");
  });

  it("maps rejections with their report", () => {
    const report = [{ code: "SVG_REMOVED_ELEMENT", count: 1, examples: [] }, { code: "SVG_REJECTED_LIMIT", count: 1, examples: ["elements 2001 > 2000"] }];
    expect(rejectionCode(report)).toBe("SVG_REJECTED_LIMIT");
    expect(uploadResponseToState(422, { code: "OVL_API_ASSET_REJECTED", report })).toEqual({ kind: "rejected", fileName: undefined, code: "SVG_REJECTED_LIMIT", report });
    expect(uploadResponseToState(413, { code: "OVL_API_TOO_LARGE" })).toEqual({ kind: "failed", fileName: undefined, status: 413, code: "OVL_API_TOO_LARGE" });
  });

  it("posts the file as multipart form data", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(accepted), { status: 200 }));
    const state = await uploadSvgAsset(7, new File(["<svg/>"], "a.svg"), fetchImpl as unknown as typeof fetch);
    expect(state.kind).toBe("accepted");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/cars/7/overlay/assets");
    expect((init.body as FormData).get("file")).toBeInstanceOf(File);
    const failed = await uploadSvgAsset(7, new File([""], "a.svg"), (async () => { throw new Error("offline"); }) as unknown as typeof fetch);
    expect(failed.kind).toBe("failed");
  });
});

describe("SvgImportPreview", () => {
  it("shows the sanitized asset only as an image and offers confirmation", () => {
    const html = render({ kind: "accepted", fileName: "dial.svg", result: accepted });
    expect(html).toContain('<img src="data:image/svg+xml;charset=utf-8,');
    // The asset is never embedded as markup.
    expect(html).not.toMatch(/<svg|<linearGradient|<clipPath/);
    expect(html).toContain("Bereinigte Grafik übernehmen");
    expect(html).toContain("1 auswählbare Teile");
    // Report examples are text, escaped by React.
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
  });

  it("never offers confirmation for rejected, failed or non-canonical results", () => {
    const rejected = render({ kind: "rejected", code: "SVG_REJECTED_DOCTYPE", report: [{ code: "SVG_REJECTED_DOCTYPE", count: 1, examples: ["DOCTYPE"] }] }, "en");
    expect(rejected).toContain("Import rejected: DOCTYPE/DTD is not allowed");
    expect(rejected).not.toContain("Use sanitized graphic");
    const forged = render({ kind: "accepted", result: { ...accepted, svg: "<svg><script>alert(1)</script></svg>" } });
    expect(forged).not.toContain("<img");
    expect(forged).not.toContain("übernehmen");
    expect(forged).not.toContain("script");
    expect(render({ kind: "failed", code: "OVL_API_NOT_DRIVER" })).toContain("Nur wer die Steuerung des Fahrzeugs hält, darf importieren");
    expect(render({ kind: "uploading" })).toContain("SVG wird bereinigt");
  });
});
