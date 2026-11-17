import { describe, expect, it } from "vitest";
import Helper, { getImageReferences, replaceImageReferences } from "../src/helper";

describe("image references", () => {
  it("handles extensionless URLs, nested parentheses, titles, spaces and wiki dimensions", () => {
    const value = '![demo](https://example.com/image?id=1) ![x](https://example.com/a(b).png "title") ![中文](<图片 文件.png>) ![[folder/图.png|300]]';
    const refs = getImageReferences(value);
    expect(refs.map(ref => ref.path)).toEqual(["https://example.com/image?id=1", "https://example.com/a(b).png", "图片 文件.png", "folder/图.png"]);
    expect(refs[3].name).toBe("图|300");
    for (const ref of refs) expect(value.slice(ref.start, ref.end)).toBe(ref.source);
  });
  it("ignores escaped images, inline code, fences, frontmatter and comments", () => {
    const value = '---\nexample: "![](front.png)"\n---\n`![](inline.png)`\n~~~md\n![](fenced.png)\n~~~\n<!-- ![](hidden.png) -->\n\\![](escaped.png)\n![](real.png)';
    expect(getImageReferences(value).map(ref => ref.path)).toEqual(["real.png"]);
  });
  it("changes parsed references without modifying identical code examples", () => {
    const value = '![](same.png)\n`![](same.png)`\n![](same.png)';
    const result = replaceImageReferences(value, new Map([["![](same.png)", "![](https://cdn/a.png)"]]));
    expect(result).toBe('![](https://cdn/a.png)\n`![](same.png)`\n![](https://cdn/a.png)');
  });
  it("matches excluded domains on hostname boundaries", () => {
    const helper = new Helper({} as any);
    expect(helper.hasBlackDomain("https://sub.example.com/a", " example.com, other.org ")).toBe(true);
    expect(helper.hasBlackDomain("https://notexample.com/a", "example.com")).toBe(false);
    expect(helper.hasBlackDomain("https://example.com.evil/a", "example.com")).toBe(false);
  });
});
