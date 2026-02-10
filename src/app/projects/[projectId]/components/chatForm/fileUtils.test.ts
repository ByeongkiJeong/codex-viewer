import { describe, expect, it } from "vitest";
import { extractImageFilesFromClipboardItems } from "./fileUtils";

type ClipboardItemInput = {
  kind: string;
  type: string;
  file: File | null;
};

const createClipboardItem = ({ kind, type, file }: ClipboardItemInput) => {
  return {
    kind,
    type,
    getAsFile: () => file,
  };
};

describe("extractImageFilesFromClipboardItems", () => {
  it("returns only image files from clipboard items", () => {
    const imageFile = new File(["img"], "image.png", { type: "image/png" });
    const textFile = new File(["txt"], "note.txt", { type: "text/plain" });

    const files = extractImageFilesFromClipboardItems([
      createClipboardItem({
        kind: "file",
        type: "image/png",
        file: imageFile,
      }),
      createClipboardItem({
        kind: "string",
        type: "text/plain",
        file: null,
      }),
      createClipboardItem({
        kind: "file",
        type: "text/plain",
        file: textFile,
      }),
    ]);

    expect(files).toEqual([imageFile]);
  });

  it("ignores image clipboard items when getAsFile returns null", () => {
    const files = extractImageFilesFromClipboardItems([
      createClipboardItem({
        kind: "file",
        type: "image/png",
        file: null,
      }),
    ]);

    expect(files).toEqual([]);
  });
});
