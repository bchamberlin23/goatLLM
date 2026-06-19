import type { Attachment } from "../stores/chat";
import type { LlmContentPart } from "./llm-types";
import { listAttachmentImages } from "./attachment-cache";
import { providerSupportsNativePdf } from "./native-pdf";

const MAX_PDF_IMAGE_PARTS = 8;

function isPdfAttachment(att: Attachment): boolean {
  return att.mimeType === "application/pdf" || /\.pdf$/i.test(att.filename);
}

export function pdfVisualPartsForMessage(
  conversationId: string,
  attachments: Attachment[],
  options: { modelIsVision: boolean; provider: string },
): LlmContentPart[] {
  if (!options.modelIsVision) return [];

  const pdfs = attachments.filter(isPdfAttachment);
  if (pdfs.length === 0) return [];

  if (providerSupportsNativePdf(options.provider)) {
    return pdfs.map((pdf) => ({
      type: "file" as const,
      data: pdf.dataUrl,
      mimeType: "application/pdf",
    }));
  }

  const parts: LlmContentPart[] = [];
  let imagesAdded = 0;
  for (const pdf of pdfs) {
    for (const asset of listAttachmentImages(conversationId, pdf.filename)) {
      if (imagesAdded >= MAX_PDF_IMAGE_PARTS) return parts;
      parts.push({
        type: "text",
        text: `[PDF image asset: ${asset.id} from ${pdf.filename}, page ${asset.page}]`,
      });
      parts.push({
        type: "image",
        image: asset.dataUrl,
        mimeType: asset.mimeType,
      });
      imagesAdded += 1;
    }
  }
  return parts;
}
