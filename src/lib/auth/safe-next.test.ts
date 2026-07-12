import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("accepts same-app relative paths", () => {
    expect(safeNext("/dashboard")).toBe("/dashboard");
    expect(safeNext("/invite/abc?x=1")).toBe("/invite/abc?x=1");
  });

  it("accepts a path with a doubled internal slash", () => {
    expect(safeNext("/legit//x")).toBe("/legit//x");
  });

  it("rejects protocol-relative URLs", () => {
    expect(safeNext("//evil.com")).toBeNull();
  });

  it("rejects absolute URLs", () => {
    expect(safeNext("https://evil.com")).toBeNull();
  });

  it("rejects backslash variants that browsers normalize into an authority", () => {
    expect(safeNext("/\\evil.com")).toBeNull();
    expect(safeNext("/\\\\evil.com")).toBeNull();
    expect(safeNext("\\evil.com")).toBeNull();
  });

  it("rejects ASCII control characters that the URL parser strips", () => {
    expect(safeNext("/\t/evil.com")).toBeNull();
    expect(safeNext("/\n/evil.com")).toBeNull();
    expect(safeNext("/\r/evil.com")).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(safeNext("")).toBeNull();
  });

  it("rejects null and undefined", () => {
    expect(safeNext(null)).toBeNull();
    expect(safeNext(undefined)).toBeNull();
  });

  it("rejects a File-like non-string value", () => {
    expect(safeNext(new File(["x"], "x.txt"))).toBeNull();
  });
});
