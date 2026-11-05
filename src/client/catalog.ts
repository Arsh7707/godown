"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { currentFirm, getJson, NetworkError } from "./api";

export interface CatalogParty {
  id: string;
  name: string;
  aliases: string[];
}
export interface CatalogItem extends CatalogParty {
  unit: string;
}
export interface Catalog {
  parties: CatalogParty[];
  items: CatalogItem[];
}

const EMPTY: Catalog = { parties: [], items: [] };
const noopSubscribe = () => () => {};

/** One saved copy per firm: firms have different clients (and maybe items). */
const key = () => `ob_catalog_v1:${currentFirm() ?? ""}`;

function cached(): Catalog | null {
  try {
    const raw = localStorage.getItem(key());
    return raw ? (JSON.parse(raw) as Catalog) : null;
  } catch {
    return null;
  }
}

/** Party and item lists for autocomplete. Uses the copy on the phone first, refreshes from the server. */
export function useCatalog() {
  // The phone's copy is used straight away (works offline).
  const [catalog, setCatalog] = useState<Catalog>(() => (typeof window === "undefined" ? null : cached()) ?? { parties: [], items: [] });

  useEffect(() => {
    getJson<Catalog>("/api/catalog")
      .then((r) => {
        if (!r.ok) return;
        const next = { parties: r.parties, items: r.items };
        setCatalog(next);
        try {
          localStorage.setItem(key(), JSON.stringify(next));
        } catch {}
      })
      .catch((e) => {
        if (!(e instanceof NetworkError)) throw e;
      });
  }, []);

  const addParty = useCallback((p: CatalogParty) => setCatalog((c) => ({ ...c, parties: [...c.parties, p] })), []);
  const addItem = useCallback((i: CatalogItem) => setCatalog((c) => ({ ...c, items: [...c.items, i] })), []);
  // While hydrating, render what the server rendered (no phone copy there), then switch to the phone's copy:
  // a form opened already filled in (dispatch from an order, edits) would otherwise mismatch.
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  return { catalog: hydrated ? catalog : EMPTY, addParty, addItem };
}
