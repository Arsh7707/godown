export type LedgerErrorCode =
  | "INVALID_QTY"
  | "INVALID_DATE"
  | "FUTURE_DATE"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "UNKNOWN_PARTY"
  | "UNKNOWN_ITEM"
  | "NO_LINES"
  | "STALE_REVISION"
  | "ALREADY_CANCELLED"
  | "BELOW_DISPATCHED"
  | "LINE_HAS_DISPATCHES"
  | "PARTY_HAS_DISPATCHES"
  | "LINK_MISMATCH"
  | "LINK_EXCEEDS"
  | "NOT_OWN_ENTRY"
  | "DUPLICATE_NAME"
  | "ALIAS_TAKEN"
  | "NAME_REQUIRED"
  | "IN_USE"
  | "UNIT_LOCKED"
  | "INVALID_UNIT"
  | "EDIT_WINDOW_CLOSED"
  | "INVALID_STATE"
  | "INVALID_PHONE"
  | "DUPLICATE_PHONE"
  | "LAST_OWNER"
  | "SELF_CHANGE"
  | "INVALID_GSTIN"
  | "INVALID_AADHAAR"
  | "TAX_ID_TAKEN";

/** Expected, user-facing rule violations. `details` carries numbers for the UI to localise. */
export class LedgerError extends Error {
  constructor(
    public code: LedgerErrorCode,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "LedgerError";
  }
}
