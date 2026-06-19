import { describe, it, expect, beforeEach } from "vitest";
import { putAttachmentText, _resetForTests } from "../lib/attachment-cache";
import { pdfVisualPartsForMessage } from "../lib/pdf-visuals";
import type { Attachment } from "../stores/chat";

function pdfAttachment(filename = "worksheet.pdf"): Attachment {
  return {
    filename,
    mimeType: "application/pdf",
    dataUrl: "data:application/pdf;base64,pdfbytes",
    sizeBytes: 12,
  };
}

beforeEach(() => _resetForTests());

describe("pdfVisualPartsForMessage", () => {
  it("sends native PDF file parts to providers with native PDF support", () => {
    putAttachmentText("c1", "worksheet.pdf", "PDF", "body", {
      visualAssets: [
        {
          id: "worksheet_p01_img01",
          sourceFilename: "worksheet.pdf",
          filename: "worksheet_p01_img01.jpg",
          page: 1,
          mimeType: "image/jpeg",
          dataUrl: "data:image/jpeg;base64,img",
        },
      ],
    });

    const parts = pdfVisualPartsForMessage("c1", [pdfAttachment()], {
      modelIsVision: true,
      provider: "openai",
    });

    expect(parts).toEqual([
      { type: "file", data: "data:application/pdf;base64,pdfbytes", mimeType: "application/pdf" },
    ]);
  });

  it("sends extracted PDF images to non-native vision providers", () => {
    putAttachmentText("c1", "worksheet.pdf", "PDF", "body", {
      visualAssets: [
        {
          id: "worksheet_p01_img01",
          sourceFilename: "worksheet.pdf",
          filename: "worksheet_p01_img01.jpg",
          page: 1,
          mimeType: "image/jpeg",
          dataUrl: "data:image/jpeg;base64,img1",
        },
        {
          id: "worksheet_p02_img01",
          sourceFilename: "worksheet.pdf",
          filename: "worksheet_p02_img01.jpg",
          page: 2,
          mimeType: "image/jpeg",
          dataUrl: "data:image/jpeg;base64,img2",
        },
      ],
    });

    const parts = pdfVisualPartsForMessage("c1", [pdfAttachment()], {
      modelIsVision: true,
      provider: "openrouter",
    });

    expect(parts).toEqual([
      { type: "image", image: "data:image/jpeg;base64,img1", mimeType: "image/jpeg" },
      { type: "image", image: "data:image/jpeg;base64,img2", mimeType: "image/jpeg" },
    ]);
  });

  it("does not send PDF visuals to text-only models", () => {
    putAttachmentText("c1", "worksheet.pdf", "PDF", "body", {
      visualAssets: [
        {
          id: "worksheet_p01_img01",
          sourceFilename: "worksheet.pdf",
          filename: "worksheet_p01_img01.jpg",
          page: 1,
          mimeType: "image/jpeg",
          dataUrl: "data:image/jpeg;base64,img",
        },
      ],
    });

    const parts = pdfVisualPartsForMessage("c1", [pdfAttachment()], {
      modelIsVision: false,
      provider: "openrouter",
    });

    expect(parts).toEqual([]);
  });
});
