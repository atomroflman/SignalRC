import { useCallback, useEffect, useState } from "react";
import { useControlFlowStore } from "./control-flow-store";

/**
 * Rights of this browser on a vehicle (Docs/VehicleKeyAuth.md, GET /api/cars/{id}/access).
 * Configuring needs the control session or a config session; both rest on a signature
 * with the vehicle (owner) key, there is no other login.
 */
export type VehicleAccessInfo = {
  drive: boolean;
  configure: boolean;
  configSession: boolean;
  expiresAt: string | null;
  /** The vehicle reported its owner key, so a config session can be opened (also offline). */
  ownerKeyKnown: boolean;
  ownerKeyFingerprint: string | null;
  deviceKeyKnown: boolean;
  /** "authenticated", "updateOnly", "keyConflict" or null (not connected). */
  vehicleState: string | null;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function fetchVehicleAccess(carId: number, fetchImpl: FetchLike = fetch): Promise<VehicleAccessInfo | null> {
  try {
    const res = await fetchImpl(`/api/cars/${carId}/access`, { cache: "no-store", credentials: "same-origin" });
    return res.ok ? (await res.json()) as VehicleAccessInfo : null;
  } catch {
    return null;
  }
}

export type OpenConfigSessionResult =
  | { ok: true }
  | { ok: false; reason: "noKey" | "noOwnerKey" | "signature" | "error"; message?: string };

/**
 * Opens a config session: the server hands out a nonce, the browser signs it with the
 * stored vehicle key, the server checks it against the owner public key and sets an
 * HttpOnly session cookie.
 */
export async function openConfigSession(
  carId: number,
  deps: { privateKey: string | null; sign: (data: string, privateKey: string) => Promise<string | null>; fetchImpl?: FetchLike },
): Promise<OpenConfigSessionResult> {
  const f = deps.fetchImpl ?? fetch;
  if (!deps.privateKey) return { ok: false, reason: "noKey" };
  try {
    const nonceRes = await f(`/api/cars/${carId}/config-session/nonce`, { method: "POST", credentials: "same-origin" });
    if (!nonceRes.ok) return { ok: false, reason: "error", message: await nonceRes.text() };
    const { nonce } = (await nonceRes.json()) as { nonce: string };
    const signature = await deps.sign(nonce, deps.privateKey);
    if (!signature) return { ok: false, reason: "signature" };
    const res = await f(`/api/cars/${carId}/config-session`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nonce, signature }),
    });
    if (res.ok) return { ok: true };
    if (res.status === 409) return { ok: false, reason: "noOwnerKey" };
    if (res.status === 403) return { ok: false, reason: "signature" };
    return { ok: false, reason: "error", message: await res.text() };
  } catch (e) {
    return { ok: false, reason: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** Opens a config session with the vehicle key stored in this browser. */
export function openConfigSessionWithStoredKey(carId: number): Promise<OpenConfigSessionResult> {
  const store = useControlFlowStore.getState();
  return openConfigSession(carId, {
    privateKey: store.getSshPrivateKey(carId),
    sign: (data, key) => store.signWithPrivateKey(data, key),
  });
}

export async function closeConfigSession(carId: number, fetchImpl: FetchLike = fetch): Promise<void> {
  await fetchImpl(`/api/cars/${carId}/config-session`, { method: "DELETE", credentials: "same-origin" }).catch(() => undefined);
}

/** Whether this browser holds the vehicle key (it can open a config session itself). */
export function hasStoredVehicleKey(carId: number | undefined): boolean {
  return !!carId && !!useControlFlowStore.getState().getSshPrivateKey(carId);
}

/**
 * Rights on the vehicle; reloaded when a control session starts or ends, since the
 * server grants driving (and with it configuring) right then.
 */
export function useVehicleAccess(carId: number | undefined) {
  const carSession = useControlFlowStore(s => s.carSession);
  const [state, setState] = useState<{ carId: number; access: VehicleAccessInfo | null } | null>(null);
  const [epoch, setEpoch] = useState(0);
  const refresh = useCallback(() => setEpoch(e => e + 1), []);
  useEffect(() => {
    if (!carId) return;
    let cancelled = false;
    void fetchVehicleAccess(carId).then(access => { if (!cancelled) setState({ carId, access }); });
    return () => { cancelled = true; };
  }, [carId, carSession, epoch]);
  const current = carId && state?.carId === carId ? state : null;
  return { access: current?.access ?? null, loading: !!carId && current == null, refresh };
}
