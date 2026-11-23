export type UserRole = 'CUSTOMER' | 'ADMIN';

export type DisplayMode = 'MAP' | 'LIST' | 'BOTH';

export type EventStatus = 'DRAFT' | 'PUBLISHED' | 'CLOSED';

export type TableAvailabilityStatus = 'AVAILABLE' | 'RESERVED' | 'SOLD';

export type ReservationStatus =
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'EXPIRED'
  | 'CANCELLED';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  emailVerifiedAt: string | null;
}

export interface ApiErrorPayload {
  code?: string;
  message?: string;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: User;
}

export interface EventSummary {
  id: string;
  slug: string;
  title: string;
  venue: string;
  city: string | null;
  category: string | null;
  currency: string;
  startsAt: string;
  endsAt: string;
  displayMode: DisplayMode;
  coverImageUrl: string | null;
  bannerImageUrl: string | null;
}

export interface EventTable {
  id: string;
  label: string;
  capacity: number;
  priceMinor: number;
  x: number | null;
  y: number | null;
  status: TableAvailabilityStatus;
  available: boolean;
  expiresAt: string | null;
}

export interface EventSector {
  id: string;
  name: string;
  description: string | null;
  basePriceMinor: number;
  tables: EventTable[];
}

export interface EventDetail extends EventSummary {
  description: string | null;
  floorPlanImageUrl: string | null;
  sectors: EventSector[];
}

export interface EventsQueryParams {
  limit?: number;
  offset?: number;
  startsFrom?: string;
  startsTo?: string;
  city?: string;
  venue?: string;
  category?: string;
  minPriceMinor?: number;
  maxPriceMinor?: number;
  availability?: TableAvailabilityStatus;
}

export interface ReservationEventInfo {
  slug: string;
  title: string;
  venue?: string | null;
  city?: string | null;
  startsAt: string;
}

export interface ReservationTableInfo {
  label: string;
  sector?: { name: string } | null;
}

export interface ReservationItem {
  id: string;
  tableId: string;
  eventId: string;
  guestCount: number;
  capacity: number;
  amountMinor: number;
  currency: string;
  status: ReservationStatus;
  expiresAt: string | null;
  /** Present in `GET /reservations/me`. */
  event?: ReservationEventInfo;
  /** Present in `GET /reservations/me`. */
  table?: ReservationTableInfo;
}

export type PaymentMethod = 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD';

export type PaymentStatus =
  | 'PENDING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'REFUND_REQUIRED';

export interface PayerIdentification {
  type: 'CPF' | 'CNPJ';
  number: string;
}

export type CheckoutInput =
  | { method: 'PIX'; identification?: PayerIdentification }
  | ({
      identification?: PayerIdentification;
      cardToken: string;
      paymentMethodId: string;
      issuerId?: string;
    } & ({ method: 'CREDIT_CARD'; installments: number } | { method: 'DEBIT_CARD'; installments: 1 }));

export interface CheckoutPayment {
  id: string;
  provider: string;
  providerPaymentId: string | null;
  method: PaymentMethod;
  status: PaymentStatus;
  amountMinor: number;
  currency: string;
  expiresAt: string;
  canSimulate?: boolean;
  pix?: {
    copyPasteCode: string;
    /** PNG Data URL */
    qrCode: string;
  };
}

export interface PaymentStatusInfo {
  id: string;
  method: PaymentMethod | null;
  status: PaymentStatus;
  amountMinor: number;
  currency: string;
  paidAt: string | null;
  canSimulate?: boolean;
}

export interface ReservationReceipt {
  reservationId: string;
  guestCount: number;
  confirmedAt: string | null;
  checkedInAt?: string | null;
  event: {
    id: string;
    title: string;
    venue: string;
    city?: string | null;
    startsAt: string;
  };
  table: { label: string; sector: { name: string } };
  payment: {
    id: string;
    amountMinor: number;
    currency: string;
    method: PaymentMethod | null;
    paidAt: string | null;
  };
  ticket: {
    /** QR text content */
    token: string;
    /** PNG Data URL */
    qrCode: string;
  };
}

export interface AdminOverview {
  events: number;
  reservations: number;
}

export interface AdminEvent extends EventSummary {
  description: string | null;
  status: EventStatus;
  floorPlanImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AdminEventImageKind = 'cover' | 'banner' | 'floor-plan';

export interface AdminImageUploadResult {
  kind: 'COVER' | 'BANNER' | 'FLOOR_PLAN';
  url: string;
  mediaType: string;
}

export interface AdminTable {
  id: string;
  eventId: string;
  sectorId: string;
  label: string;
  capacity: number;
  priceMinor: number;
  isEnabled: boolean;
  x: number | null;
  y: number | null;
}

export interface AdminSector {
  id: string;
  eventId: string;
  name: string;
  description: string | null;
  basePriceMinor: number;
}

export interface AdminSectorWithTables extends AdminSector {
  tables: AdminTable[];
}

export interface AdminEventDetail extends AdminEvent {
  sectors: AdminSectorWithTables[];
}

export interface CreateAdminEventInput {
  slug: string;
  title: string;
  description?: string | null;
  startsAt: string;
  endsAt: string;
  venue: string;
  city: string;
  category: string;
  status?: EventStatus;
  currency?: string;
  displayMode?: DisplayMode;
  coverImageUrl?: string | null;
  bannerImageUrl?: string | null;
  floorPlanImageUrl?: string | null;
}

export type UpdateAdminEventInput = Partial<CreateAdminEventInput>;

export interface CreateSectorInput {
  name: string;
  description?: string | null;
  basePriceMinor: number;
}

export type UpdateSectorInput = Partial<CreateSectorInput>;

export interface CreateTableInput {
  label: string;
  capacity: number;
  priceMinor?: number;
  isEnabled?: boolean;
}

export interface BatchCreateTablesInput {
  prefix?: string;
  startNumber: number;
  count: number;
  capacity: number;
  priceMinor?: number;
  isEnabled?: boolean;
}

export interface UpdateTableInput {
  label?: string;
  capacity?: number;
  priceMinor?: number;
  isEnabled?: boolean;
  sectorId?: string;
}

export type LayoutTableCoordinate =
  | { tableId: string; x: number; y: number }
  | { tableId: string; x: null; y: null };

export interface UpdateEventLayoutInput {
  floorPlanImageUrl?: string | null;
  tables: LayoutTableCoordinate[];
}

export interface AdminEventLayout {
  eventId: string;
  floorPlanImageUrl: string | null;
  tables: LayoutTableCoordinate[];
}

export interface AdminDashboardTotals {
  available: number;
  reserved: number;
  sold: number;
  disabled: number;
  checkedIn: number;
  /** Decimal integer string in minor currency units */
  confirmedRevenueMinor: string;
}

export type SettlementOperation = 'PIX' | 'DEBIT' | 'CREDIT' | 'ANTICIPATED_CREDIT';

export interface SettlementAmounts<Minor> {
  grossMinor: Minor;
  financialFeeMinor: Minor;
  convenienceFeeMinor: Minor;
  processingFeeMinor: Minor;
  netMinor: Minor;
}

export interface SettlementTotals extends SettlementAmounts<string> {
  paymentCount: number;
}

export interface PaymentSettlement extends SettlementAmounts<number> {
  paymentId: string;
  operation: SettlementOperation;
  financialFeeBps: number;
  convenienceFeeBps: number;
  processingFeeBps: number;
}

export interface AdminDashboardReservation {
  id: string;
  status: ReservationStatus;
  guestCount: number;
  amountMinor: number;
  createdAt: string;
  expiresAt: string;
  confirmedAt: string | null;
  checkedInAt: string | null;
  settlement: PaymentSettlement | null;
  table: {
    id: string;
    label: string;
  };
  buyer: {
    id: string;
    name: string;
    email: string;
  };
}

export interface AdminEventDashboard {
  eventId: string;
  asOf: string;
  currency: string;
  totals: AdminDashboardTotals;
  settlement: {
    totals: SettlementTotals;
    byOperation: Array<SettlementTotals & { operation: SettlementOperation }>;
    unclassifiedGrossMinor: string;
    unclassifiedPaymentCount: number;
    schedule: { timeZone: string; weeklyDates: string[]; finalDate: string };
  };
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
  reservations: AdminDashboardReservation[];
}

export interface CheckInInput {
  token: string;
  eventId?: string;
}

export interface CheckInResult {
  reservationId: string;
  eventId: string;
  tableId: string;
  guestCount: number;
  checkedInAt: string;
}

export interface SseTableState {
  tableId: string;
  status: TableAvailabilityStatus;
  available: boolean;
  expiresAt: string | null;
}

export interface SseSnapshotPayload {
  eventId: string;
  tables: SseTableState[];
}

export interface SseTableUpdatePayload extends SseTableState {
  eventId: string;
}

export interface CreateReservationInput {
  eventId: string;
  tableId: string;
  guestCount: number;
}
