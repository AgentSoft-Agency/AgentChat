import { describe, it, expect } from "vitest";
import { buildAllowOpts, formatStatusLine, chooseLaunch, formatAllowEntryLabel } from "../../src/cli/menu-actions.js";

describe("buildAllowOpts", () => {
  it("omits blank label, blank language, and the default confirm choice", () => {
    expect(buildAllowOpts({ label: "  ", confirmChoice: "default", language: "" })).toEqual({});
  });
  it("trims and includes label and language", () => {
    expect(buildAllowOpts({ label: "  Mom ", confirmChoice: "default", language: " Spanish " })).toEqual({
      label: "Mom",
      language: "Spanish",
    });
  });
  it("maps the confirm choices to booleans", () => {
    expect(buildAllowOpts({ label: "", confirmChoice: "confirm", language: "" })).toEqual({ confirm: true });
    expect(buildAllowOpts({ label: "", confirmChoice: "no-confirm", language: "" })).toEqual({ confirm: false });
  });
});

describe("formatStatusLine", () => {
  it("renders 'down' when the bridge is unreachable", () => {
    expect(formatStatusLine({ reachable: false }, 7766)).toBe("Bridge: ○ down  ·  port 7766");
  });
  it("renders connected with a filled glyph", () => {
    expect(formatStatusLine({ reachable: true, state: "connected" }, 7766)).toBe("Bridge: ● connected  ·  port 7766");
  });
  it("maps known non-connected states to friendly words", () => {
    expect(formatStatusLine({ reachable: true, state: "needs_relink" }, 7766)).toBe(
      "Bridge: ◍ needs re-link  ·  port 7766"
    );
  });
  it("falls back to the raw state, and to 'unknown' when state is missing", () => {
    expect(formatStatusLine({ reachable: true, state: "weird" }, 8080)).toBe("Bridge: ◍ weird  ·  port 8080");
    expect(formatStatusLine({ reachable: true }, 7766)).toBe("Bridge: ◍ unknown  ·  port 7766");
  });
});

describe("chooseLaunch", () => {
  it("opens the menu for the explicit command on a TTY", () => {
    expect(chooseLaunch({ command: "menu", isTTY: true })).toBe("menu");
  });
  it("errors for the explicit command without a TTY", () => {
    expect(chooseLaunch({ command: "menu", isTTY: false })).toBe("error-needs-tty");
  });
  it("opens the menu for no command on a TTY", () => {
    expect(chooseLaunch({ command: undefined, isTTY: true })).toBe("menu");
  });
  it("prints help for no command without a TTY", () => {
    expect(chooseLaunch({ command: undefined, isTTY: false })).toBe("help");
  });
});

describe("formatAllowEntryLabel", () => {
  it("renders a bare number with just the confirm flag", () => {
    expect(formatAllowEntryLabel({ number: "5215512345678", confirm: true })).toBe("+5215512345678  [confirm]");
  });
  it("includes label and language with no-confirm", () => {
    expect(
      formatAllowEntryLabel({ number: "5215599999999", label: "Mom", confirm: false, language: "Spanish" })
    ).toBe("+5215599999999  Mom  [no-confirm]  lang:Spanish");
  });
  it("includes a label without language", () => {
    expect(formatAllowEntryLabel({ number: "5215500000000", label: "Work", confirm: true })).toBe(
      "+5215500000000  Work  [confirm]"
    );
  });
  it("includes language without a label", () => {
    expect(formatAllowEntryLabel({ number: "5215511111111", confirm: false, language: "English" })).toBe(
      "+5215511111111  [no-confirm]  lang:English"
    );
  });
});
