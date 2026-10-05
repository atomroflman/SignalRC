import { create } from 'zustand';
import { filterFunctionRegistry } from './filters/filter-function-registry';
import { Connection } from 'reactflow';

export type ControlFlowNode = {
  nodeId: number;
  representingId?: number;
  label: string;
  metadata?: FunctionMetadata;
  type: string;
  data: any;
  position: { x: number; y: number };
  nodeTypeName: string;
  latestValue?: number | number[];
  params: Record<string, any>;
  inputPorts?: number;
  outputPorts?: number;
  maxResendInterval?: number;
};

export type FunctionMetadata = {
  functionName: string;
};

export type ControlFlowEdge = {
  id: number;
  source: number;
  sourcePort?: string;
  target: number;
  targetPort?: string;
};

export type ControlFlowState = {
  removeEdge(dbId: number): void;
  addEdge(params: Connection): void;
  nodeLatestValues: Record<string, number>;
  frame: number,
  nodes: ControlFlowNode[];
  edges: ControlFlowEdge[];
  isLoading: boolean;
  error: string | null;
  load: (carId: number) => Promise<void>;
  // save: (userId: string) => Promise<void>;
  setNodes: (nodes: ControlFlowNode[]) => void;
  setEdges: (edges: ControlFlowEdge[]) => void;
  updateNode: (node: ControlFlowNode) => void;
  updateNodeParams(nodeId: number, params: Record<string, any>): Promise<void>;
  recalculateNode: (nodeId: number) => void;
  triggerNodeOutput: (nodeId: number, outputValues?: number[]) => void;
  reset: () => void;
  registerInput: (dbInputId: number ) => void;
  registerOutput: (dbOutputId: number) => void;
  registerFunctionNode: (fnName: string, params?: Record<string, any>, inputPorts?: number, outputPorts?: number) => void;
  deleteNode: (nodeId: number) => void;
  sendOutput: (channelId: number, value: number) => Promise<void>;
  startConnection: (carId: number, carKey: string | undefined) => Promise<void>;
  stopConnection: () => Promise<void>;
  handleInputUpdate: (inputDbId: number, value: number, fromRemote?: boolean) => void;
  connection: any;
  carId: number | undefined;
  userSetupId: number | undefined;
  setConnection: (connection: any) => void;
  setCarId: (carId: number | undefined) => void;
  setCarSession: (carSession: string) => void;
  carSession: string | undefined;
  userChannelConnection?: any;
  subscribedChannels: Set<number>; // Gamepad device IDs we're subscribed to
  remoteGamepads: Set<number>; // Track which gamepad devices are remote (by device ID)
  startUserChannelConnection: () => Promise<void>;
  subscribeToInputNodes: () => Promise<void>;
  unsubscribeFromGamepad: (gamepadDeviceId: number) => Promise<void>;
  stopUserChannelConnection: () => Promise<void>;
  // Update control
  isInConfigMode: boolean;
  updatesEnabled: boolean;
  setConfigMode: (isConfig: boolean) => void;
  setUpdatesEnabled: (enabled: boolean) => void;
  // Authentication tracking
  hasAuthenticatedWithCar: (carId: number) => boolean;
  markCarAsAuthenticated: (carId: number) => void;
  // SSH key functions
  downloadSshKey: (carId: number, vehicleIp: string, saveToStorage?: boolean) => Promise<{ success: boolean; key?: string; error?: string }>;
  uploadSshKey: (carId: number, privateKey: string) => Promise<{ success: boolean; error?: string }>;
  authenticateWithSshKey: (carId: number, privateKey: string, vehicleIp: string) => Promise<boolean>;
  signWithPrivateKey: (data: string, privateKeyPem: string) => Promise<string | null>;
  // Session ID is provided by Onboard after authentication
  pemToArrayBuffer: (pem: string) => ArrayBuffer;
  saveSshPrivateKey: (carId: number, privateKey: string, vehicleIp?: string) => boolean;
  getSshPrivateKey: (carId: number) => string | null;
  getVehicleIp: (carId: number) => string | null;
  removeSshPrivateKey: (carId: number) => boolean;
  // Build local download URL for vehicle key (HTTP, local network only)
  getSshKeyDownloadUrl: (carId: number, vehicleIp: string) => Promise<string | null>;
};

const _resendTimers = new Map<number, ReturnType<typeof setInterval>>();
const _lastSentValues = new Map<number, number>();
const _channelResendIntervals = new Map<number, number>();

function clearAllResendTimers() {
  for (const timer of _resendTimers.values()) {
    clearInterval(timer);
  }
  _resendTimers.clear();
  _lastSentValues.clear();
}

export const useControlFlowStore = create<ControlFlowState>((set, get) => ({
  nodeLatestValues: {},
  nodes: [],
  edges: [],
  frame: 0,
  isLoading: true,
  error: null,
  carId: undefined,
  userSetupId: undefined,
  userChannelConnection: undefined,
  subscribedChannels: new Set<number>(),
  remoteGamepads: new Set<number>(),
  // Update control
  isInConfigMode: false,
  updatesEnabled: true,
  async load(carId: number) {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`/api/userconfig/setup/${carId}`);
      if (!res.ok) 
        throw new Error('Loading setup failed...');
      const data = await res.json() as {carId: number, id: number, userId: number};
      const flowRes = await fetch(`/api/flow/${data.id}`);
      if (!flowRes.ok)      
        throw new Error('Loading flow failed...');
      const flowData = await flowRes.json() as {nodes: ControlFlowNode[], edges: ControlFlowEdge[]};
      console.log("Loaded flow data", flowData);
      
      clearAllResendTimers();
      _channelResendIntervals.clear();
      for (const node of (flowData.nodes || [])) {
        if (node.nodeTypeName === "UserSetupCarChannelNode" && node.representingId != null && node.maxResendInterval) {
          _channelResendIntervals.set(node.representingId, node.maxResendInterval);
        }
      }

      set({
        nodes: flowData.nodes || [],
        edges: flowData.edges || [],
        isLoading: false,
        error: null,
        carId,
        userSetupId: data.id,
      });

      // Start user channel connection for remote controller sync
      await get().startUserChannelConnection();
      await get().subscribeToInputNodes();

      // Initial calculation for all function nodes without incoming edges
      const state = get();
      state.nodes.forEach(node => {
        if (node.nodeTypeName === "UserSetupFunctionNode") {
          const fnName: string | undefined = node.metadata?.functionName;
          if (fnName) {
            const fnDef = filterFunctionRegistry[fnName as keyof typeof filterFunctionRegistry];
            if (fnDef) {
              // Check if this node has any incoming edges
              const hasIncomingEdges = state.edges.some(edge => edge.target === node.nodeId);
              if (!hasIncomingEdges) {
                // This node has no incoming connections - calculate initial value
                state.recalculateNode(node.nodeId);
              }
            }
          }
        }
      });
    } catch (e: any) {
      set({ isLoading: false, error: e.message });
    }
  },
  setNodes(nodes) {
    set({ nodes });
  },
  setEdges(edges) {
    set({ edges });
  },
  async updateNode(node) {
    set(state => ({
      nodes: state.nodes.map(n => n.nodeId === node.nodeId ? { ...n, ...node, params: { ...node.params ?? n.params } } : n),
    }));
  },
  async updateNodeParams(nodeId: number, params: Record<string, any>) {
    if (params) {
      await fetch(`/api/flow/${nodeId}/params`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      // Trigger recalculation for function nodes
      get().recalculateNode(nodeId);
    }
  },
  recalculateNode: (nodeId: number) => {
    const state = get();
    const node = state.nodes.find(n => n.nodeId === nodeId);
    if (!node) return;

    // Handle input nodes - just pass through the value
    if (node.nodeTypeName === "UserSetupUserChannelNode") {
      // Input nodes already have their value set, just propagate downstream
      const value = state.nodeLatestValues[nodeId] ?? 0;
      
      // Propagate to downstream nodes
      const nextEdges = state.edges.filter(e => e.source === nodeId);
      const queue: number[] = [];
      const visited = new Set<number>();
      
      nextEdges.forEach(edge => queue.push(edge.target));
      
      while (queue.length > 0) {
        const targetNodeId = queue.shift();
        if (!targetNodeId || visited.has(targetNodeId)) continue;
        visited.add(targetNodeId);
        
        const targetNode = state.nodes.find(n => n.nodeId === targetNodeId);
        if (!targetNode) continue;
        
        // Recursively recalculate downstream node
        get().recalculateNode(targetNodeId);
        
        // Add next level to queue
        const nextLevelEdges = state.edges.filter(e => e.source === targetNodeId);
        nextLevelEdges.forEach(edge => queue.push(edge.target));
      }
      
      set({ nodeLatestValues: state.nodeLatestValues, nodes: [...state.nodes], frame: state.frame + 1 });
      return;
    }

    // Handle output nodes - send value to car
    if (node.nodeTypeName === "UserSetupCarChannelNode") {
      // Get the input value from incoming edge
      const incomingEdge = state.edges.find(e => e.target === nodeId);
      if (!incomingEdge) 
        return;
      const inputValue = state.nodeLatestValues[incomingEdge.source] ?? 0;
      if (state.nodeLatestValues[nodeId] !== inputValue) {
        state.nodeLatestValues[nodeId] = inputValue;
        node.latestValue = inputValue;
        
        // Send to car
        if (node.representingId !== undefined) {
          state.sendOutput(node.representingId, inputValue);
        }
      }
      
      set({ nodeLatestValues: state.nodeLatestValues, nodes: [...state.nodes], frame: state.frame + 1 });
      return;
    }

    // For function nodes, we need to recalculate based on current inputs
    if (node.nodeTypeName === "UserSetupFunctionNode") {
      const fnName: string | undefined = node.metadata?.functionName;
      if (!fnName) return;
      
      const fnDef = filterFunctionRegistry[fnName as keyof typeof filterFunctionRegistry];
      if (!fnDef) return;

      // Calculate current input values
      const inputValues: Record<string, number | string> = {};
      
      if (fnDef.inputLabels.length === 0) {
        // Functions without inputs (like FloatValue, Button) - use empty input map
        // They rely only on their parameters
      } else {
        // Functions with inputs - collect values from connected edges
        (fnDef.inputLabels as readonly string[]).forEach((label: string) => {
          const incoming = state.edges.find(e => e.target === nodeId && e.targetPort === label);
          if (incoming) {
            inputValues[label] = state.nodeLatestValues[incoming.source] ?? 0;
          } else {
            inputValues[label] = 0;
          }
        });
      }

      // Execute the function with current inputs and parameters
      const calculatedValue = fnDef.apply(inputValues as any, node.params ?? {}, nodeId);
      
      // Update the node's latest value
      state.nodeLatestValues[nodeId] = calculatedValue[0] as number;
      node.latestValue = calculatedValue[0] as number;

      // Propagate changes to downstream nodes
      const nextEdges = state.edges.filter(e => e.source === nodeId);
      const queue: number[] = [];
      const visited = new Set<number>();
      
      nextEdges.forEach(edge => queue.push(edge.target));

      // Process downstream nodes
      while (queue.length > 0) {
        const targetNodeId = queue.shift();
        if (!targetNodeId || visited.has(targetNodeId)) continue;
        visited.add(targetNodeId);
        
        const targetNode = state.nodes.find(n => n.nodeId === targetNodeId);
        if (!targetNode) continue;
        
        // Recursively recalculate downstream nodes
        get().recalculateNode(targetNodeId);
        
        // Add next level to queue
        const nextLevelEdges = state.edges.filter(e => e.source === targetNodeId);
        nextLevelEdges.forEach(edge => queue.push(edge.target));
      }

      // Update the state to trigger re-renders
      set({ nodeLatestValues: state.nodeLatestValues, nodes: [...state.nodes], frame: state.frame + 1 });
    }
  },
  triggerNodeOutput: (nodeId: number, outputValues?: number[]) => {
    const state = get();
    const node = state.nodes.find(n => n.nodeId === nodeId);
    if (!node) return;

    let calculatedValue: number[];
    
    if (outputValues) {
      // Use provided output values
      calculatedValue = outputValues;
    } else {
      // Use current latest value
      calculatedValue = [state.nodeLatestValues[nodeId] ?? 0];
    }

    // Update the node's latest value
    state.nodeLatestValues[nodeId] = calculatedValue[0];
    node.latestValue = calculatedValue[0];

    // Propagate changes to downstream nodes
    const nextEdges = state.edges.filter(e => e.source === nodeId);
    
    nextEdges.forEach((edge, idx) => {
      const targetNode = state.nodes.find(n => n.nodeId === edge.target);
      if (!targetNode) return;
      
      // Trigger recalculation of downstream node
      get().recalculateNode(targetNode.nodeId);
    });

    // Update the state to trigger re-renders
    set({ nodeLatestValues: state.nodeLatestValues, nodes: [...state.nodes], frame: state.frame + 1 });
  },
  async addEdge(params: Connection) {
    const newEdgeRes = await fetch(`/api/flow/link`, {
      method: "POST",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromNodeId: params.source,
        toNodeId: params.target,
        fromPort: params.sourceHandle,
        toPort: params.targetHandle,
      })
    });
    if (!newEdgeRes.ok) 
      throw new Error("Linking failed...");
    const newEdge = await newEdgeRes.json();
    set((state) => { 
      return {
        edges: [
          ...state.edges, 
          {
            id: newEdge.id,
            source: newEdge.source,
            target: newEdge.target,
            sourcePort: newEdge.sourcePort,
            targetPort: newEdge.targetPort,
          } as ControlFlowEdge
        ]
      };
    });
  },
  async removeEdge(dbId: number) {
    await fetch(`/api/flow/unlink/` + dbId, {
      method: "DELETE"
    });
    set(state => ({edges: state.edges.filter(e => e.id != dbId)}));
  },
  reset() {
    set({ nodes: [], edges: [], error: null });
  },
  async registerInput(dbId: number) {
    if (get().nodes.some(n => n.representingId == dbId && n.type == "input")) 
      return {};
    const res = await fetch(`/api/flow/input/${dbId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userSetupId: get().userSetupId,
        id: dbId,
        positionX: 100,
        positionY: 100 + get().nodes.length * 40,
      })
    });
    if (!res.ok) {
      console.error("Failed to register input node", res.status, res.statusText);
      return {};
    }
    const input = await res.json();
    set(state => {      
      return {
        nodes: [
          ...state.nodes,
          {
            nodeId: input.nodeId,
            representingId: dbId,
            type: 'input',
            data: { ...input },
            position: { x: input.positionX, y: input.positionY },
            nodeTypeName: input.nodeTypeName,
            metadata: undefined,
            label: input.label,
            params: {}, // immer ein Objekt
          },
        ],
      };
    });
  },
  async registerOutput(dbId: number) {
    const nodeId = `output-${dbId}`;
    if (get().nodes.some(n => n.representingId == dbId && n.type == "output")) 
      return {};
    const res = await fetch(`/api/flow/output/${dbId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userSetupId: get().userSetupId,
        id: dbId,
        positionX: 100,
        positionY: 400 + get().nodes.length * 40,
      })
    });
    if (!res.ok) {
      console.error("Failed to register input node", res.status, res.statusText);
      return {};
    }
    const output = await res.json();

    set(state => {     
      return {
        nodes: [
          ...state.nodes,
          {
            nodeId: output.nodeId,
            representingId: dbId,
            type: 'output',
            data: { ...output },
            position: { x: output.positionX, y: output.positionY },
            nodeTypeName: output.nodeTypeName,
            metadata: undefined,
            label: output.label,
            params: {}, // immer ein Objekt
          },
        ],
      }
    });
  },
  async registerFunctionNode(fnName: string, params: Record<string, any> = {}, inputPorts: number = 1, outputPorts: number = 1) {
    const res = await fetch(`/api/flow/function`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userSetupId: get().userSetupId,
        SetupFunctionName: fnName,
        positionX: 100,
        positionY: 200 + get().nodes.length * 40,
        params,
        inputPorts,
        outputPorts,
      })
    });
    if (!res.ok) {
      console.error("Failed to register function node", res.status, res.statusText);
      return;
    }
    const fnNode = await res.json();
    set(state => ({
      nodes: [
        ...state.nodes,
        {
          nodeId: fnNode.nodeId,
          representingId: undefined,
          type: 'default',
          data: { ...fnNode },
          position: { x: fnNode.positionX, y: fnNode.positionY },
          nodeTypeName: fnNode.nodeTypeName,
          metadata: fnNode.metadata,
          label: fnNode.label,
          params: fnNode.params || params || {},
          inputPorts: fnNode.inputPorts || inputPorts,
          outputPorts: fnNode.outputPorts || outputPorts,
        },
      ],
    }));
  },
  async deleteNode(nodeId: number) {
    var res = await fetch(`/api/flow/${nodeId}`, {
      method: "DELETE"
    })
    if (!res.ok)
      throw new Error("Node deletion failed.");

    set(state => ({
      nodes: state.nodes.filter(n => n.nodeId !== nodeId),
      edges: state.edges.filter(e => e.source !== nodeId && e.target !== nodeId),
    }));
  },
  async sendOutput(channelId: number, value: number) {
    const { carId, carSession, connection, updatesEnabled, isInConfigMode } = get();
    console.log("send out", carId, carSession, connection?.state, "updatesEnabled:", updatesEnabled, "isInConfigMode:", isInConfigMode);
    
    if (connection && carId && carSession && updatesEnabled) {
      await connection.invoke("UpdateChannel", carId, carSession, channelId, value);
      _lastSentValues.set(channelId, value);

      const resendMs = _channelResendIntervals.get(channelId);
      if (resendMs && !_resendTimers.has(channelId)) {
        const interval = Math.floor(resendMs / 2);
        _resendTimers.set(channelId, setInterval(() => {
          const { connection: conn, carId: cId, carSession: sess, updatesEnabled: enabled } = get();
          const lastVal = _lastSentValues.get(channelId);
          if (conn && cId && sess && enabled && lastVal !== undefined) {
            conn.invoke("UpdateChannel", cId, sess, channelId, lastVal)
              .catch((err: any) => console.error("Resend failed:", err));
          }
        }, interval));
      }
    } else if (isInConfigMode && !updatesEnabled) {
      console.log("Updates disabled: In configuration mode (default off)");
    } else if (!updatesEnabled) {
      console.log("Updates disabled: Updates manually disabled");
    }
  },
  async startConnection(carId: number, carKey: string | undefined) {
    const signalR = await import("@microsoft/signalr");
    var { connection } = get();
    if (!get().connection) {
        connection = new signalR.HubConnectionBuilder()
        .withUrl(`/hubs/connection`)
        .withAutomaticReconnect()
        .build();
        await connection.start();
        // ponytail: only wipe carSession when the connection is brand-new.
        // On a remount (page nav, / → /car/[id] → /) the zustand store
        // survives but this useEffect re-runs and would clobber the
        // already-authenticated session, flipping UpdateControl to
        // "Disconnected" while the Onboard still has _sessionId.
        set({ connection, carId, carSession: undefined });
    } else {
        set({ carId });
    }
  },
  async downloadSshKey(carId: number, vehicleIp: string, saveToStorage: boolean = true): Promise<{ success: boolean; key?: string; error?: string }> {
    try {
      // First, get the identity hash from the server
      const hashResponse = await fetch(`/api/car/${carId}/identity-hash`);
      if (!hashResponse.ok) {
        return { success: false, error: "Failed to get vehicle identity hash from server" };
      }
      const { hash } = await hashResponse.json();

      // Download SSH key directly from vehicle (local network only).
      // HTTPS so fetch() works from an HTTPS UI without mixed-content blocking;
      // the vehicle serves a self-signed cert and only Firefox can persist the
      // user-accepted exception, so the caller gates this path to Firefox.
      const response = await fetch(`https://${vehicleIp}:8443/ssh-key?hash=${hash}`);
      if (response.status === 400) {
        return { success: false, error: "Invalid request to vehicle" };
      }
      if (response.status === 403) {
        return { success: false, error: "Identity verification failed - the vehicle IP does not match the selected vehicle" };
      }
      if (response.status === 410) {
        return { success: false, error: "SSH key has already been downloaded and is no longer available." };
      }
      if (!response.ok) {
        return { success: false, error: `Failed to get SSH key from vehicle: ${response.statusText}` };
      }
      
      // Expect binary; convert to base64 for storage
      const arrayBuffer = await response.arrayBuffer();
      const byteArray = new Uint8Array(arrayBuffer);
      const binaryString = Array.from(byteArray).map(b => String.fromCharCode(b)).join("");
      const base64Key = btoa(binaryString);
      
      if (saveToStorage) {
        // Save the private key to localStorage
        const saveSuccess = get().saveSshPrivateKey(carId, base64Key, vehicleIp);
        if (!saveSuccess) {
          return { success: false, error: "Failed to save SSH private key to browser storage." };
        }
        console.log("SSH private key downloaded and saved successfully");
      }
      
      return { success: true, key: base64Key };
    } catch (error) {
      console.error("Failed to download SSH key:", error);
      return { success: false, error: `Failed to download SSH key: ${error}` };
    }
  },

  async uploadSshKey(carId: number, privateKey: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Normalize input: accept PEM (PKCS#8) or Base64 DER
      let base64Body = privateKey.trim();
      const pemHeader = "-----BEGIN PRIVATE KEY-----";
      const pemFooter = "-----END PRIVATE KEY-----";
      if (base64Body.includes(pemHeader) && base64Body.includes(pemFooter)) {
        base64Body = base64Body.replace(pemHeader, "").replace(pemFooter, "");
      }
      // Remove whitespace and normalize URL-safe base64
      base64Body = base64Body.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
      // Validate base64 by attempting decode
      try {
        const padded = base64Body + "=".repeat((4 - (base64Body.length % 4)) % 4);
        atob(padded);
      } catch {
        return { success: false, error: "Invalid key format. Provide PEM or Base64 DER." };
      }

      // Save the normalized base64 to localStorage
      const saveSuccess = get().saveSshPrivateKey(carId, base64Body);
      if (!saveSuccess) {
        return { success: false, error: "Failed to save SSH private key to browser storage." };
      }
      
      console.log("SSH private key uploaded and saved successfully");
      return { success: true };
    } catch (error) {
      console.error("Failed to upload SSH key:", error);
      return { success: false, error: `Failed to upload SSH key: ${error}` };
    }
  },
  async authenticateWithSshKey(carId: number, privateKey: string, vehicleIp: string): Promise<boolean> {
    try {
      // Get challenge from the vehicle via server
      const { connection } = get();
      if (!connection) {
        return false;
      }

      const challenge = await connection.invoke("GetChallenge", carId);
      if (!challenge) {
        console.error("Could not get challenge from vehicle");
        return false;
      }
      
      // Session ID is generated by Onboard service; no local generation needed

      // Sign the challenge with the private key
      const signature = await this.signWithPrivateKey(challenge, privateKey);
      if (!signature) {
        console.error("Failed to sign challenge");
        return false;
      }

      // Create SSH authentication object matching SshAuthenticationRequest structure
      const sshAuthRequest = {
        Challenge: challenge,
        Signature: signature
      };
      
      // Try to authenticate
      const carSession = await connection.invoke("AquireCarControl", carId, sshAuthRequest);
      if (carSession) {
        set({ carSession });
        // Mark car as authenticated for config access
        get().markCarAsAuthenticated(carId);
        return true;
      }
      return false;
    } catch (error) {
      console.error("SSH authentication failed:", error);
      return false;
    }
  },
  async signWithPrivateKey(data: string, privateKeyPem: string): Promise<string | null> {
    try {
      // Import the private key
      const key = await crypto.subtle.importKey(
        "pkcs8",
        this.pemToArrayBuffer(privateKeyPem),
        {
          name: "RSASSA-PKCS1-v1_5",
          hash: { name: "SHA-256" },
        },
        false,
        ["sign"]
      );

      // Sign the data
      const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        key,
        new TextEncoder().encode(data)
      );

      // Convert to base64
      const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
      try {
        // Compute fingerprint of private key for troubleshooting
        const keyBytes = new Uint8Array(this.pemToArrayBuffer(privateKeyPem));
        const digest = await crypto.subtle.digest("SHA-256", keyBytes);
        const fpHex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
        console.debug("PrivateKey(PKCS8) SHA256 HEX:", fpHex);
      } catch {}
      return sigB64;
    } catch (error) {
      console.error("Failed to sign with private key:", error);
      return null;
    }
  },
  pemToArrayBuffer(keyData: string): ArrayBuffer {
    // Accepts:
    // - PEM (PKCS#8 with headers)
    // - Base64 of DER
    // - Raw binary string (fallback)
    let body = keyData?.trim() ?? "";
    const pemHeader = "-----BEGIN PRIVATE KEY-----";
    const pemFooter = "-----END PRIVATE KEY-----";
    if (body.includes(pemHeader) && body.includes(pemFooter)) {
      body = body.replace(pemHeader, "").replace(pemFooter, "");
    }
    // Remove whitespace/newlines
    body = body.replace(/\s+/g, "");
    // Normalize URL-safe base64 and pad
    const normalized = body.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    try {
      const binaryString = atob(padded);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
    } catch (e) {
      // Fallback: interpret as raw binary string
      const bytes = new Uint8Array(body.length);
      for (let i = 0; i < body.length; i++) {
        bytes[i] = body.charCodeAt(i) & 0xff;
      }
      return bytes.buffer;
    }
  },
  saveSshPrivateKey(carId: number, privateKey: string, vehicleIp?: string) {
    try {
      localStorage.setItem(`ssh_private_key_${carId}`, privateKey);
      if (vehicleIp) {
        localStorage.setItem(`vehicle_ip_${carId}`, vehicleIp);
      }
      return true;
    } catch (error) {
      console.error("Failed to save SSH private key:", error);
      return false;
    }
  },
  getSshPrivateKey(carId: number): string | null {
    try {
      return localStorage.getItem(`ssh_private_key_${carId}`);
    } catch (error) {
      console.error("Failed to get SSH private key:", error);
      return null;
    }
  },
  getVehicleIp(carId: number): string | null {
    try {
      return localStorage.getItem(`vehicle_ip_${carId}`);
    } catch (error) {
      console.error("Failed to get vehicle IP:", error);
      return null;
    }
  },
  removeSshPrivateKey(carId: number) {
    try {
      localStorage.removeItem(`ssh_private_key_${carId}`);
      localStorage.removeItem(`vehicle_ip_${carId}`);
      return true;
    } catch (error) {
      console.error("Failed to remove SSH private key:", error);
      return false;
    }
  },
  async getSshKeyDownloadUrl(carId: number, vehicleIp: string): Promise<string | null> {
    try {
      const hashResponse = await fetch(`/api/car/${carId}/identity-hash`);
      if (!hashResponse.ok) return null;
      const { hash } = await hashResponse.json();
      // HTTPS to match scheme of the UI page; vehicle uses a self-signed cert
      // (Firefox only). Used by the "Open link" button (browser-native nav,
      // lets the user accept the cert once via the address-bar warning).
      return `https://${vehicleIp}:8443/ssh-key?hash=${hash}`;
    } catch (e) {
      console.error("Failed to build SSH key download URL:", e);
      return null;
    }
  },
  async stopConnection() {
    clearAllResendTimers();
    const { connection, carId, carSession } = get();
    try {
      if (connection && carId && carSession) {
        await connection.invoke("ReleaseCarControl", carId, carSession);
      }
    } catch (err) {
      console.error("Failed to notify vehicle about session release:", err);
    } finally {
      try { if (connection) await connection.stop(); } catch {}
      set({ connection: undefined, carSession: undefined });
    }
  },  
  handleInputUpdate(inputDbId: number, value: number, fromRemote: boolean = false) {
    const state = get();
    console.log("handleInputUpdate", inputDbId, value, fromRemote);
    
    // Only broadcast if this is a LOCAL update (not from remote)
    if (!fromRemote) {
      const { userChannelConnection } = state;
      console.log("userChannelConnection", userChannelConnection);
      if (userChannelConnection) {
        userChannelConnection.invoke("UpdateUserChannelValue", inputDbId, value)
          .catch((err: any) => console.error("Failed to broadcast channel update:", err));
      }
    }
    
    // Find all input nodes that represent this channel
    const inputNodes = state.nodes.filter(node => 
      node.type === "input" && node.representingId === inputDbId
    );
    
    // Update the value for each input node and trigger recalculation
    inputNodes.forEach(inputNode => {
      // Set the input node's value
      state.nodeLatestValues[inputNode.nodeId] = value;
      inputNode.latestValue = value;
      
      // Recalculate this node (which will propagate to all downstream nodes and send outputs)
      get().recalculateNode(inputNode.nodeId);
    });
  },
  connection: undefined,
  carSession: undefined,
  setConnection: (connection: any) => set({ connection }),
  setCarId: (carId: number | undefined) => set({ carId }),
  setCarSession: (carSession: string) => set({ carSession }),
  
  async startUserChannelConnection() {
    const signalR = await import("@microsoft/signalr");
    const { userChannelConnection } = get();
    
    if (!userChannelConnection) {
      const connection = new signalR.HubConnectionBuilder()
        .withUrl("/hubs/userchannel")
        .withAutomaticReconnect()
        .build();

      connection.on("ReceiveUserChannelValue", async (userChannelId: number, value: number) => {
        console.log(`Received remote update: channel ${userChannelId} = ${value}`);
        const state = get();
        
        // Find which gamepad device this channel belongs to and mark it as remote
        const { useGamepadStore } = await import("./controller-store");
        const gamepadStore = useGamepadStore.getState();
        
        for (const gp of Object.values(gamepadStore.knownGamepads)) {
          // Check if this channel belongs to this gamepad
          const axisIndex = gp.axes.findIndex(a => a.id === userChannelId);
          const buttonIndex = gp.buttons.findIndex(b => b.id === userChannelId);
          
          if (axisIndex !== -1 || buttonIndex !== -1) {
            // Mark gamepad as remote
            state.remoteGamepads.add(gp.id);
            set({ remoteGamepads: new Set(state.remoteGamepads) });
            
            // Update the value in knownGamepads
            if (axisIndex !== -1) {
              gp.axes[axisIndex].latestValue = value;
            } else if (buttonIndex !== -1) {
              gp.buttons[buttonIndex].latestValue = value;
            }
            
            // Trigger gamepad store update to refresh UI
            gamepadStore.setKnownGamepads({ ...gamepadStore.knownGamepads });
            break;
          }
        }
        
        // Update the node value
        get().handleInputUpdate(userChannelId, value, true); // true = fromRemote
      });

      await connection.start();
      set({ 
        userChannelConnection: connection, 
        subscribedChannels: new Set(),
        remoteGamepads: new Set()
      });
    }
  },

  async subscribeToInputNodes() {
    const { userChannelConnection, subscribedChannels } = get();
    const { useGamepadStore } = await import("./controller-store");
    const gamepadStore = useGamepadStore.getState();
    
    if (!userChannelConnection) return;

    // Subscribe to gamepads that are NOT locally connected
    for (const gp of Object.values(gamepadStore.knownGamepads)) {
      if (!gp.connected && !subscribedChannels.has(gp.id)) {
        await userChannelConnection.invoke("SubscribeToGamepad", gp.id);
        subscribedChannels.add(gp.id);
        console.log(`Subscribed to remote gamepad ${gp.id} (${gp.name})`);
      }
    }
    
    set({ subscribedChannels: new Set(subscribedChannels) });
  },

  async unsubscribeFromGamepad(gamepadDeviceId: number) {
    const { userChannelConnection, subscribedChannels, remoteGamepads } = get();
    if (!userChannelConnection) return;
    
    if (subscribedChannels.has(gamepadDeviceId)) {
      await userChannelConnection.invoke("UnsubscribeFromGamepad", gamepadDeviceId);
      subscribedChannels.delete(gamepadDeviceId);
      remoteGamepads.delete(gamepadDeviceId);
      
      set({ 
        subscribedChannels: new Set(subscribedChannels),
        remoteGamepads: new Set(remoteGamepads)
      });
      console.log(`Unsubscribed from gamepad ${gamepadDeviceId}`);
    }
  },

  async stopUserChannelConnection() {
    const { userChannelConnection } = get();
    if (userChannelConnection) {
      await userChannelConnection.stop();
      set({ 
        userChannelConnection: undefined, 
        subscribedChannels: new Set(),
        remoteGamepads: new Set()
      });
    }
  },

  // Update control functions
  setConfigMode: (isConfig: boolean) => {
    const state = get();
    if (isConfig) {
      clearAllResendTimers();
      set({ 
        isInConfigMode: true,
        updatesEnabled: false
      });
      console.log("Config mode: ON, Updates disabled by default");
    } else {
      // Leaving config mode: restore previous state or enable by default
      set({ 
        isInConfigMode: false,
        updatesEnabled: true // Re-enable when leaving config mode
      });
      console.log("Config mode: OFF, Updates enabled");
    }
  },

  setUpdatesEnabled: (enabled: boolean) => {
    if (!enabled) clearAllResendTimers();
    set({ updatesEnabled: enabled });
    console.log("Updates enabled:", enabled);
  },

  // Authentication tracking functions
  hasAuthenticatedWithCar: (carId: number) => {
    try {
      const authKey = `car_auth_${carId}`;
      return localStorage.getItem(authKey) === "true";
    } catch (error) {
      console.error("Failed to check car authentication:", error);
      return false;
    }
  },

  markCarAsAuthenticated: (carId: number) => {
    try {
      const authKey = `car_auth_${carId}`;
      localStorage.setItem(authKey, "true");
      console.log(`Marked car ${carId} as authenticated`);
    } catch (error) {
      console.error("Failed to mark car as authenticated:", error);
    }
  },
}));