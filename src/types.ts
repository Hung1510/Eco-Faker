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
  /** How many products to generate in the shared catalog that carts/orders draw line items from. */
  catalogSize: number;
  recommendationData: { enabled: boolean };
  inventorySimulation: { enabled: boolean };
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

export interface FraudTag {
  fraudType:
    | "stolen_card"
    | "account_farming"
    | "reseller_behavior"
    | "refund_abuse"
    | "friendly_chargeback"
    | "coupon_abuse_ring";
  riskScore: number; // 0-100
  signals: string[];
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
  totalFormatted: string;
  currency: string;
  createdAt: string;
  shippingAddress: Address | null;
  status: "processing" | "shipped" | "delivered";
  anomaly?: AnomalyTag;
  fraud?: FraudTag;
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
  refundAmountFormatted: string;
  requestedAt: string;
  resolvedAt: string | null;
  csatScore?: number;
  anomaly?: AnomalyTag;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  /** Null for a top-level category; set for a subcategory (e.g. "Laptops" under "Electronics"). One level of nesting -- not a full arbitrary-depth tree. */
  parentCategoryId: string | null;
}

export interface Brand {
  id: string;
  name: string;
}

export interface Supplier {
  id: string;
  name: string;
  country: string;
  leadTimeDays: number;
}

export interface ProductVariant {
  id: string;
  sku: string;
  /** e.g. { storage: "512GB", color: "Space Gray" } -- shape varies per product, deliberately untyped. */
  attributes: Record<string, string>;
  /** Added to the parent product's basePrice -- 0 for a variant with no price difference. */
  priceDelta: number;
  stockLevel: number;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  brandId: string;
  supplierId: string;
  basePrice: number;
  currency: string;
  variants: ProductVariant[];
}

export interface ProductView {
  id: string;
  userId: string;
  productId: string;
  timestamp: string;
  source: "search" | "category_browse" | "recommendation" | "direct";
}

export interface SearchQuery {
  id: string;
  userId: string;
  query: string;
  timestamp: string;
  resultCount: number;
  /** Null if the search didn't lead to a click -- most searches don't. */
  clickedProductId: string | null;
}

export interface WishlistItem {
  id: string;
  userId: string;
  productId: string;
  addedAt: string;
}

export interface ProductRating {
  id: string;
  userId: string;
  productId: string;
  /** Ratings only exist for products the user actually bought -- traced back to a real delivered order. */
  orderId: string;
  rating: number;
  reviewText: string | null;
  createdAt: string;
}

export interface Warehouse {
  id: string;
  name: string;
  country: string;
}

export interface ReplenishmentOrder {
  id: string;
  productId: string;
  supplierId: string;
  warehouseId: string;
  quantityOrdered: number;
  orderedAt: string;
  /** orderedAt + supplier.leadTimeDays -- grounded in the same field used for the supplier itself. */
  expectedDeliveryAt: string;
  /** Null while still in transit or delayed. */
  receivedAt: string | null;
  status: "ordered" | "in_transit" | "received" | "delayed";
}

export interface StockoutPeriod {
  id: string;
  productId: string;
  /** Null if the stockout applied to the base product rather than a specific variant. */
  variantId: string | null;
  warehouseId: string;
  startedAt: string;
  /** Null if the stockout is still ongoing as of generation time. */
  endedAt: string | null;
  /** The replenishment order that resupplied stock and ended this stockout, if any. */
  resolvedByReplenishmentId: string | null;
}

export interface WarehouseTransfer {
  id: string;
  productId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  quantity: number;
  initiatedAt: string;
  /** Null if still in transit. */
  completedAt: string | null;
}

export interface Dataset {
  config: EcoFakerConfig;
  categories: Category[];
  brands: Brand[];
  suppliers: Supplier[];
  products: Product[];
  users: User[];
  carts: Cart[];
  abandonedCheckouts: AbandonedCheckout[];
  orders: Order[];
  shipments: Shipment[];
  returnRequests: ReturnRequest[];
  productViews: ProductView[];
  searchQueries: SearchQuery[];
  wishlistItems: WishlistItem[];
  productRatings: ProductRating[];
  warehouses: Warehouse[];
  replenishmentOrders: ReplenishmentOrder[];
  stockoutPeriods: StockoutPeriod[];
  warehouseTransfers: WarehouseTransfer[];
}
