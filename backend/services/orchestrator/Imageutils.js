import sharp from 'sharp';
import { logger } from '../../utils/logger.js';
import { stringifyToolResult, tryParseJson } from './responseUtils.js';


const MAX_INLINE_IMAGE_BYTES = 700 * 1024;


const COMPRESSED_IMAGE_QUALITY = 78;

const COMPRESSED_IMAGE_MAX_WIDTH = 1600;



function stripDataUriPrefix(base64Data) {
  if (typeof base64Data !== 'string') {
    return '';
  }

  const trimmed = base64Data.trim();
  const dataUriMatch = trimmed.match(/^data:([^;]+);base64,(.+)$/i);
  return dataUriMatch ? dataUriMatch[2] : trimmed;
}

function estimateBase64Bytes(base64Data) {
  const normalized = stripDataUriPrefix(base64Data).replace(/\s+/g, '');
  if (!normalized) {
    return 0;
  }

  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function inferMimeTypeFromFormat(format) {
  if (typeof format !== 'string' || !format.trim()) {
    return 'image/png';
  }

  const normalized = format.trim().toLowerCase();
  if (normalized === 'jpg' || normalized === 'jpeg') return 'image/jpeg';
  if (normalized === 'png')  return 'image/png';
  if (normalized === 'webp') return 'image/webp';
  if (normalized === 'gif')  return 'image/gif';
  return `image/${normalized}`;
}


async function compressImageForClaude(base64Data, mimeType = 'image/png') {
  const normalizedBase64 = stripDataUriPrefix(base64Data);
  if (!normalizedBase64) {
    return null;
  }

  const estimatedBytes = estimateBase64Bytes(normalizedBase64);
  if (estimatedBytes <= MAX_INLINE_IMAGE_BYTES) {
    return { data: normalizedBase64, mimeType };
  }

  const originalBuffer = Buffer.from(normalizedBase64, 'base64');

  try {
    const metadata = await sharp(originalBuffer).metadata();
    const targetWidth = metadata.width
      ? Math.min(metadata.width, COMPRESSED_IMAGE_MAX_WIDTH)
      : COMPRESSED_IMAGE_MAX_WIDTH;

    const compressedBuffer = await sharp(originalBuffer)
      .rotate()                              // respeta la orientación EXIF
      .resize({ width: targetWidth, withoutEnlargement: true, fit: 'inside' })
      .webp({ quality: COMPRESSED_IMAGE_QUALITY, effort: 6 })
      .toBuffer();

    if (compressedBuffer.length <= MAX_INLINE_IMAGE_BYTES && compressedBuffer.length < originalBuffer.length) {
      return { data: compressedBuffer.toString('base64'), mimeType: 'image/webp' };
    }
    const aggressiveBuffer = await sharp(originalBuffer)
      .rotate()
      .resize({ width: 1024, withoutEnlargement: true, fit: 'inside' })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();

    if (aggressiveBuffer.length <= MAX_INLINE_IMAGE_BYTES && aggressiveBuffer.length < originalBuffer.length) {
      return { data: aggressiveBuffer.toString('base64'), mimeType: 'image/jpeg' };
    }
  } catch (error) {
    logger.warn(`No se pudo comprimir la imagen ROI para Claude: ${error.message}`);
  }

  return null;
}
async function buildClaudeImageBlock(base64Data, mimeType = 'image/png') {
  if (typeof base64Data !== 'string' || !base64Data.trim()) {
    return null;
  }

  const compressedImage = await compressImageForClaude(base64Data, mimeType);
  if (!compressedImage) {
    return null;
  }

  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: compressedImage.mimeType,
      data: compressedImage.data
    }
  };
}

function extractVisionPayloadFromUnknownShape(value, depth = 0) {
  if (depth > 6 || value == null) {
    return null;
  }

  if (typeof value === 'string') {
    const parsed = tryParseJson(value);
    return parsed ? extractVisionPayloadFromUnknownShape(parsed, depth + 1) : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = extractVisionPayloadFromUnknownShape(item, depth + 1);
      if (candidate) return candidate;
    }
    return null;
  }

  if (typeof value !== 'object') {
    return null;
  }

  if (typeof value.image_base64 === 'string') {
    return value;
  }

  if (Array.isArray(value.pages) && value.pages.some((p) => p && typeof p.image_base64 === 'string')) {
    return value;
  }

  if (typeof value.text === 'string') {
    const parsedText = tryParseJson(value.text);
    if (parsedText) {
      const fromText = extractVisionPayloadFromUnknownShape(parsedText, depth + 1);
      if (fromText) return fromText;
    }
  }

  if (value.content) {
    return extractVisionPayloadFromUnknownShape(value.content, depth + 1);
  }

  return null;
}


async function buildClaudeContentFromJsonToolPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const contentBlocks = [];

  if (typeof payload.image_base64 === 'string') {
    const mimeType = inferMimeTypeFromFormat(payload.format);
    const metadata = { ...payload };
    delete metadata.image_base64;

    const imageBlock = await buildClaudeImageBlock(payload.image_base64, mimeType);
    if (imageBlock) {
      contentBlocks.push(imageBlock);
    } else {
      metadata.image_inline_warning = 'La imagen ROI excede el limite para enviar inline a Claude y se omitio.';
    }

    contentBlocks.push({ type: 'text', text: JSON.stringify(metadata, null, 2) });
    return contentBlocks;
  }

  if (Array.isArray(payload.pages)) {
    const metadata = { ...payload, pages: [] };
    const pageImages = [];

    for (const page of payload.pages) {
      if (page && typeof page === 'object' && typeof page.image_base64 === 'string') {
        const pageWithoutImage = { ...page };
        delete pageWithoutImage.image_base64;

        const mimeType = inferMimeTypeFromFormat(page?.format || payload?.format);
        const imageBlock = await buildClaudeImageBlock(page.image_base64, mimeType);

        if (imageBlock) {
          pageImages.push(imageBlock);
        } else {
          pageWithoutImage.image_inline_warning = 'La imagen ROI excede el limite para enviar inline a Claude y se omitio.';
        }

        metadata.pages.push(pageWithoutImage);
        continue;
      }

      metadata.pages.push(page);
    }

    contentBlocks.push({ type: 'text', text: JSON.stringify(metadata, null, 2) });
    contentBlocks.push(...pageImages);
    return contentBlocks;
  }

  return null;
}

export async function normalizeToolResultForClaude(toolResult) {
  if (!toolResult || typeof toolResult !== 'object') {
    return {
      content: stringifyToolResult(toolResult),
      is_error: false
    };
  }

  const isError = Boolean(toolResult.isError);

  const extractedPayload = extractVisionPayloadFromUnknownShape(toolResult);
  const structuredFromExtracted = await buildClaudeContentFromJsonToolPayload(extractedPayload);
  if (structuredFromExtracted) {
    return { content: structuredFromExtracted, is_error: isError };
  }

  if (Array.isArray(toolResult.content)) {
    const hasImageBlocks = toolResult.content.some(
      (item) => item?.type === 'image' && typeof item?.data === 'string'
    );

    if (hasImageBlocks) {
      const claudeBlocks = [];

      for (const item of toolResult.content) {
        if (item?.type === 'text' && typeof item?.text === 'string') {
          claudeBlocks.push({ type: 'text', text: item.text });
          continue;
        }

        if (item?.type === 'image' && typeof item?.data === 'string') {
          const imageBlock = await buildClaudeImageBlock(item.data, item.mimeType || 'image/png');
          if (imageBlock) claudeBlocks.push(imageBlock);
        }
      }

      if (claudeBlocks.length > 0) {
        return { content: claudeBlocks, is_error: isError };
      }
    }

    const textPayload = toolResult.content
      .map((item) => {
        if (item?.type === 'text' && typeof item?.text === 'string') return item.text;
        if (typeof item === 'string') return item;
        return null;
      })
      .filter(Boolean)
      .join('\n');

    const parsedPayload = tryParseJson(textPayload);
    const structuredFromText = await buildClaudeContentFromJsonToolPayload(parsedPayload);
    if (structuredFromText) {
      return { content: structuredFromText, is_error: isError };
    }

    return {
      content: textPayload || stringifyToolResult(toolResult),
      is_error: isError
    };
  }

  return {
    content: stringifyToolResult(toolResult),
    is_error: isError
  };
}