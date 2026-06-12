import { APICallError } from '@ai-sdk/provider';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import {
  createBinaryResponseHandler,
  createJsonErrorResponseHandler,
  createJsonResponseHandler,
  createStatusCodeErrorResponseHandler,
} from './response-handler';

describe('createJsonResponseHandler', () => {
  it('should return both parsed value and rawValue', async () => {
    const responseSchema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const rawData = {
      name: 'John',
      age: 30,
      extraField: 'ignored',
    };

    const response = new Response(JSON.stringify(rawData));
    const handler = createJsonResponseHandler(responseSchema);

    const result = await handler({
      url: 'test-url',
      requestBodyValues: {},
      response,
    });

    expect(result.value).toEqual({
      name: 'John',
      age: 30,
    });
    expect(result.rawValue).toEqual(rawData);
  });
});

describe('createBinaryResponseHandler', () => {
  it('should handle binary response successfully', async () => {
    const binaryData = new Uint8Array([1, 2, 3, 4]);
    const response = new Response(binaryData);
    const handler = createBinaryResponseHandler();

    const result = await handler({
      url: 'test-url',
      requestBodyValues: {},
      response,
    });

    expect(result.value).toBeInstanceOf(Uint8Array);
    expect(result.value).toEqual(binaryData);
  });

  it('should throw APICallError when response body is null', async () => {
    const response = new Response(null);
    const handler = createBinaryResponseHandler();

    await expect(
      handler({
        url: 'test-url',
        requestBodyValues: {},
        response,
      }),
    ).rejects.toThrow('Response body is empty');
  });

  it('should reject oversized binary responses', async () => {
    const largeBody = new Uint8Array(200);
    largeBody.fill(1);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(largeBody);
        controller.close();
      },
    });

    const response = {
      headers: new Headers(),
      body: stream,
    } as unknown as Response;

    const handler = createBinaryResponseHandler(50);

    await expect(
      handler({
        url: 'test-url',
        requestBodyValues: {},
        response,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(APICallError);
      expect((error as APICallError).statusCode).toBe(413);
      return true;
    });
  });
});

describe('createJsonErrorResponseHandler', () => {
  it('should reject oversized error responses', async () => {
    const errorSchema = z.object({ message: z.string() });
    const handler = createJsonErrorResponseHandler({
      errorSchema,
      errorToMessage: error => error.message,
      maxResponseBytes: 50,
    });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(' '.repeat(200)));
        controller.close();
      },
    });

    const response = {
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers(),
      body: stream,
    } as unknown as Response;

    await expect(
      handler({
        url: 'test-url',
        requestBodyValues: {},
        response,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(APICallError);
      expect((error as APICallError).statusCode).toBe(413);
      return true;
    });
  });
});

describe('createStatusCodeErrorResponseHandler', () => {
  it('should create error with status text and response body', async () => {
    const response = new Response('Error message', {
      status: 404,
      statusText: 'Not Found',
    });
    const handler = createStatusCodeErrorResponseHandler();

    const result = await handler({
      url: 'test-url',
      requestBodyValues: { some: 'data' },
      response,
    });

    expect(result.value.message).toBe('Not Found');
    expect(result.value.statusCode).toBe(404);
    expect(result.value.responseBody).toBe('Error message');
    expect(result.value.url).toBe('test-url');
    expect(result.value.requestBodyValues).toEqual({ some: 'data' });
  });
});
