/**
 * Order Book schema.
 *
 * Ledger tables are append-only. An entity (order, dispatch) has a stable
 * header row plus numbered revisions; the highest revision is current.
 * Corrections and cancellations insert a new revision and never update or
 * delete earlier rows. Balances are computed from the current revisions and
 * allocations, never stored.
 *
 * Every table carries company_id.
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  date,
  integer,
  numeric,
  boolean,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["owner", "staff", "viewer"]);
export const languageEnum = pgEnum("language", ["hi", "en"]);
export const channelEnum = pgEnum("channel", ["app", "whatsapp"]);
export const inputMethodEnum = pgEnum("input_method", ["photo", "voice", "text", "form"]);
export const orderStatusEnum = pgEnum("order_status", ["open", "cancelled"]);
export const dispatchStatusEnum = pgEnum("dispatch_status", ["active", "cancelled"]);
export const attachmentKindEnum = pgEnum("attachment_kind", ["slip_photo", "voice_note", "parcel_photo"]);

const id = () => uuid("id").primaryKey().defaultRandom();
const companyId = () =>
  uuid("company_id")
    .notNull()
    .references(() => companies.id);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const createdBy = () =>
  uuid("created_by")
    .notNull()
    .references(() => users.id);
/** Quantities: up to 2 decimal places (meters of cloth), handled as integer hundredths in code. */
const quantity = () => numeric("quantity", { precision: 12, scale: 2 }).notNull();

// ---------------------------------------------------------------- tenants & users

export const companies = pgTable("companies", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    companyId: companyId(),
    /** E.164, e.g. +919812345678. The phone number is the identity. */
    phone: text("phone").notNull(),
    name: text("name").notNull(),
    role: roleEnum("role").notNull(),
    language: languageEnum("language").notNull().default("hi"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_company_phone_uq").on(t.companyId, t.phone), index("users_phone_idx").on(t.phone)],
);

// ---------------------------------------------------------------- master data

export const parties = pgTable(
  "parties",
  {
    id: id(),
    companyId: companyId(),
    name: text("name").notNull(),
    phone: text("phone"),
    active: boolean("active").notNull().default(true),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [index("parties_company_idx").on(t.companyId)],
);

export const partyAliases = pgTable(
  "party_aliases",
  {
    id: id(),
    companyId: companyId(),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id),
    alias: text("alias").notNull(),
    normalized: text("normalized").notNull(),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("party_aliases_company_norm_uq").on(t.companyId, t.normalized)],
);

export const items = pgTable(
  "items",
  {
    id: id(),
    companyId: companyId(),
    name: text("name").notNull(),
    /** One unit per item: pcs, meter, thaan, kg, ... */
    unit: text("unit").notNull(),
    /** Colours/sizes: each variant is its own item ("Vistara · Red") grouped by product ("Vistara"). */
    product: text("product"),
    variant: text("variant"),
    /** Low-stock alert when FREE stock (in stock − owed to pending orders) drops to this. */
    lowStockLevel: numeric("low_stock_level", { precision: 12, scale: 2 }).notNull().default("10"),
    active: boolean("active").notNull().default(true),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [index("items_company_idx").on(t.companyId)],
);

export const itemAliases = pgTable(
  "item_aliases",
  {
    id: id(),
    companyId: companyId(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    alias: text("alias").notNull(),
    normalized: text("normalized").notNull(),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("item_aliases_company_norm_uq").on(t.companyId, t.normalized)],
);

// ---------------------------------------------------------------- attachments

export const attachments = pgTable(
  "attachments",
  {
    id: id(),
    companyId: companyId(),
    /** Client-generated id per capture; makes uploads idempotent. */
    captureId: text("capture_id").notNull(),
    kind: attachmentKindEnum("kind").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("attachments_company_capture_kind_uq").on(t.companyId, t.captureId, t.kind)],
);

// ---------------------------------------------------------------- orders

export const orders = pgTable(
  "orders",
  {
    id: id(),
    companyId: companyId(),
    /** Client-generated capture id or WhatsApp message id. */
    captureId: text("capture_id").notNull(),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("orders_company_capture_uq").on(t.companyId, t.captureId)],
);

export const orderRevisions = pgTable(
  "order_revisions",
  {
    id: id(),
    companyId: companyId(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    rev: integer("rev").notNull(),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id),
    orderDate: date("order_date").notNull(),
    promisedDate: date("promised_date"),
    notes: text("notes"),
    status: orderStatusEnum("status").notNull(),
    channel: channelEnum("channel").notNull(),
    inputMethod: inputMethodEnum("input_method").notNull(),
    sourceAttachmentId: uuid("source_attachment_id").references(() => attachments.id),
    sourceText: text("source_text"),
    /** Why this revision exists (correction note, cancellation reason). */
    reason: text("reason"),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("order_revisions_order_rev_uq").on(t.orderId, t.rev),
    index("order_revisions_company_party_idx").on(t.companyId, t.partyId),
  ],
);

/** Stable identity of an order line across revisions; dispatches allocate against it. */
export const orderLines = pgTable(
  "order_lines",
  {
    id: id(),
    companyId: companyId(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    lineNo: integer("line_no").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("order_lines_order_line_no_uq").on(t.orderId, t.lineNo)],
);

/** Snapshot of each line as of one order revision. A line absent from the current snapshot is removed. */
export const orderLineVersions = pgTable(
  "order_line_versions",
  {
    id: id(),
    companyId: companyId(),
    orderRevisionId: uuid("order_revision_id")
      .notNull()
      .references(() => orderRevisions.id),
    orderLineId: uuid("order_line_id")
      .notNull()
      .references(() => orderLines.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    quantity: quantity(),
    /** Packing unit as said (nag, dabba, bora…); null = the item's own unit. No conversion. */
    unit: text("unit"),
  },
  (t) => [uniqueIndex("order_line_versions_rev_line_uq").on(t.orderRevisionId, t.orderLineId)],
);

// ---------------------------------------------------------------- dispatches

export const dispatches = pgTable(
  "dispatches",
  {
    id: id(),
    companyId: companyId(),
    captureId: text("capture_id").notNull(),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("dispatches_company_capture_uq").on(t.companyId, t.captureId)],
);

export const dispatchRevisions = pgTable(
  "dispatch_revisions",
  {
    id: id(),
    companyId: companyId(),
    dispatchId: uuid("dispatch_id")
      .notNull()
      .references(() => dispatches.id),
    rev: integer("rev").notNull(),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id),
    dispatchDate: date("dispatch_date").notNull(),
    takenBy: text("taken_by"),
    transport: text("transport"),
    lrNumber: text("lr_number"),
    parcelPhotoId: uuid("parcel_photo_id").references(() => attachments.id),
    notes: text("notes"),
    status: dispatchStatusEnum("status").notNull(),
    channel: channelEnum("channel").notNull(),
    inputMethod: inputMethodEnum("input_method").notNull(),
    sourceAttachmentId: uuid("source_attachment_id").references(() => attachments.id),
    sourceText: text("source_text"),
    reason: text("reason"),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("dispatch_revisions_dispatch_rev_uq").on(t.dispatchId, t.rev),
    index("dispatch_revisions_company_party_idx").on(t.companyId, t.partyId),
  ],
);

/** Lines belong to one dispatch revision. A correction writes a new revision with new lines. */
export const dispatchLines = pgTable(
  "dispatch_lines",
  {
    id: id(),
    companyId: companyId(),
    dispatchRevisionId: uuid("dispatch_revision_id")
      .notNull()
      .references(() => dispatchRevisions.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    quantity: quantity(),
    /** Packing unit as said; null = the item's own unit. Allocated only to order lines in the same unit. */
    unit: text("unit"),
  },
  (t) => [index("dispatch_lines_revision_idx").on(t.dispatchRevisionId)],
);

/**
 * Quantity of a dispatch line applied to an order line. Only allocations on
 * the current, active revision of a dispatch count. Whatever part of a
 * dispatch line is not allocated is "unmatched".
 */
export const allocations = pgTable(
  "allocations",
  {
    id: id(),
    companyId: companyId(),
    dispatchLineId: uuid("dispatch_line_id")
      .notNull()
      .references(() => dispatchLines.id),
    orderLineId: uuid("order_line_id")
      .notNull()
      .references(() => orderLines.id),
    quantity: quantity(),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [index("allocations_dispatch_line_idx").on(t.dispatchLineId), index("allocations_order_line_idx").on(t.orderLineId)],
);

// ---------------------------------------------------------------- audit

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    companyId: companyId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** e.g. order.create, order.correct, order.cancel, dispatch.create, party.update */
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    details: jsonb("details").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_company_created_idx").on(t.companyId, t.createdAt)],
);

// ---------------------------------------------------------------- auth

/** One-time login codes. Codes are stored hashed. */
export const otpChallenges = pgTable(
  "otp_challenges",
  {
    id: id(),
    phone: text("phone").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("otp_challenges_phone_created_idx").on(t.phone, t.createdAt)],
);

/** Logged-in devices. The cookie holds a random token; only its hash is stored. */
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    companyId: companyId(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sessions_token_hash_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------- captures & AI usage

export const captureKindEnum = pgEnum("capture_kind", ["order", "dispatch", "stock"]);
export const captureStatusEnum = pgEnum("capture_status", ["extracted", "failed", "confirmed", "discarded"]);

/**
 * One photo / voice note / typed message sent for reading, keyed by the
 * client's capture id. Makes extraction idempotent (a retry returns the
 * stored result instead of paying for the AI again) and keeps what was
 * captured even when reading fails.
 */
export const captures = pgTable(
  "captures",
  {
    id: id(),
    companyId: companyId(),
    captureId: text("capture_id").notNull(),
    kind: captureKindEnum("kind").notNull(),
    channel: channelEnum("channel").notNull(),
    inputMethod: inputMethodEnum("input_method").notNull(),
    text: text("text"),
    imageAttachmentId: uuid("image_attachment_id").references(() => attachments.id),
    audioAttachmentId: uuid("audio_attachment_id").references(() => attachments.id),
    status: captureStatusEnum("status").notNull(),
    /** The ExtractionResult shown to the user. */
    result: jsonb("result"),
    createdBy: createdBy(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("captures_company_capture_uq").on(t.companyId, t.captureId)],
);

/** What each company's AI and speech-to-text calls cost, for pricing and limits. */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: id(),
    companyId: companyId(),
    userId: uuid("user_id").references(() => users.id),
    captureId: text("capture_id"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    audioSeconds: numeric("audio_seconds", { precision: 10, scale: 2 }),
    /** Estimated cost in millionths of a US dollar. */
    costMicroUsd: integer("cost_micro_usd").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_company_created_idx").on(t.companyId, t.createdAt)],
);

// ---------------------------------------------------------------- stock

export const stockKindEnum = pgEnum("stock_kind", ["receipt", "count", "adjustment", "reversal"]);

/**
 * Append-only stock movements. In stock = sum(quantity) − dispatched (from the
 * dispatch ledger). A count stores what was counted and the difference it
 * made; a reversal undoes an earlier movement. Lines entered together share a
 * batch id.
 */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: id(),
    companyId: companyId(),
    batchId: uuid("batch_id").notNull(),
    /** Client id per line; makes saving idempotent. */
    captureId: text("capture_id").notNull(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    kind: stockKindEnum("kind").notNull(),
    /** Signed change to stock. */
    quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
    /** Packing unit; null = the item's own unit. Stock is counted per unit. */
    unit: text("unit"),
    /** For counts: the number counted. */
    counted: numeric("counted", { precision: 12, scale: 2 }),
    entryDate: date("entry_date").notNull(),
    reason: text("reason"),
    reversesId: uuid("reverses_id"),
    channel: channelEnum("channel").notNull(),
    inputMethod: inputMethodEnum("input_method").notNull(),
    sourceAttachmentId: uuid("source_attachment_id").references(() => attachments.id),
    sourceText: text("source_text"),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("stock_movements_company_capture_uq").on(t.companyId, t.captureId),
    index("stock_movements_company_item_idx").on(t.companyId, t.itemId),
    index("stock_movements_batch_idx").on(t.batchId),
  ],
);

/** A phone that agreed to get reminders (Web Push). One row per browser/install. */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    companyId: companyId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint_uq").on(t.endpoint), index("push_subscriptions_user_idx").on(t.userId)],
);

/** Last known low/OK state per item and unit, so a low-stock alert fires once when it crosses, not on every save. */
export const stockAlertState = pgTable(
  "stock_alert_state",
  {
    companyId: companyId(),
    /** unitKey(itemId, unit) */
    key: text("key").notNull(),
    low: boolean("low").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("stock_alert_state_company_key_uq").on(t.companyId, t.key)],
);
