export type Locale = "en-US" | "en-GB" | "es-ES" | "de-DE" | "fr-FR" | "vi-VN";

export type CartStatus = "active" | "abandoned" | "converted";

export type TrackingStatus =
  | "Label Created"
  | "Picked Up"
  | "In Transit"
  | "Delayed"
  | "Out for Delivery"
  | "Delivered";

export type ShipmentStatus = Exclude<TrackingStatus, "Label Created"> | "Label Created";

export type ReturnStatus = "pending" | "approved" | "rejected";

export interface AnomalyConfig {
  enabled: boolean;
  botCartRate: number;
  remoteShippingRate: number;
  contradictoryReturnRate: number;
}

export interface EcoFakerConfig {
  seed: number;
  locale: Locale;
  scaleFactor: number;
  historicalDays: number;
  cartsPerUser: { min: number; max: number };
  itemsPerCart: { min: number; max: number };
  abandonmentRate: number;
  abandonmentTimeoutHours: number;
  recoveryEmailRate: number;
  recoveryConversionRate: number;
  couponOfferRate: number;
  returnRate: number;
  delayProbability: number;
  maxDelayDays: number;
  multiPackageRate: number;
  missingAddressRate: number;
  taxRate: number;
  freeShippingThreshold: number;
  flatShippingCost: number;
  anomalies: AnomalyConfig;
}

export interface Address {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  locale: Locale;
  createdAt: string;
  address: Address;
}

export interface LineItem {
  productId: string;
  sku: string;
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface AnomalyTag {
  type: "bot_activity" | "remote_surcharge" | "contradictory_review";
  note: string;
}

export interface Cart {
  id: string;
  userId: string;
  status: CartStatus;
  items: LineItem[];
  createdAt: string;
  lastActivityDate: string;
  abandonmentTimeoutHours: number;
  currency: string;
  anomaly?: AnomalyTag;
}

export interface AbandonedCheckout {
  id: string;
  cartId: string;
  userId: string;
  exitTimestamp: string;
  recoveryEmailSent: boolean;
  recoveryEmailSentAt: string | null;
  couponCodeOffered: string | null;
  recovered: boolean;
}

export interface Order {
  id: string;
  cartId: string;
  userId: string;
  items: LineItem[];
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  currency: string;
  createdAt: string;
  shippingAddress: Address | null;
  status: "processing" | "shipped" | "delivered";
  anomaly?: AnomalyTag;
}

export interface TrackingEvent {
  status: TrackingStatus;
  timestamp: string;
  location: string;
}

export interface Shipment {
  id: string;
  orderId: string;
  trackingNumber: string;
  carrier: string;
  packageIndex: number;
  totalPackages: number;
  items: LineItem[];
  status: ShipmentStatus;
  delayed: boolean;
  events: TrackingEvent[];
}

export interface ReturnRequest {
  id: string;
  orderId: string;
  userId: string;
  reason: string;
  status: ReturnStatus;
  refundAmount: number;
  requestedAt: string;
  resolvedAt: string | null;
  csatScore?: number;
  anomaly?: AnomalyTag;
}

export interface Dataset {
  config: EcoFakerConfig;
  users: User[];
  carts: Cart[];
  abandonedCheckouts: AbandonedCheckout[];
  orders: Order[];
  shipments: Shipment[];
  returnRequests: ReturnRequest[];
}
