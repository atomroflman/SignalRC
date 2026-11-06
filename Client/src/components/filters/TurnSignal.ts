import { FilterFunctionDef, FilterFunctionParam, InputMap } from "./filter-function-registry";

// This function adds a behavior similar to a turn signal in a car.
// It enables the turn signal when the enable input is 1.
// It keeps track if the steering.
// In a car there is a click for each step of the turn signal.
// If the steering is turned against direction and over the click (step), it will disable the turn signal.
export class TurnSignal implements FilterFunctionDef<readonly ["enable", "steering"]> {
  // Store state per nodeId: { isEnabled, initialSteering, hasCrossed, isLeftTurn, lastEnable }
  private state: Record<number, { isEnabled: boolean; initialSteering: number; hasCrossed: boolean; isLeftTurn: boolean; lastEnable: number; }> = {};
  name = 'TurnSignal';
  label = 'Turn Signal';
  params: FilterFunctionParam[] = [{
    name: 'steps',
    label: 'steps',
    type: 'number',
    default: 5,
  }, {
    name: 'isLeftTurn',
    label: 'isLeftTurn',
    type: 'boolean',
    default: true, // true = left, false = right
  }];
  inputLabels = ["enable", "steering"];
  outputLabels = ['isEnabled'];
  apply(inputs: InputMap<readonly ["enable", "steering"]>, params: Record<string, any>, nodeId?: number) {
    if (nodeId === undefined) return [0];
    const enable = Math.round(inputs.enable);
    const steering = inputs.steering ?? 0;
    // Parameters arrive as text from the server ("5", "false"); same parsing as the onboard engine.
    const parsedSteps = Number(params?.steps ?? 5);
    const steps = Number.isFinite(parsedSteps) && parsedSteps > 0 ? parsedSteps : 5;
    const isLeftTurn = !(params?.isLeftTurn === false || String(params?.isLeftTurn ?? "").trim().toLowerCase() === "false");

    const clickSize = 1.0 / steps;

    if (!this.state[nodeId]) {
      this.state[nodeId] = {
        isEnabled: false,
        initialSteering: steering,
        isLeftTurn,
        lastEnable: 0,
        maxStepInDirection: 0,
      } as any;
    }

    const s = this.state[nodeId] as (typeof this.state)[number] & { maxStepInDirection: number; };

    // Rising edge: toggle
    if (s.lastEnable === 0 && enable === 1) {
      s.isEnabled = !s.isEnabled;
      if (s.isEnabled) {
        s.initialSteering = steering;
        s.isLeftTurn = isLeftTurn;
        s.maxStepInDirection = 0;
      }
    }

    s.lastEnable = enable;

    if (s.isEnabled) {
      const delta = steering - s.initialSteering;
      const stepIndex = Math.floor(delta / clickSize);

      // Merken wie weit man in Blinker-Richtung gedreht hat
      if (isLeftTurn) {
        if (stepIndex < s.maxStepInDirection) {
          s.maxStepInDirection = stepIndex;
        }
        // Blinker aus, wenn man wieder über max zurückdreht
        if (stepIndex > s.maxStepInDirection) {
          s.isEnabled = false;
        }
      } else {
        if (stepIndex > s.maxStepInDirection) {
          s.maxStepInDirection = stepIndex;
        }
        if (stepIndex < s.maxStepInDirection) {
          s.isEnabled = false;
        }
      }
    }

    return [s.isEnabled ? 1 : 0];
  }
}
