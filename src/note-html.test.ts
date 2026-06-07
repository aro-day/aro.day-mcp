// renderNoteHtml — the connector's plain-text → structured-HTML pass that
// makes MCP-written notes render with line breaks and bullet lists instead
// of a single-paragraph wall.

import { describe, expect, test } from "bun:test";
import { renderNoteHtml } from "./state.js";

describe("renderNoteHtml", () => {
  test("single line → one paragraph", () => {
    expect(renderNoteHtml("hello")).toBe("<p>hello</p>");
  });

  test("newlines inside a block → <br>", () => {
    expect(renderNoteHtml("a\nb")).toBe("<p>a<br>b</p>");
  });

  test("blank line separates paragraphs", () => {
    expect(renderNoteHtml("a\n\nb")).toBe("<p>a</p><p>b</p>");
  });

  test("dash / star / bullet lines become a <ul>", () => {
    expect(renderNoteHtml("- one\n- two")).toBe("<ul><li>one</li><li>two</li></ul>");
    expect(renderNoteHtml("* a\n• b")).toBe("<ul><li>a</li><li>b</li></ul>");
  });

  test("intro paragraph + bullet list", () => {
    expect(renderNoteHtml("Books:\n\n- A\n- B")).toBe("<p>Books:</p><ul><li>A</li><li>B</li></ul>");
  });

  test("escapes HTML in text and bullets", () => {
    expect(renderNoteHtml("<b>x</b>")).toBe("<p>&lt;b&gt;x&lt;/b&gt;</p>");
    expect(renderNoteHtml("- <i>y</i>")).toBe("<ul><li>&lt;i&gt;y&lt;/i&gt;</li></ul>");
  });

  test("empty string → empty paragraph (never blank html)", () => {
    expect(renderNoteHtml("")).toBe("<p></p>");
  });
});
