// Options JSON editor: lenient JSON context, schema lookup, completion and checks.
import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { findSchema, jsonContext, optionCompletions, optionDiagnostics, parseOptionSchemas, topLevelProperties, type ChannelTypeSchema, type OptionsContext } from "./options-language";

const pca: ChannelTypeSchema = {
  kind: "pinManager", typeName: "Pca9685PwmExtension", description: "PWM board.",
  options: [
    { name: "boardAddress", type: "integer", defaultJson: "0" },
    { name: "i2cBus", type: "integer", defaultJson: "1", description: "I2C bus number (/dev/i2c-N)." },
  ],
};
const grid: ChannelTypeSchema = {
  kind: "telemetry", typeName: "SignalRC.Onboard.Telemetry.LidarGridTelemetryReader",
  options: [
    { name: "pinManager", type: "string", defaultJson: "\"lidar\"", reference: "pinManager" },
    { name: "zoneLimitsMm", type: "array", itemType: "integer", defaultJson: "[500,1000,2000,3000,5000]" },
    { name: "scannerClockwise", type: "boolean", defaultJson: "true" },
  ],
};
const v4l2: ChannelTypeSchema = {
  kind: "video", typeName: "v4l2",
  options: [{ name: "inputFormat", type: "string", values: ["mjpeg", "yuyv422", "h264"] }, { name: "hwEncoder", type: "boolean", defaultJson: "false" }],
};
const ctx = (schema?: ChannelTypeSchema): OptionsContext => ({ schema, pinManagers: ["default", "lidar", "pca"] });

/** Completion at the `|` of `text`. */
function complete(text: string, schema: ChannelTypeSchema, explicit = false): CompletionResult | null {
  const pos = text.indexOf("|");
  const doc = text.slice(0, pos) + text.slice(pos + 1);
  const state = EditorState.create({ doc, selection: { anchor: pos } });
  return optionCompletions(() => ctx(schema))(new CompletionContext(state, pos, explicit)) as CompletionResult | null;
}
const labels = (r: CompletionResult | null) => r?.options.map((o) => o.label) ?? [];

describe("schema lookup", () => {
  const schemas = [pca, grid, v4l2];
  it("matches exactly, ignoring case and telemetry readers by class name", () => {
    expect(findSchema(schemas, "pinManager", "Pca9685PwmExtension")).toBe(pca);
    expect(findSchema(schemas, "pinManager", "pca9685pwmextension")).toBe(pca);
    expect(findSchema(schemas, "telemetry", "LidarGridTelemetryReader")).toBe(grid);
    expect(findSchema(schemas, "control", "Pca9685PwmExtension")).toBeUndefined();
    expect(findSchema(schemas, "video", "")).toBeUndefined();
  });

  it("parses the server response defensively", () => {
    expect(parseOptionSchemas(null)).toEqual({ pinManagerTypes: [], schemas: [] });
    expect(parseOptionSchemas({ pinManagerTypes: ["A", 3], schemas: [pca, { typeName: 1 }] })).toEqual({ pinManagerTypes: ["A"], schemas: [pca] });
  });
});

describe("JSON context", () => {
  it("knows key and value positions of the root object", () => {
    expect(jsonContext('{"a": 1, ', 9).frames[0].state).toBe("key");
    const v = jsonContext('{"pinManager": ', 15);
    expect([v.frames[0].state, v.frames[0].key]).toEqual(["value", "pinManager"]);
    expect(jsonContext('{"i2c', 5).string?.key).toBe(true);
    expect(jsonContext('{"a": "mj', 9).string?.key).toBe(false);
  });

  it("finds root properties with value ranges, nested values included", () => {
    const text = '{"a": [1, {"b": 2}], "c": true}';
    expect(topLevelProperties(text).map((p) => [p.key, text.slice(p.valueFrom, p.valueTo)])).toEqual([["a", '[1, {"b": 2}]'], ["c", "true"]]);
  });
});

describe("completion", () => {
  it("offers the keys not set yet, with type and default", () => {
    const r = complete('{"boardAddress": 0, |}', pca, true);
    expect(labels(r)).toEqual(["i2cBus"]);
    expect(r!.options[0].detail).toBe("integer = 1");
  });

  it("completes a key being typed in quotes or bare", () => {
    expect(labels(complete('{"i2|"}', pca))).toEqual(["boardAddress", "i2cBus"]);
    expect(complete('{"i2|"}', pca)!.from).toBe(2);
    expect(labels(complete("{i|", pca))).toEqual(["boardAddress", "i2cBus"]);
  });

  it("offers values: enum, booleans, pin managers and the default", () => {
    expect(labels(complete('{"inputFormat": |', v4l2, true))).toEqual(['"mjpeg"', '"yuyv422"', '"h264"']);
    expect(labels(complete('{"hwEncoder": |', v4l2))).toEqual(["false", "true"]);
    expect(labels(complete('{"pinManager": "|"}', grid))).toEqual(['"lidar"', '"default"', '"pca"']);
  });

  it("starts an object in an empty field and stays quiet in nested values", () => {
    expect(labels(complete("|", pca, true))).toEqual(["boardAddress", "i2cBus"]);
    expect(complete('{"zoneLimitsMm": [1, |', grid, true)).toBeNull();
    expect(complete('{"a": 1|', pca)).toBeNull();
  });
});

describe("checks", () => {
  it("accepts matching options and empty text", () => {
    expect(optionDiagnostics('{"boardAddress": 0, "I2CBUS": 1}', ctx(pca))).toEqual([]);
    expect(optionDiagnostics("", ctx(pca))).toEqual([]);
    expect(optionDiagnostics('{"x": 1', ctx(pca))).toEqual([]); // syntax is the JSON linter's job
  });

  it("warns about unknown keys, wrong types, enum values, pin managers and duplicates", () => {
    const text = '{"pins": [1], "zoneLimitsMm": [1, 2.5], "scannerClockwise": "yes", "pinManager": "lidar2", "pinManager": "lidar"}';
    const d = optionDiagnostics(text, ctx(grid));
    expect(d.map((x) => [text.slice(x.from, x.to), x.message])).toEqual([
      ['"pins"', 'SignalRC.Onboard.Telemetry.LidarGridTelemetryReader has no option "pins"; the vehicle ignores it.'],
      ["[1, 2.5]", "zoneLimitsMm expects array of integer, found array."],
      ['"yes"', "scannerClockwise expects boolean, found string."],
      ['"lidar2"', 'No pin manager named "lidar2" (configured: default, lidar, pca).'],
      ['"pinManager"', '"pinManager" is set twice; the last one wins.'],
    ]);
    expect(optionDiagnostics('{"inputFormat": "rgb"}', ctx(v4l2))[0].message).toBe('inputFormat: "rgb" is none of mjpeg, yuyv422, h264.');
  });

  it("requires an object and checks only duplicates without a schema", () => {
    expect(optionDiagnostics("[1]", ctx(pca))[0].severity).toBe("error");
    expect(optionDiagnostics('{"anything": 1}', ctx())).toEqual([]);
  });
});
