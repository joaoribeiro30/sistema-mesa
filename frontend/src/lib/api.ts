import {
  API_BASE_URL,
  AUTH_TOKEN_EXPIRY_STORAGE_KEY,
  AUTH_TOKEN_STORAGE_KEY,
} from './config';
import type {
  AdminEvent,
  AdminEventDashboard,
  AdminEventDetail,
  AdminEventImageKind,
  AdminEventLayout,
  AdminImageUploadResult,
  AdminOverview,
  AdminSector,
  AdminSectorWithTables,
  AdminTable,
  ApiErrorPayload,
  BatchCreateTablesInput,
  CheckInInput,
  CheckInResult,
  CheckoutInput,
  CheckoutPayment,
  CreateAdminEventInput,
  CreateReservationInput,
  CreateSectorInput,
  CreateTableInput,
  EventDetail,
  EventsQueryParams,
  EventStatus,
  EventSummary,
  LoginResponse,
  PaymentStatusInfo,
  ReservationItem,
  ReservationReceipt,
  UpdateAdminEventInput,
  UpdateEventLayoutInput,
  UpdateSectorInput,
  UpdateTableInput,
  User,
} from '@/types/api';
import { recordServerDate } from './serverClock';
import { eventImageMediaType, IMAGE_TOO_LARGE_MESSAGE } from './eventImages';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    status: number,
    code = 'API_ERROR',
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function getStoredAccessToken(): string | null {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    if (!token) return null;

    const expiresAtRaw = localStorage.getItem(AUTH_TOKEN_EXPIRY_STORAGE_KEY);
    if (expiresAtRaw) {
      const expiresAt = Number(expiresAtRaw);
      if (Number.isFinite(expiresAt) && Date.now() >= expiresAt) {
        clearStoredAccessToken();
        return null;
      }
    }
    return token;
  } catch {
    return null;
  }
}

export function storeAccessToken(accessToken: string, expiresInSeconds: number): void {
  try {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, accessToken);
    const expiresAt = Date.now() + Math.max(expiresInSeconds - 10, 0) * 1000;
    localStorage.setItem(AUTH_TOKEN_EXPIRY_STORAGE_KEY, String(expiresAt));
  } catch {
    // Ignore storage errors in restricted environments
  }
}

export function clearStoredAccessToken(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    localStorage.removeItem(AUTH_TOKEN_EXPIRY_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  skipAuth?: boolean;
}

async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { body, headers: customHeaders, skipAuth = false, ...rest } = options;

  const headers = new Headers(customHeaders);

  if (body !== undefined && !(body instanceof FormData) && !(body instanceof Blob)) {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
  }

  if (!skipAuth) {
    const token = getStoredAccessToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const base = API_BASE_URL.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  let response: Response;
  try {
    response = await fetch(`${base}${normalizedPath}`, {
      ...rest,
      headers,
      credentials: 'include',
      body:
        body === undefined
          ? undefined
          : body instanceof FormData || body instanceof Blob
            ? body
            : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      'Não foi possível conectar ao servidor da API. Verifique se o backend está rodando em ' +
        base,
      0,
      'NETWORK_ERROR',
    );
  }

  if (response.status === 204) {
    recordServerDate(response.headers.get('Date'));
    return undefined as T;
  }

  recordServerDate(response.headers.get('Date'));

  const retryAfterHeader = response.headers.get('Retry-After');
  const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) || null : null;

  let payload: unknown = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const errPayload = (payload ?? {}) as ApiErrorPayload;
    const message =
      errPayload.message ||
      (response.status === 429
        ? 'Muitas tentativas em sequência. Aguarde alguns instantes e tente novamente.'
        : `Erro na requisição (${response.status}).`);
    const code =
      errPayload.code ||
      (response.status === 401
        ? 'UNAUTHORIZED'
        : response.status === 403
          ? 'FORBIDDEN'
          : response.status === 429
            ? 'RATE_LIMITED'
            : 'API_ERROR');

    throw new ApiError(message, response.status, code, retryAfterSeconds);
  }

  return payload as T;
}

export function getFriendlyErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return error.retryAfterSeconds
        ? `Limite de tentativas atingido. Tente novamente em ${error.retryAfterSeconds}s.`
        : 'Muitas tentativas recentes. Aguarde um momento antes de tentar novamente.';
    }
    if (error.code === 'NETWORK_ERROR') {
      return error.message;
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Ocorreu um erro inesperado. Tente novamente.';
}

function buildQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export const eventsApi = {
  async list(params: EventsQueryParams = {}): Promise<{ events: EventSummary[] }> {
    const qs = buildQueryString({
      limit: params.limit,
      offset: params.offset,
      startsFrom: params.startsFrom,
      startsTo: params.startsTo,
      city: params.city,
      venue: params.venue,
      category: params.category,
      minPriceMinor: params.minPriceMinor,
      maxPriceMinor: params.maxPriceMinor,
      availability: params.availability,
    });
    return apiRequest<{ events: EventSummary[] }>(`/events${qs}`, {
      method: 'GET',
    });
  },

  async getBySlug(
    slug: string,
    params: Omit<EventsQueryParams, 'limit' | 'offset'> = {},
  ): Promise<{ event: EventDetail }> {
    const qs = buildQueryString({
      startsFrom: params.startsFrom,
      startsTo: params.startsTo,
      city: params.city,
      venue: params.venue,
      category: params.category,
      minPriceMinor: params.minPriceMinor,
      maxPriceMinor: params.maxPriceMinor,
      availability: params.availability,
    });
    return apiRequest<{ event: EventDetail }>(
      `/events/${encodeURIComponent(slug)}${qs}`,
      { method: 'GET' },
    );
  },

  getStreamUrl(eventId: string): string {
    return `${API_BASE_URL.replace(/\/+$/, '')}/events/${encodeURIComponent(eventId)}/stream`;
  },
};

export const authApi = {
  async register(input: {
    name: string;
    email: string;
    password: string;
    captchaToken?: string;
  }): Promise<{ user: User }> {
    return apiRequest<{ user: User }>('/auth/register', {
      method: 'POST',
      body: input,
      skipAuth: true,
    });
  },

  async login(input: {
    email: string;
    password: string;
    captchaToken?: string;
  }): Promise<LoginResponse> {
    return apiRequest<LoginResponse>('/auth/login', {
      method: 'POST',
      body: input,
      skipAuth: true,
    });
  },

  async me(): Promise<{ user: User }> {
    return apiRequest<{ user: User }>('/auth/me', {
      method: 'GET',
    });
  },

  async resendVerification(input: {
    email: string;
    captchaToken?: string;
  }): Promise<{ accepted: boolean }> {
    return apiRequest<{ accepted: boolean }>('/auth/email/resend', {
      method: 'POST',
      body: input,
      skipAuth: true,
    });
  },

  async verifyEmail(input: { token: string }): Promise<void> {
    await apiRequest<void>('/auth/email/verify', {
      method: 'POST',
      body: input,
      skipAuth: true,
    });
  },

  async forgotPassword(input: {
    email: string;
    captchaToken?: string;
  }): Promise<{ accepted: boolean }> {
    return apiRequest<{ accepted: boolean }>('/auth/password/forgot', {
      method: 'POST',
      body: input,
      skipAuth: true,
    });
  },

  async resetPassword(input: { token: string; password: string }): Promise<void> {
    await apiRequest<void>('/auth/password/reset', {
      method: 'POST',
      body: input,
      skipAuth: true,
    });
  },

  getGoogleAuthUrl(): string {
    return `${API_BASE_URL.replace(/\/+$/, '')}/auth/google`;
  },

  async linkGoogle(): Promise<{ authorizationUrl: string }> {
    return apiRequest<{ authorizationUrl: string }>('/auth/google/link', {
      method: 'POST',
    });
  },
};

export function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const reservationsApi = {
  async create(
    input: CreateReservationInput,
    idempotencyKey = generateIdempotencyKey(),
  ): Promise<{ reservation: ReservationItem }> {
    return apiRequest<{ reservation: ReservationItem }>('/reservations', {
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey,
      },
      body: input,
    });
  },

  async cancel(reservationId: string): Promise<void> {
    await apiRequest<void>(
      `/reservations/${encodeURIComponent(reservationId)}`,
      { method: 'DELETE' },
    );
  },

  async listMine(params: { limit?: number; offset?: number } = {}): Promise<{
    reservations: ReservationItem[];
  }> {
    const qs = buildQueryString({
      limit: params.limit,
      offset: params.offset,
    });
    return apiRequest<{ reservations: ReservationItem[] }>(`/reservations/me${qs}`, {
      method: 'GET',
    });
  },

  async checkout(
    reservationId: string,
    input: CheckoutInput,
    idempotencyKey = generateIdempotencyKey(),
  ): Promise<{ payment: CheckoutPayment }> {
    return apiRequest<{ payment: CheckoutPayment }>(
      `/reservations/${encodeURIComponent(reservationId)}/checkout`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: input,
      },
    );
  },

  async getPayment(
    reservationId: string,
    paymentId: string,
  ): Promise<{ payment: PaymentStatusInfo }> {
    return apiRequest<{ payment: PaymentStatusInfo }>(
      `/reservations/${encodeURIComponent(reservationId)}/payments/${encodeURIComponent(paymentId)}`,
      { method: 'GET' },
    );
  },

  async simulatePayment(reservationId: string, paymentId: string): Promise<void> {
    await apiRequest<void>(
      `/reservations/${encodeURIComponent(reservationId)}/payments/${encodeURIComponent(paymentId)}/simulate`,
      { method: 'POST' },
    );
  },

  async getReceipt(reservationId: string): Promise<{ receipt: ReservationReceipt }> {
    return apiRequest<{ receipt: ReservationReceipt }>(
      `/reservations/${encodeURIComponent(reservationId)}/receipt`,
      { method: 'GET' },
    );
  },
};

export const adminApi = {
  async overview(): Promise<AdminOverview> {
    return apiRequest<AdminOverview>('/admin/overview', {
      method: 'GET',
    });
  },

  async listEvents(params: {
    status?: EventStatus;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ events: AdminEvent[] }> {
    const qs = buildQueryString({
      status: params.status,
      limit: params.limit,
      offset: params.offset,
    });
    return apiRequest<{ events: AdminEvent[] }>(`/admin/events${qs}`, {
      method: 'GET',
    });
  },

  async getEvent(eventId: string): Promise<{ event: AdminEventDetail }> {
    return apiRequest<{ event: AdminEventDetail }>(
      `/admin/events/${encodeURIComponent(eventId)}`,
      { method: 'GET' },
    );
  },

  async createEvent(input: CreateAdminEventInput): Promise<{ event: AdminEvent }> {
    return apiRequest<{ event: AdminEvent }>('/admin/events', {
      method: 'POST',
      body: input,
    });
  },

  async updateEvent(
    eventId: string,
    input: UpdateAdminEventInput,
  ): Promise<{ event: AdminEvent }> {
    return apiRequest<{ event: AdminEvent }>(
      `/admin/events/${encodeURIComponent(eventId)}`,
      {
        method: 'PATCH',
        body: input,
      },
    );
  },

  async deleteEvent(eventId: string): Promise<void> {
    await apiRequest<void>(`/admin/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
    });
  },

  async uploadEventImage(
    eventId: string,
    kind: AdminEventImageKind,
    file: File,
  ): Promise<{ image: AdminImageUploadResult }> {
    try {
      return await apiRequest<{ image: AdminImageUploadResult }>(
        `/admin/events/${encodeURIComponent(eventId)}/images/${encodeURIComponent(kind)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': eventImageMediaType(file) ?? 'application/octet-stream' },
          body: file,
        },
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 413) {
        throw new ApiError(IMAGE_TOO_LARGE_MESSAGE, 413, 'IMAGE_TOO_LARGE');
      }
      throw error;
    }
  },

  async listSectors(eventId: string): Promise<{ sectors: AdminSector[] }> {
    return apiRequest<{ sectors: AdminSector[] }>(
      `/admin/events/${encodeURIComponent(eventId)}/sectors`,
      { method: 'GET' },
    );
  },

  async getSector(
    eventId: string,
    sectorId: string,
  ): Promise<{ sector: AdminSectorWithTables }> {
    return apiRequest<{ sector: AdminSectorWithTables }>(
      `/admin/events/${encodeURIComponent(eventId)}/sectors/${encodeURIComponent(sectorId)}`,
      { method: 'GET' },
    );
  },

  async createSector(
    eventId: string,
    input: CreateSectorInput,
  ): Promise<{ sector: AdminSector }> {
    return apiRequest<{ sector: AdminSector }>(
      `/admin/events/${encodeURIComponent(eventId)}/sectors`,
      {
        method: 'POST',
        body: input,
      },
    );
  },

  async updateSector(
    eventId: string,
    sectorId: string,
    input: UpdateSectorInput,
  ): Promise<{ sector: AdminSector }> {
    return apiRequest<{ sector: AdminSector }>(
      `/admin/events/${encodeURIComponent(eventId)}/sectors/${encodeURIComponent(sectorId)}`,
      {
        method: 'PATCH',
        body: input,
      },
    );
  },

  async deleteSector(eventId: string, sectorId: string): Promise<void> {
    await apiRequest<void>(
      `/admin/events/${encodeURIComponent(eventId)}/sectors/${encodeURIComponent(sectorId)}`,
      { method: 'DELETE' },
    );
  },

  async createTable(
    eventId: string,
    sectorId: string,
    input: CreateTableInput,
  ): Promise<{ table: AdminTable }> {
    return apiRequest<{ table: AdminTable }>(
      `/admin/events/${encodeURIComponent(eventId)}/sectors/${encodeURIComponent(sectorId)}/tables`,
      {
        method: 'POST',
        body: input,
      },
    );
  },

  async createTablesBatch(
    eventId: string,
    sectorId: string,
    input: BatchCreateTablesInput,
  ): Promise<{ tables: AdminTable[] }> {
    return apiRequest<{ tables: AdminTable[] }>(
      `/admin/events/${encodeURIComponent(eventId)}/sectors/${encodeURIComponent(sectorId)}/tables/batch`,
      {
        method: 'POST',
        body: input,
      },
    );
  },

  async updateTable(
    eventId: string,
    sectorId: string,
    tableId: string,
    input: UpdateTableInput,
  ): Promise<{ table: AdminTable }> {
    return apiRequest<{ table: AdminTable }>(
      `/admin/events/${encodeURIComponent(eventId)}/sectors/${encodeURIComponent(sectorId)}/tables/${encodeURIComponent(tableId)}`,
      {
        method: 'PATCH',
        body: input,
      },
    );
  },

  async deleteTable(
    eventId: string,
    sectorId: string,
    tableId: string,
  ): Promise<void> {
    await apiRequest<void>(
      `/admin/events/${encodeURIComponent(eventId)}/sectors/${encodeURIComponent(sectorId)}/tables/${encodeURIComponent(tableId)}`,
      { method: 'DELETE' },
    );
  },

  async updateLayout(
    eventId: string,
    input: UpdateEventLayoutInput,
  ): Promise<{ layout: AdminEventLayout }> {
    return apiRequest<{ layout: AdminEventLayout }>(
      `/admin/events/${encodeURIComponent(eventId)}/layout`,
      {
        method: 'PUT',
        body: input,
      },
    );
  },

  async getDashboard(
    eventId: string,
    params: { limit?: number; offset?: number } = {},
  ): Promise<{ dashboard: AdminEventDashboard }> {
    const qs = buildQueryString({
      limit: params.limit,
      offset: params.offset,
    });
    return apiRequest<{ dashboard: AdminEventDashboard }>(
      `/admin/events/${encodeURIComponent(eventId)}/dashboard${qs}`,
      { method: 'GET' },
    );
  },

  async checkIn(input: CheckInInput): Promise<{ checkIn: CheckInResult }> {
    return apiRequest<{ checkIn: CheckInResult }>('/admin/check-in', {
      method: 'POST',
      body: input,
    });
  },
};
