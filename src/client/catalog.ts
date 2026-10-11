"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson, NetworkError } from "./api";

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

const KEY = "ob_catalog_v1";

function cached(): Catalog | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Catalog) : null;
  } catch {
    return null;
  }
}

/** Party and item lists for autocomplete. Uses the copy on the phone first, refreshes from the server. */
export function useCatalog() {
  // The phone's copy is used straight away (works offline); nothing in the first server render depends on it.
  const [catalog, setCatalog] = useState<Catalog>(() => (typeof window === "undefined" ? null : cached()) ?? { parties: [], items: [] });

  useEffect(() => {
    getJson<Catalog>("/api/catalog")
      .then((r) => {
        if (!r.ok) return;
        const next = { parties: r.parties, items: r.items };
        setCatalog(next);
        try {
          localStorage.setItem(KEY, JSON.stringify(next));
        } catch {}
      })
      .catch((e) => {
        if (!(e instanceof NetworkError)) throw e;
      });
  }, []);

  const addParty = useCallback((p: CatalogParty) => setCatalog((c) => ({ ...c, parties: [...c.parties, p] })), []);
  const addItem = useCallback((i: CatalogItem) => setCatalog((c) => ({ ...c, items: [...c.items, i] })), []);
  return { catalog, addParty, addItem };
}
