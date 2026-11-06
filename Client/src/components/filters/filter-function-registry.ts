import { AbsFunction } from "./AbsFunction";
import { AddFunction } from "./AddFunction";
import { ClampFunction } from "./ClampFunction";
import { DeadZoneFunction } from "./DeadZoneFunction";
import { DivideFunction } from "./DivideFunction";
import { FloatValueFunction } from "./FloatValueFunction";
import { GearboxFunction } from "./GearboxFunction";
import { IifFunction } from "./IifFunction";
import { LogFunction } from "./LogFunction";
import { ModuloFunction } from "./ModuloFunction";
import { MultiplyFunction } from "./MultiplyFunction";
import { PowerFunction } from "./PowerFunction";
import { RescaleFunction } from "./RescaleFunction";
import { ReverseFunction } from "./ReverseFunction";
import { SmoothFunction } from "./SmoothFunction";
import { SubtractFunction } from "./SubtractFunction";
import { ToggleFunction } from "./ToggleFunction";
import { TurnSignal } from "./TurnSignal";
import { SignFunction } from "./SignFunction";
import { HudSignalFunction } from "./HudSignalFunction";
import { HudInputFunction } from "./HudInputFunction";
import { TelemetryFunction } from "./TelemetryFunction";
import { ActiveFunction } from "./ActiveFunction";
import { PriorityFunction } from "./PriorityFunction";
import { MaxFunction } from "./MaxFunction";
import { ControllerRumbleFunction } from "./ControllerRumbleFunction";
import { ControllerLightFunction } from "./ControllerLightFunction";
import { MinFunction } from "./MinFunction";
import { DisconnectControllerFunction } from "./DisconnectControllerFunction";
import { TelemetryOutFunction } from "./TelemetryOutFunction";

export var storedToggleValues = {} as Record<number, {switchState: boolean, toggleState: boolean}>;

export type InputMap<T extends readonly string[]> = { [K in T[number]]: number };

export type FilterFunctionParam = {
  name: string;
  label: string;
  type: 'number' | 'string' | 'boolean';
  default: any;
};

export type FilterFunctionDef<TInputs extends ReadonlyArray<string>> = {
  name: string;
  label: string;
  params: FilterFunctionParam[];
  inputLabels: string[];
  outputLabels: string[];
  init?: () => void;
  apply: (inputs: InputMap<TInputs>, params: Record<string, any>, nodeId?: number) => (number | string)[];
};

export const filterFunctionRegistry = {
  Abs: new AbsFunction(),
  Clamp: new ClampFunction(),
  DeadZone: new DeadZoneFunction(),
  Reverse: new ReverseFunction(),
  Add: new AddFunction(),
  Subtract: new SubtractFunction(),
  Multiply: new MultiplyFunction(),
  Divide: new DivideFunction(),
  Modulo: new ModuloFunction(),
  Power: new PowerFunction(),
  Log: new LogFunction(),
  Iif: new IifFunction(),
  Toggle: new ToggleFunction(),
  TurnSignal: new TurnSignal(),
  Rescale: new RescaleFunction(),
  Gearbox: new GearboxFunction(),
  FloatValue: new FloatValueFunction(),
  Smooth: new SmoothFunction(),
  Sign: new SignFunction(),
  HudSignal: new HudSignalFunction(),
  HudInput: new HudInputFunction(),
  Telemetry: new TelemetryFunction(),
  Active: new ActiveFunction(),
  Priority: new PriorityFunction(),
  Max: new MaxFunction(),
  ControllerRumble: new ControllerRumbleFunction(),
  ControllerLight: new ControllerLightFunction(),
  Min: new MinFunction(),
  DisconnectController: new DisconnectControllerFunction(),
  TelemetryOut: new TelemetryOutFunction(),
};

