import { describe, it, expect } from "vitest";
import { EXTENSION, FILE_TYPES, baseName } from "../src/app/file";

describe("file extension", () => {
  it("saves as .dln", () => {
    expect(EXTENSION).toBe(".dln");
    expect(FILE_TYPES[0]!.accept["application/json"]![0]).toBe(".dln");
  });

  it("opens only .dln", () => {
    expect(FILE_TYPES[0]!.accept["application/json"]).toEqual([".dln"]);
  });

  it("shows a file's name without its extension", () => {
    expect(baseName("bench.dln")).toBe("bench");
    expect(baseName("old bench.delinya")).toBe("old bench.delinya");
    expect(baseName("BENCH.DLN")).toBe("BENCH");
    expect(baseName("export.json")).toBe("export.json");
    expect(baseName("notes.txt")).toBe("notes.txt");
    expect(baseName(".dln")).toBe("Untitled");
  });
});
