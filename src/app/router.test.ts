import { describe, expect, it } from "vitest";

import { withoutBase, withBase } from "./router";

import { normalizePath, parseRoute, routeToPath } from "./router";

describe("normalizePath", () => {
  it("collapses a trailing slash", () => {
    expect(normalizePath("/notes/")).toBe("/notes");
  });

  it("keeps the root as a single slash", () => {
    expect(normalizePath("/")).toBe("/");
  });

  it("collapses repeated trailing slashes", () => {
    expect(normalizePath("/notes///")).toBe("/notes");
  });

  it("adds a missing leading slash", () => {
    expect(normalizePath("notes")).toBe("/notes");
  });

  it("treats an empty path as the root", () => {
    expect(normalizePath("")).toBe("/");
  });

  it("leaves an ordinary path alone", () => {
    expect(normalizePath("/notes/molgar")).toBe("/notes/molgar");
  });
});

describe("parseRoute", () => {
  it("maps the root to the board", () => {
    expect(parseRoute("/")).toEqual({ name: "board" });
  });

  it("treats a trailing slash on the root as the same page", () => {
    expect(parseRoute("/")).toEqual({ name: "board" });
  });

  it("reports an unknown path rather than silently showing the board", () => {
    expect(parseRoute("/nonsense")).toEqual({
      name: "notFound",
      path: "/nonsense",
    });
  });

  it("does not treat a bare word as the board", () => {
    expect(parseRoute("/board")).toEqual({ name: "notFound", path: "/board" });
  });
});

describe("routeToPath", () => {
  it("round-trips every route", () => {
    for (const path of ["/"]) {
      expect(routeToPath(parseRoute(path))).toBe(path);
    }
  });

  it("sends an unknown path back to itself, not to the board", () => {
    expect(routeToPath({ name: "notFound", path: "/nope" })).toBe("/nope");
  });
});

describe("served from a subpath", () => {
  const BASE = "/dossiers-and-diagrams";

  it("reads the board at the deployment\u2019s own address", () => {
    expect(withoutBase("/dossiers-and-diagrams", BASE)).toBe("/");
    expect(withoutBase("/dossiers-and-diagrams/", BASE)).toBe("/");
  });

  it("leaves a path that is not under the base alone", () => {
    expect(withoutBase("/something-else", BASE)).toBe("/something-else");
    expect(withoutBase("/dossiers-and-diagrams-extra", BASE)).toBe(
      "/dossiers-and-diagrams-extra",
    );
  });

  it("puts the base back when writing a path into the URL bar", () => {
    expect(withBase("/", BASE)).toBe("/dossiers-and-diagrams/");
    expect(withBase("/nope", BASE)).toBe("/dossiers-and-diagrams/nope");
  });

  it("is a no-op in development, where the board is at the root", () => {
    expect(withBase("/", "/")).toBe("/");
    expect(withoutBase("/nope", "/")).toBe("/nope");
  });

  it("round-trips through the URL bar", () => {
    for (const path of ["/", "/nope"]) {
      expect(withoutBase(withBase(path, BASE), BASE)).toBe(path);
    }
  });
});
