// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  forgetCameraView,
  loadCameraView,
  saveCameraView,
} from "./last-camera";

beforeEach(() => {
  localStorage.clear();
});

describe("last-camera", () => {
  it("gives back the view a board was left at", () => {
    saveCameraView("board-1", { x: -240, y: 96, zoom: 1.5 });

    expect(loadCameraView("board-1")).toEqual({ x: -240, y: 96, zoom: 1.5 });
  });

  it("keeps each board’s view to itself", () => {
    saveCameraView("board-1", { x: 1, y: 2, zoom: 1 });
    saveCameraView("board-2", { x: 9, y: 9, zoom: 2 });

    expect(loadCameraView("board-1")).toEqual({ x: 1, y: 2, zoom: 1 });
    expect(loadCameraView("board-2")).toEqual({ x: 9, y: 9, zoom: 2 });
  });

  it("has nothing for a board it has never seen", () => {
    expect(loadCameraView("board-1")).toBeNull();
  });

  it("ignores a half-written or hand-edited view rather than opening at NaN", () => {
    localStorage.setItem("detective-board.camera.board-1", '{"x":10,"y":20}');
    expect(loadCameraView("board-1")).toBeNull();

    localStorage.setItem("detective-board.camera.board-1", "not json");
    expect(loadCameraView("board-1")).toBeNull();

    localStorage.setItem(
      "detective-board.camera.board-1",
      '{"x":null,"y":0,"zoom":1}',
    );
    expect(loadCameraView("board-1")).toBeNull();
  });

  it("forgets a board that has gone", () => {
    saveCameraView("board-1", { x: 1, y: 2, zoom: 1 });
    forgetCameraView("board-1");

    expect(loadCameraView("board-1")).toBeNull();
  });
});
