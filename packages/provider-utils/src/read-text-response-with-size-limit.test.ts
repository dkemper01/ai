import { APICallError } from '@ai-sdk/provider';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_JSON_RESPONSE_SIZE,
  readTextResponseWithSizeLimit,
} from './read-text-response-with-size-limit';

function createMockTextResponse({
  chunks,
  contentLength,
}: {
  chunks: string[];
  contentLength?: string;
}): { response: Response; cancelled: () => boolean } {
  const headers = new Headers();
  if (contentLength != null) {
    headers.set('content-length', contentLength);
  }

  let cancelled = false;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });

  return {
    response: {
      headers,
      body: stream,
    } as unknown as Response,
    cancelled: () => cancelled,
  };
}

describe('readTextResponseWithSizeLimit', () => {
  it('should read response within limit successfully', async () => {
    const { response } = createMockTextResponse({
      chunks: ['hello', ' world'],
    });

    const result = await readTextResponseWithSizeLimit(response, 100);

    expect(result).toBe('hello world');
  });

  it('should reject when Content-Length exceeds limit (early check)', async () => {
    const { response } = createMockTextResponse({
      chunks: ['small'],
      contentLength: '1000',
    });

    await expect(
      readTextResponseWithSizeLimit(response, 100),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(APICallError);
      expect((error as APICallError).statusCode).toBe(413);
      expect((error as APICallError).message).toContain('1000 bytes');
      return true;
    });
  });

  it('should cancel the body when Content-Length exceeds limit', async () => {
    const { response, cancelled } = createMockTextResponse({
      chunks: ['small'],
      contentLength: '1000',
    });

    await expect(
      readTextResponseWithSizeLimit(response, 100),
    ).rejects.toThrow();

    expect(cancelled()).toBe(true);
  });

  it('should abort when streamed bytes exceed limit', async () => {
    const { response } = createMockTextResponse({
      chunks: ['a'.repeat(60)],
    });

    await expect(readTextResponseWithSizeLimit(response, 50)).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(APICallError);
        expect((error as APICallError).statusCode).toBe(413);
        return true;
      },
    );
  });

  it('should handle missing body as empty string', async () => {
    const response = {
      headers: new Headers(),
      body: null,
    } as unknown as Response;

    await expect(readTextResponseWithSizeLimit(response, 100)).resolves.toBe(
      '',
    );
  });

  it('should use the default max JSON response size constant', () => {
    expect(DEFAULT_MAX_JSON_RESPONSE_SIZE).toBe(100 * 1024 * 1024);
  });
});
