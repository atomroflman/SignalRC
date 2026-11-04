// AP12 – starting templates inserted through editor commands (see README.md).
export * from "./types";
export { TEMPLATES, templateById } from "./library";
export { ANGLE_PRESETS, DISTANCE_PRESETS, SPEED_PRESETS, IDENTITY, convertedRef, suggestConversion } from "./conversions";
export { buildContent, centeredPosition, checkMapping, insertTemplate, instantiate, paramValues } from "./instantiate";
export type { ChannelOption, Instance, MappingIssue } from "./instantiate";
export { templateMessages, type TemplateMessages } from "./messages";
export { TemplateInserter, type TemplateInserterProps } from "./template-inserter";
