import { FilterFunctionDef, FilterFunctionParam, InputMap } from "./filter-function-registry";

// This function implements a gearbox similar to a car transmission.
// It shifts up/down based on input signals and maintains gear state.
// The gearbox has configurable gear names and maintains state per node.
export class GearboxFunction implements FilterFunctionDef<readonly ["shiftUp", "shiftDown"]> {
  // Store state per nodeId: { currentGear, lastShiftUp, lastShiftDown, gearNames }
  private state: Record<number, { 
    currentGear: number; 
    lastShiftUp: number; 
    lastShiftDown: number; 
    gearNames: string[];
  }> = {};

  name = 'Gearbox';
  label = 'Gearbox (Schaltung)';
  params: FilterFunctionParam[] = [
    {
      name: 'initialGear',
      label: 'Initial Gear',
      type: 'number',
      default: 1,
    },
    {
      name: 'gearNames',
      label: 'Gear Names',
      type: 'string',
      default: 'R,N,1,2,3,4,5', // Reverse, Neutral, 1-5
    }
  ];
  inputLabels = ["shiftUp", "shiftDown"];
  outputLabels = ['currentGear', 'gearValue', 'gearName'];

  apply(inputs: InputMap<readonly ["shiftUp", "shiftDown"]>, params: Record<string, any>, nodeId?: number) {
    if (nodeId === undefined) return [0, 0, 0];

    const shiftUp = Math.round(inputs.shiftUp ?? 0);
    const shiftDown = Math.round(inputs.shiftDown ?? 0);
    // Parameters arrive as text from the server.
    const parsedGear = Number(params?.initialGear);
    const initialGear = params?.initialGear !== undefined && params.initialGear !== '' && Number.isFinite(parsedGear) ? Math.round(parsedGear) : 1;
    const gearNamesStr = typeof params?.gearNames === 'string' ? params.gearNames : 'R,N,1,2,3,4,5';
    const gearNames = gearNamesStr.split(',').map(name => name.trim());
    const maxGear = gearNames.length - 1; // maxGear ergibt sich aus der Anzahl der Gänge

    // Initialize state for this node
    if (!this.state[nodeId]) {
      this.state[nodeId] = {
        currentGear: initialGear,
        lastShiftUp: 0,
        lastShiftDown: 0,
        gearNames: gearNames
      };
    }

    const s = this.state[nodeId];

    // Update gear names if changed
    if (JSON.stringify(s.gearNames) !== JSON.stringify(gearNames)) {
      s.gearNames = gearNames;
    }

    // Rising edge detection for shift up
    if (s.lastShiftUp === 0 && shiftUp === 1) {
      if (s.currentGear < maxGear) {
        s.currentGear++;
      }
    }

    // Rising edge detection for shift down
    if (s.lastShiftDown === 0 && shiftDown === 1) {
      if (s.currentGear > 0) {
        s.currentGear--;
      }
    }

    // Update last values for edge detection
    s.lastShiftUp = shiftUp;
    s.lastShiftDown = shiftDown;

    // Ensure gear is within bounds
    s.currentGear = Math.max(0, Math.min(s.currentGear, maxGear));

    const gearName = s.gearNames[s.currentGear] || `Gear${s.currentGear}`;

    // One value per output: currentGear, gearValue (0 … 1 over the gears), gearName.
    const gearValue = maxGear > 0 ? s.currentGear / maxGear : 0;
    return [s.currentGear, gearValue, gearName];
  }

  // Helper method to get current gear state (for external access)
  getCurrentGear(nodeId: number): { gear: number; name: string; value: number } | null {
    const s = this.state[nodeId];
    if (!s) return null;
    
    const gearName = s.gearNames[s.currentGear] || `Gear${s.currentGear}`;
    const maxGear = s.gearNames.length - 1;
    const gearValue = s.currentGear / maxGear;
    
    return {
      gear: s.currentGear,
      name: gearName,
      value: gearValue
    };
  }

  // Helper method to reset gearbox to initial state
  reset(nodeId: number, initialGear?: number): void {
    if (this.state[nodeId]) {
      this.state[nodeId].currentGear = initialGear ?? 1;
      this.state[nodeId].lastShiftUp = 0;
      this.state[nodeId].lastShiftDown = 0;
    }
  }
}
