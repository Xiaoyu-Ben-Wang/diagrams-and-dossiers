// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { newArticle, newNote } from "../model/create";
import type { BoardEntity } from "../model/types";
import {
  MENTION_ATTRIBUTE,
  MENTION_MISSING_CLASS,
  linkifyMentions,
  markMissingMentions,
  mentionHref,
  parseMentions,
  resolveMention,
  rewriteMentions,
} from "./mentions";

const page = (title: string, id = title): BoardEntity =>
  newArticle({ x: 0, y: 0 }, "# Body", title, undefined, { id });

describe("parsing", () => {
  it("finds a mention and what it names", () => {
    expect(parseMentions("See @[The Drowned Bell] about it.")).toEqual([
      { index: 4, length: 19, name: "The Drowned Bell" },
    ]);
  });

  it("finds several, in order", () => {
    const found = parseMentions("@[One] then @[Two] then @[Three]");
    expect(found.map((mention) => mention.name)).toEqual([
      "One",
      "Two",
      "Three",
    ]);
    expect(found.map((mention) => mention.index)).toEqual([0, 12, 24]);
  });

  it("trims the name but keeps the run whole", () => {
    const [mention] = parseMentions("@[  Spaced  ]");
    expect(mention.name).toBe("Spaced");
    expect(mention.length).toBe("@[  Spaced  ]".length);
  });

  it("leaves an address alone", () => {
    expect(parseMentions("write to molgar@[the pale] today")).toEqual([]);
  });

  it("still links after punctuation, which is how people write", () => {
    expect(parseMentions("(@[One])")).toEqual([
      { index: 1, length: 6, name: "One" },
    ]);
    expect(parseMentions('"@[One]"')).toEqual([
      { index: 1, length: 6, name: "One" },
    ]);
  });

  it("ignores an unclosed or empty one", () => {
    expect(parseMentions("@[unclosed")).toEqual([]);
    expect(parseMentions("@[]")).toEqual([]);
    expect(parseMentions("@[   ]")).toEqual([]);
  });

  it("stops at a line break rather than swallowing the next line", () => {
    expect(parseMentions("@[One\ntwo]")).toEqual([]);
  });
});

describe("the href", () => {
  it("is a fragment, so a name can never become a scheme", () => {
    expect(mentionHref("javascript:alert(1)")).toBe(
      "#mention:javascript%3Aalert(1)",
    );
    expect(mentionHref("javascript:alert(1)").startsWith("#")).toBe(true);
  });
});

describe("linkifying", () => {
  it("turns a mention into an anchor displaying the name", () => {
    const html = linkifyMentions("<p>See @[The Bell] there.</p>");

    expect(html).toContain(
      '<a class="mention" href="#mention:The%20Bell" data-mention="The Bell">The Bell</a>',
    );
    expect(html).not.toContain("@[");
    expect(html).toContain("See ");
    expect(html).toContain(" there.");
  });

  it("produces the same markup whether or not the name resolves", () => {
    const once = linkifyMentions("<p>@[Anything At All]</p>");
    const twice = linkifyMentions("<p>@[Anything At All]</p>");
    expect(once).toBe(twice);
    expect(once).not.toContain("missing");
  });

  it("leaves code alone, so an article can document the syntax", () => {
    expect(linkifyMentions("<p><code>@[Not A Link]</code></p>")).not.toContain(
      "<a",
    );
    expect(linkifyMentions("<pre>@[Not A Link]</pre>")).not.toContain("<a");
  });

  it("does not put an anchor inside an anchor", () => {
    const html = linkifyMentions(
      '<p><a href="http://x.test">@[Nested]</a></p>',
    );
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it("never lets a name become markup", () => {
    const html = linkifyMentions(
      "<p>@[&lt;img src=x onerror=alert(1)&gt;]</p>",
    );

    const round = document.createElement("div");
    round.innerHTML = html;
    expect(round.querySelector("img")).toBeNull();
    expect(round.querySelector("a")!.textContent).toBe(
      "<img src=x onerror=alert(1)>",
    );
  });

  it("returns the html untouched when there is nothing to find", () => {
    const html = "<p>Just prose, no links at all.</p>";
    expect(linkifyMentions(html)).toBe(html);
  });
});

describe("resolving", () => {
  it("matches a title case-insensitively", () => {
    const entities = [page("The Drowned Bell")];
    expect(resolveMention("the drowned bell", entities)?.id).toBe(
      "The Drowned Bell",
    );
    expect(resolveMention("  The Drowned Bell  ", entities)?.id).toBe(
      "The Drowned Bell",
    );
  });

  it("will not resolve a note, even one with the same title", () => {
    const note = { ...newNote({ x: 0, y: 0 }), title: "The Drowned Bell" };
    expect(resolveMention("The Drowned Bell", [note])).toBeNull();
  });

  it("will not resolve an untitled thing", () => {
    const untitled = newArticle({ x: 0, y: 0 }, "# x", "");
    expect(resolveMention("", [untitled])).toBeNull();
  });

  it("takes the first of two with the same name, rather than neither", () => {
    const entities = [page("Ledger", "one"), page("Ledger", "two")];
    expect(resolveMention("Ledger", entities)?.id).toBe("one");
  });
});

describe("marking the ones that name nothing", () => {
  it("adds the class to a mention with no target, and only to that one", () => {
    const root = document.createElement("div");
    root.innerHTML = linkifyMentions("<p>@[Known] and @[Unknown]</p>");

    markMissingMentions(root, new Set(["known"]));

    const [known, unknown] = Array.from(
      root.querySelectorAll(`[${MENTION_ATTRIBUTE}]`),
    );
    expect(known.classList.contains(MENTION_MISSING_CLASS)).toBe(false);
    expect(unknown.classList.contains(MENTION_MISSING_CLASS)).toBe(true);
  });

  it("takes the class off again when the name turns up", () => {
    const root = document.createElement("div");
    root.innerHTML = linkifyMentions("<p>@[Later]</p>");
    markMissingMentions(root, new Set());
    const anchor = root.querySelector(`[${MENTION_ATTRIBUTE}]`)!;
    expect(anchor.classList.contains(MENTION_MISSING_CLASS)).toBe(true);

    markMissingMentions(root, new Set(["later"]));
    expect(anchor.classList.contains(MENTION_MISSING_CLASS)).toBe(false);
  });

  it("toggles the class without replacing the text node", () => {
    const root = document.createElement("div");
    root.innerHTML = linkifyMentions("<p>@[Later]</p>");
    const before = root.querySelector("a")!.firstChild;

    markMissingMentions(root, new Set());

    expect(root.querySelector("a")!.firstChild).toBe(before);
  });
});

describe("repointing a renamed name", () => {
  it("rewrites every run that names the old one", () => {
    const text = "Ask @[The Bell] about @[The Bell], and @[Molgar].";
    expect(rewriteMentions(text, "The Bell", "The Drowned Bell")).toBe(
      "Ask @[The Drowned Bell] about @[The Drowned Bell], and @[Molgar].",
    );
  });

  it("leaves a longer name that merely starts the same alone", () => {
    const text = "Both @[Ann] and @[Anna] were there.";
    expect(rewriteMentions(text, "Ann", "Anne")).toBe(
      "Both @[Anne] and @[Anna] were there.",
    );
  });

  it("matches the way resolution does, without regard to case", () => {
    const text = "See @[the belt] again.";
    expect(rewriteMentions(text, "The Belt", "The Second Belt")).toBe(
      "See @[The Second Belt] again.",
    );
  });

  it("writes the new name with the casing it was given", () => {
    expect(rewriteMentions("@[old name]", "Old Name", "New Name")).toBe(
      "@[New Name]",
    );
  });

  it("keeps the character in front of the run", () => {
    expect(rewriteMentions("see (@[Old])", "Old", "New")).toBe("see (@[New])");
  });

  it("leaves something that was never a mention alone", () => {
    // No boundary before the `@`, so this is an address, not a mention — the same
    // rule that keeps emails out of the linkifier.
    expect(rewriteMentions("mail me at bob@[Old]", "Old", "New")).toBe(
      "mail me at bob@[Old]",
    );
  });

  it("gives the text back untouched when nothing names the old name", () => {
    const text = "Nothing to see, and no @[Old] either.";
    const once = rewriteMentions(text, "Missing", "New");
    expect(once).toBe(text);
    // The same string, so a caller can skip the write on identity.
    expect(rewriteMentions("@[Old]", "Old", "New")).not.toBe("@[Old]");
  });

  it("rewrites nothing when the new name is empty", () => {
    // `@[]` is not a mention, so writing one would silently unlink the text.
    expect(rewriteMentions("@[Old]", "Old", "   ")).toBe("@[Old]");
  });

  it("touches a code span, as the linkifier does", () => {
    // Linkifying skips code, but a rewrite is textual: the two disagree here, and
    // this records which way.
    expect(rewriteMentions("`@[Old]`", "Old", "New")).toBe("`@[New]`");
  });
});
