import { APICallError, EmptyResponseBodyError } from '@ai-sdk/provider';
import { extractResponseHeaders } from './extract-response-headers';
import { parseJSON, safeParseJSON, type ParseResult } from './parse-json';
import { parseJsonEventStream } from './parse-json-event-stream';
import {
  DEFAULT_MAX_JSON_RESPONSE_SIZE,
  readTextResponseWithSizeLimit,
} from './read-text-response-with-size-limit';
import { readResponseWithSizeLimit } from './read-response-with-size-limit';
import type { FlexibleSchema } from './schema';
import { DownloadError } from './download-error';

export type ResponseHandler<RETURN_TYPE> = (options: {
  url: string;
  requestBodyValues: unknown;
  response: Response;
}) => PromiseLike<{
  value: RETURN_TYPE;
  rawValue?: unknown;
  responseHeaders?: Record<string, string>;
}>;

export const createJsonErrorResponseHandler =
  <T>({
    errorSchema,
    errorToMessage,
    isRetryable,
    maxResponseBytes = DEFAULT_MAX_JSON_RESPONSE_SIZE,
  }: {
    errorSchema: FlexibleSchema<T>;
    errorToMessage: (error: T) => string;
    isRetryable?: (response: Response, error?: T) => boolean;
    maxResponseBytes?: number;
  }): ResponseHandler<APICallError> =>
  async ({ response, url, requestBodyValues }) => {
    const responseBody = await readTextResponseWithSizeLimit(
      response,
      maxResponseBytes,
    );
    const responseHeaders = extractResponseHeaders(response);

    // Some providers return an empty response body for some errors:
    if (responseBody.trim() === '') {
      return {
        responseHeaders,
        value: new APICallError({
          message: response.statusText,
          url,
          requestBodyValues,
          statusCode: response.status,
          responseHeaders,
          responseBody,
          isRetryable: isRetryable?.(response),
        }),
      };
    }

    // resilient parsing in case the response is not JSON or does not match the schema:
    try {
      const parsedError = await parseJSON({
        text: responseBody,
        schema: errorSchema,
      });

      return {
        responseHeaders,
        value: new APICallError({
          message: errorToMessage(parsedError),
          url,
          requestBodyValues,
          statusCode: response.status,
          responseHeaders,
          responseBody,
          data: parsedError,
          isRetryable: isRetryable?.(response, parsedError),
        }),
      };
    } catch {
      return {
        responseHeaders,
        value: new APICallError({
          message: response.statusText,
          url,
          requestBodyValues,
          statusCode: response.status,
          responseHeaders,
          responseBody,
          isRetryable: isRetryable?.(response),
        }),
      };
    }
  };

export const createEventSourceResponseHandler =
  <T>(
    chunkSchema: FlexibleSchema<T>,
  ): ResponseHandler<ReadableStream<ParseResult<T>>> =>
  async ({ response }: { response: Response }) => {
    const responseHeaders = extractResponseHeaders(response);

    if (response.body == null) {
      throw new EmptyResponseBodyError({});
    }

    return {
      responseHeaders,
      value: parseJsonEventStream({
        stream: response.body,
        schema: chunkSchema,
      }),
    };
  };

export const createJsonResponseHandler =
  <T>(
    responseSchema: FlexibleSchema<T>,
    maxResponseBytes: number = DEFAULT_MAX_JSON_RESPONSE_SIZE,
  ): ResponseHandler<T> =>
  async ({ response, url, requestBodyValues }) => {
    const responseBody = await readTextResponseWithSizeLimit(
      response,
      maxResponseBytes,
    );

    const parsedResult = await safeParseJSON({
      text: responseBody,
      schema: responseSchema,
    });

    const responseHeaders = extractResponseHeaders(response);

    if (!parsedResult.success) {
      throw new APICallError({
        message: 'Invalid JSON response',
        cause: parsedResult.error,
        statusCode: response.status,
        responseHeaders,
        responseBody,
        url,
        requestBodyValues,
      });
    }

    return {
      responseHeaders,
      value: parsedResult.value,
      rawValue: parsedResult.rawValue,
    };
  };

export const createBinaryResponseHandler =
  (
    maxResponseBytes: number = DEFAULT_MAX_JSON_RESPONSE_SIZE,
  ): ResponseHandler<Uint8Array> =>
  async ({ response, url, requestBodyValues }) => {
    const responseHeaders = extractResponseHeaders(response);

    if (!response.body) {
      throw new APICallError({
        message: 'Response body is empty',
        url,
        requestBodyValues,
        statusCode: response.status,
        responseHeaders,
        responseBody: undefined,
      });
    }

    try {
      const buffer = await readResponseWithSizeLimit({
        response,
        url,
        maxBytes: maxResponseBytes,
      });
      return {
        responseHeaders,
        value: buffer,
      };
    } catch (error) {
      if (DownloadError.isInstance(error)) {
        throw new APICallError({
          message: error.message,
          url,
          requestBodyValues,
          statusCode: 413,
          responseHeaders,
          responseBody: undefined,
          cause: error,
        });
      }

      throw new APICallError({
        message: 'Failed to read response as array buffer',
        url,
        requestBodyValues,
        statusCode: response.status,
        responseHeaders,
        responseBody: undefined,
        cause: error,
      });
    }
  };

export const createStatusCodeErrorResponseHandler =
  (
    maxResponseBytes: number = DEFAULT_MAX_JSON_RESPONSE_SIZE,
  ): ResponseHandler<APICallError> =>
  async ({ response, url, requestBodyValues }) => {
    const responseHeaders = extractResponseHeaders(response);
    const responseBody = await readTextResponseWithSizeLimit(
      response,
      maxResponseBytes,
    );

    return {
      responseHeaders,
      value: new APICallError({
        message: response.statusText,
        url,
        requestBodyValues: requestBodyValues as Record<string, unknown>,
        statusCode: response.status,
        responseHeaders,
        responseBody,
      }),
    };
  };
