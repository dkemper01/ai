import { APICallError } from '@ai-sdk/provider';

import { cancelResponseBody } from './cancel-response-body';

/**
 * Default maximum size for JSON API responses: 100 MiB.
 *
 * Prevents uncontrolled resource consumption (CVE-2026-8769) when an
 * attacker-controlled endpoint streams infinite or oversized responses.
 */
export const DEFAULT_MAX_JSON_RESPONSE_SIZE = 100 * 1024 * 1024;

/**
 * Reads a fetch Response body as text with a size limit.
 *
 * @param response - The fetch Response to read.
 * @param maxBytes - Maximum allowed bytes.
 * @returns Promise<string> - The response body as text.
 * @throws APICallError if the response exceeds maxBytes.
 */
export async function readTextResponseWithSizeLimit(
  response: Response,
  maxBytes: number,
): Promise<string> {
  // Early rejection based on Content-Length header
  const contentLength = response.headers.get('content-length');
  if (contentLength != null) {
    const length = parseInt(contentLength, 10);
    if (!isNaN(length) && length > maxBytes) {
      await cancelResponseBody(response);
      throw new APICallError({
        message: `Response body size (${length} bytes) exceeds maximum allowed size of ${maxBytes} bytes.`,
        statusCode: 413, // Payload Too Large
      });
    }
  }

  const body = response.body;
  if (body == null) {
    return '';
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let result = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.length;

      if (totalBytes > maxBytes) {
        throw new APICallError({
          message: `Response body size exceeds maximum allowed size of ${maxBytes} bytes.`,
          statusCode: 413, // Payload Too Large
        });
      }

      result += decoder.decode(value, { stream: true });
    }

    // Flush decoder for any remaining bytes
    result += decoder.decode();
  } finally {
    try {
      await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }

  return result;
}
