import { describe, expect, it } from "vitest";
import { gurmukhiToDevanagari } from "@/lib/script";

describe("Gurmukhi → Devanagari", () => {
  it("converts letters and vowel signs", () => {
    expect(gurmukhiToDevanagari("ਸਤਨਾਮ")).toBe("सतनाम");
    expect(gurmukhiToDevanagari("ਬੇਟਾ ਆਰਡਰ")).toBe("बेटा आरडर");
    expect(gurmukhiToDevanagari("ਸਰਫਰਾਜ਼")).toBe("सरफराज़");
    expect(gurmukhiToDevanagari("ਵਿਸਤਾਰਾ ਦੇ")).toBe("विसतारा दे");
    // "sh" arrives either precomposed or as ਸ + nukta; both become श
    expect(gurmukhiToDevanagari("\u0A36\u0A3E\u0A2E")).toBe("शाम");
    expect(gurmukhiToDevanagari("\u0A38\u0A3C\u0A3E\u0A2E")).toBe("शाम");
  });
  it("handles Gurmukhi-only signs", () => {
    expect(gurmukhiToDevanagari("ਸਿੰਘ")).toBe("सिंघ"); // tippi
    expect(gurmukhiToDevanagari("ਪੱਕਾ")).toBe("पक्का"); // addak doubles
    expect(gurmukhiToDevanagari("ਕੱਲ੍ਹ")).toBe("कल्ल्ह");
    expect(gurmukhiToDevanagari("ਉਹ ਇੱਕ ਓਹਦੇ")).toBe("उह इक्क ओहदे");
    expect(gurmukhiToDevanagari("ੳੁ ੲਿ")).toBe("उ इ"); // bearer + vowel sign
  });
  it("turns digits into 0-9 and leaves other text alone", () => {
    expect(gurmukhiToDevanagari("੩ ਬੋਰੇ, ₹1070")).toBe("3 बोरे, ₹1070");
    expect(gurmukhiToDevanagari("Sharma ko 5 piece")).toBe("Sharma ko 5 piece");
    expect(gurmukhiToDevanagari("शर्मा जी")).toBe("शर्मा जी");
  });
  it("converts dad's note 3 readably", () => {
    expect(gurmukhiToDevanagari("ਉਹਦੇ ਹੈਗੇ ਨੇ 3 ਬੋਰੇ ਮੋਰੀਕੋ ਦੇ, 3 ਬੋਰੇ ਫੇਮਸ ਦੇ ਤੇ 4 ਬੋਰੇ ਵਿਸਤਾਰਾ ਦੇ।")).toBe(
      "उहदे हैगे ने 3 बोरे मोरीको दे, 3 बोरे फेमस दे ते 4 बोरे विसतारा दे।",
    );
  });
});

describe("Punjabi shown in Hindi script across the app", async () => {
  const { matchMention } = await import("@/extraction/matcher");
  const items = [{ id: "i-s", name: "Sarfaraz (Thakurdwara)", aliases: ["ਸਰਫਰਾਜ਼"] }];
  it("a Gurmukhi alias still matches the same name written in Hindi letters, and vice versa", () => {
    expect(matchMention({ asWritten: "सरफराज़" }, items)).toMatchObject({ status: "matched", id: "i-s" });
    expect(matchMention({ asWritten: "ਸਰਫਰਾਜ਼" }, items)).toMatchObject({ status: "matched", id: "i-s", mention: "सरफराज़" });
  });
  it("unclear names are shown in Hindi letters", () => {
    expect(matchMention({ asWritten: "ਵੀਸ ਵਰਸ਼ਨ" }, items).mention).toBe("वीस वरशन");
  });
});
