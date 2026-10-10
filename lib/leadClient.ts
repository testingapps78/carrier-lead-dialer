// Small fetch helpers for the lead endpoints. Every call checks response.ok and returns a typed result,
// so no screen can treat a failed save as a success.

export type ApiResult<T = any> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string; status: number };

export async function api<T = any>(url: string, init?: RequestInit, signal?: AbortSignal): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { ...init, signal });
    const data = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: data as T };
    return { ok: false, error: data?.error || `Request failed (${res.status}).`, code: data?.code, status: res.status };
  } catch (e: any) {
    if (e?.name === "AbortError") return { ok: false, error: "Cancelled.", code: "aborted", status: 0 };
    return { ok: false, error: "Network problem. Check your connection and try again.", code: "network", status: 0 };
  }
}

export function post<T = any>(url: string, body: unknown): Promise<ApiResult<T>> {
  return api<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

/** A new random id for one user action. Reuse it when retrying that same action so the server can de-duplicate. */
export function newKey(): string {
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const h = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${h(8)}-${h(4)}-4${h(3)}-a${h(3)}-${h(12)}`;
}

export const MIGRATION_PENDING_TEXT = "Not available yet: a database update still needs to be applied.";

export function friendlyError(r: { error: string; code?: string }): string {
  return r.code === "migration_pending" ? MIGRATION_PENDING_TEXT : r.error;
}
