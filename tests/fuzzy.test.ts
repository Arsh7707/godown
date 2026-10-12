import { describe, expect, it } from "vitest";
import { matchMention, type CatalogEntry } from "@/extraction/matcher";
import { phoneticKey, toLatin } from "@/lib/translit";

const parties: CatalogEntry[] = [
  { id: "veer", name: "Veer Sudarshan Brothers", aliases: [] },
  { id: "sarf", name: "Sarfaraz (Thakurdwara)", aliases: [] },
  { id: "sharma-tex", name: "Sharma Textiles", aliases: [] },
  { id: "sharma-tr", name: "Sharma Traders", aliases: [] },
  { id: "gupta", name: "Gupta Traders", aliases: ["गुप्ता जी"] },
  { id: "karan", name: "Karan & Co", aliases: [] },
];
const items: CatalogEntry[] = ["Crown", "Morico", "Famous", "Vistara", "Art Life", "Novella"].map((n) => ({ id: n.toLowerCase(), name: n, aliases: [], unit: "pcs" }));

const top = (mention: string, cat: CatalogEntry[], latin?: string) => matchMention({ asWritten: mention, latin }, cat);
const firstId = (mention: string, cat: CatalogEntry[], latin?: string) => top(mention, cat, latin).candidates[0]?.id;

describe("sounds-alike key", () => {
  it("folds Hindi, Punjabi and English spellings of the same name together", () => {
    const same = (xs: string[]) => expect(new Set(xs.map((x) => phoneticKey(x).replace(/ /g, ""))).size).toBe(1);
    same(["शर्मा", "Sharma", "Sharmaa", "sarma"]);
    same(["विस्तारा", "Vistara", "Vistaraa", "Wistara"]);
    same(["नोवेला", "Novella", "Novela"]);
    same(["मोरिको", "Morico", "Moriko"]);
    same(["आर्ट लाइफ", "Art Life", "Art Lyf"]);
    same(["क्राउन", "Crown", "Kraun"]);
    same(["सरफ़राज़", "Sarfaraz", "Sarfraz"]);
    same(["वीर", "Veer", "Vir", "ਵੀਰ"]);
  });

  it("transliterates Devanagari with the usual short-a rules", () => {
    expect(toLatin("राम")).toBe("raam");
    expect(toLatin("कमल")).toBe("kamal");
    expect(toLatin("सुदर्शन")).toBe("sudarshan");
    expect(toLatin("D-4012 पीस")).toBe("D-4012 piis");
  });
});

describe("closest match", () => {
  it("spelling mistakes still find the right one, as a suggestion (never auto-picked)", () => {
    const expected: Record<string, string> = { Vistaraa: "vistara", Vistra: "vistara", Novela: "novella", Moriko: "morico", Famus: "famous", Crwn: "crown", "Art Lyf": "art life", Noveela: "novella" };
    for (const [m, id] of Object.entries(expected)) {
      const r = top(m, items);
      expect(r.status, m).toBe("choose");
      expect(r.candidates[0]?.id, m).toBe(id);
    }
  });

  it("Hindi letters find English names and the other way round, without the model's help", () => {
    expect(firstId("विस्तारा", items)).toBe("vistara");
    expect(firstId("फेमस", items)).toBe("famous");
    expect(firstId("क्राउन", items)).toBe("crown");
    expect(firstId("आर्ट लाइफ", items)).toBe("art life");
    expect(firstId("वीर सुदर्शन ब्रदर्स", parties)).toBe("veer");
    expect(firstId("ਵੀਰ ਸੁਦਰਸ਼ਨ ਬ੍ਰਦਰਸ", parties)).toBe("veer"); // Punjabi letters
    expect(firstId("Gupta", parties)).toBe("gupta"); // Roman mention, Devanagari alias "गुप्ता जी"
  });

  it("Hinglish spellings and short forms", () => {
    expect(firstId("Vir Sudershan Bros", parties)).toBe("veer");
    expect(firstId("veer sudarshan", parties)).toBe("veer");
    expect(firstId("Sarfraz Thakurdwara wale", parties)).toBe("sarf");
    // "&" / "and" and "Co" / "Company" are the same written name, not a guess.
    expect(top("Karan and Company", parties)).toMatchObject({ status: "matched", id: "karan" });
    expect(firstId("Karan Co.", parties)).toBe("karan");
  });

  it("an exact name or extra name (any script, any word order) is picked automatically", () => {
    expect(top("veer sudarshan brothers", parties)).toMatchObject({ status: "matched", id: "veer" });
    expect(top("गुप्ता जी", parties)).toMatchObject({ status: "matched", id: "gupta" });
    expect(top("M/s Sharma Textiles", parties)).toMatchObject({ status: "matched", id: "sharma-tex" });
  });

  it("sounding the same is a strong suggestion, but not an automatic pick", () => {
    const r = top("शर्मा टेक्सटाइल्स", parties);
    expect(r.status).toBe("choose");
    expect(r.candidates[0]).toMatchObject({ id: "sharma-tex" });
    expect(r.candidates[0].score).toBeGreaterThanOrEqual(0.9);
  });

  it("two equally close names: both offered, none picked", () => {
    const r = top("Sharma", parties);
    expect(r.status).toBe("choose");
    expect(r.candidates.map((c) => c.id).sort()).toEqual(["sharma-tex", "sharma-tr"]);
  });

  it("unrelated names are not suggested", () => {
    expect(top("Lakshmi Saree Centre", parties).candidates).toEqual([]);
    expect(top("Bombay Dyeing", items).candidates).toEqual([]);
    expect(top("Crown", items).candidates.map((c) => c.id)).toEqual(["crown"]);
  });

  it("empty, honorific-only and punctuation-only mentions are 'missing'", () => {
    expect(top("", parties).status).toBe("missing");
    expect(top("ji", parties).status).toBe("missing");
    expect(top("...", parties).status).toBe("missing");
  });

  it("design numbers still match by digits", () => {
    const designs: CatalogEntry[] = [{ id: "d", name: "D-4012", aliases: [] }];
    expect(firstId("4012", designs)).toBe("d");
    expect(firstId("चार हज़ार बारह", designs)).toBeUndefined();
  });
});
