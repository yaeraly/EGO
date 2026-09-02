const TOKEN_KEY = 'egomot.token';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function storedToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function storeToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

/** A fresh key per mutating request, as every write endpoint expects. */
function idempotencyKey(): string {
  return crypto.randomUUID();
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Reuse a key so a retried submit cannot post the document twice. */
  idempotencyKey?: string;
}

export async function api<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};

  const token = storedToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (method !== 'GET') {
    headers['Idempotency-Key'] = options.idempotencyKey ?? idempotencyKey();
  }

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 401) {
    storeToken(null);
    throw new ApiError(401, 'Сессия бүттү — кайра кириңиз');
  }

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    throw new ApiError(response.status, errorMessage(payload, response.status));
  }

  return payload as T;
}

/**
 * Uploads one file (a product photo, §12-Б.1).
 *
 * A separate function rather than a branch in `api`: multipart sets its own
 * Content-Type with a boundary, so the header must be left for the browser
 * to fill in.
 */
export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);

  const headers: Record<string, string> = {
    'Idempotency-Key': idempotencyKey(),
  };
  const token = storedToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`/api${path}`, {
    method: 'POST',
    headers,
    body: form,
  });

  if (response.status === 401) {
    storeToken(null);
    throw new ApiError(401, 'Сессия бүттү — кайра кириңиз');
  }

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    throw new ApiError(response.status, errorMessage(payload, response.status));
  }
  return payload as T;
}

/**
 * Bytes behind the JWT, as a URL an <img> can use.
 *
 * The token lives in storage, not in a cookie, so the browser cannot fetch a
 * protected image by itself: it is fetched here and handed on as a blob URL.
 * The caller revokes the URL when it is done with it.
 */
export async function apiObjectUrl(path: string): Promise<string> {
  const headers: Record<string, string> = {};
  const token = storedToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`/api${path}`, { headers });
  if (response.status === 401) {
    storeToken(null);
    throw new ApiError(401, 'Сессия бүттү — кайра кириңиз');
  }
  if (!response.ok) {
    throw new ApiError(response.status, `Ката ${response.status}`);
  }
  return URL.createObjectURL(await response.blob());
}

/**
 * Nest's error shape, flattened.
 *
 * The API's messages carry the business rule that was broken (§ references
 * and all), so they are shown as-is rather than replaced with a generic
 * "something went wrong" — the person at the counter needs to know whether
 * the till is empty or the document is already confirmed.
 */
function errorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join('; ');
  }
  return `Ката ${status}`;
}
