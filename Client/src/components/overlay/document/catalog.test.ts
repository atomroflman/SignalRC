import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contractsRoot } from "../testing/fixtures";

describe("property catalog copy", () => {
  it("matches Shared/Overlay/catalog/property-catalog.json", () => {
    const shared = fs.readFileSync(path.join(contractsRoot, "catalog/property-catalog.json"), "utf8");
    const copy = fs.readFileSync(path.join(__dirname, "../contracts/property-catalog.json"), "utf8");
    expect(copy, "copy the shared catalog into Client/src/components/overlay/contracts/").toBe(shared);
  });
});
