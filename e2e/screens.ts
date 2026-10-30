/** Every screen of the app, and who may open it (all roles when `only` is missing). */
import type { Seed } from "./fixtures";
import type { RoleName } from "./env";

export type Screen = { path: (s: Seed) => string; only?: RoleName[] };

export const SCREENS: Screen[] = [
  { path: () => "/" },
  { path: () => "/order/new", only: ["owner", "staff"] },
  { path: () => "/dispatch/new", only: ["owner", "staff"] },
  { path: () => "/orders" },
  { path: (s) => `/orders?item=${s.d4012}` },
  { path: () => "/pending" },
  { path: (s) => `/pending/party/${s.sharma}` },
  { path: () => "/dispatches" },
  { path: (s) => `/dispatches/${s.dispatchId}` },
  { path: (s) => `/orders/${s.orderId}` },
  { path: () => "/stock" },
  { path: (s) => `/stock/item/${s.d4012}` },
  { path: () => "/stock/in", only: ["owner", "staff"] },
  { path: () => "/stock/new-product", only: ["owner"] },
  { path: () => "/unmatched" },
  { path: () => "/history" },
  { path: () => "/inbox" },
  { path: () => "/firms" },
  { path: () => "/reports", only: ["owner", "viewer"] },
  { path: () => "/activity", only: ["owner"] },
  { path: () => "/manage", only: ["owner"] },
  { path: () => "/manage/clients", only: ["owner"] },
  { path: (s) => `/manage/clients/${s.sharma}`, only: ["owner"] },
  { path: () => "/manage/items", only: ["owner"] },
  { path: (s) => `/manage/items/${s.d4012}`, only: ["owner"] },
  { path: () => "/manage/team", only: ["owner"] },
  { path: () => "/manage/company", only: ["owner"] },
  { path: () => "/manage/import", only: ["owner"] },
];
