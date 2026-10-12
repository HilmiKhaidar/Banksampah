export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");
export const AUTH_SYNC_CHANNEL = "sekolah-merdeka-bank-sampah:auth-sync:v1";

export function apiUrl(path: string) {
  const baseUrl = configuredApiBaseUrl ??
    (typeof window === "undefined"
      ? "http://localhost:4000"
      : `${window.location.protocol}//${window.location.hostname}:4000`);
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

type ApiRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
};

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");

  const url = apiUrl(path);
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      credentials: "include",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(12000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ApiError(
        "Server tidak merespons dalam 12 detik. Pastikan backend dan MySQL sedang berjalan.",
        0,
        "API_TIMEOUT",
      );
    }
    throw new ApiError(
      `Tidak dapat terhubung ke server (${url}). Pastikan backend berjalan dan perangkat dapat menjangkaunya.`,
      0,
      "API_UNAVAILABLE",
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError("Server mengirim respons yang tidak valid.", response.status, "INVALID_RESPONSE");
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: unknown; message?: unknown } }).error;
    const code = typeof error?.code === "string" ? error.code : "API_ERROR";
    const message = typeof error?.message === "string"
      ? error.message
      : "Permintaan ke server gagal.";
    throw new ApiError(message, response.status, code);
  }

  return payload as T;
}

export function notifyAuthChanged() {
  const channel = new BroadcastChannel(AUTH_SYNC_CHANNEL);
  channel.postMessage(Date.now());
  channel.close();
}
