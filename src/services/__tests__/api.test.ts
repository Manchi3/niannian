/**
 * API Service Tests — SSE Stream Parsing
 *
 * Tests the chat() function's ability to parse SSE (Server-Sent Events)
 * streams from a mock fetch response, and the condense() function.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chat, condense } from '../api';
import type { SSEChunk, ChatRequest } from '../../types';

// ---------------------------------------------------------------------------
// Helper: Create a mock ReadableStream from SSE data chunks
// ---------------------------------------------------------------------------
function createMockStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

// Helper to create SSE-formatted data
function sseData(chunk: SSEChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
});

describe('api — chat() SSE Parsing', () => {
  it('should parse multiple chunk events and accumulate text', async () => {
    const chunks = [
      sseData({ type: 'chunk', content: 'Hello' }),
      sseData({ type: 'chunk', content: ' ' }),
      sseData({ type: 'chunk', content: 'World' }),
      sseData({ type: 'done' }),
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: createMockStream(chunks),
    });

    const onChunk = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    const fullText = await chat(
      { messages: [{ role: 'user', content: 'Hi' }] },
      onChunk,
      onDone,
      onError,
    );

    expect(fullText).toBe('Hello World');
    expect(onChunk).toHaveBeenCalledTimes(3);
    expect(onChunk).toHaveBeenNthCalledWith(1, 'Hello');
    expect(onChunk).toHaveBeenNthCalledWith(2, ' ');
    expect(onChunk).toHaveBeenNthCalledWith(3, 'World');
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('should handle [DONE] sentinel', async () => {
    const chunks = [
      sseData({ type: 'chunk', content: 'Response' }),
      'data: [DONE]\n\n',
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: createMockStream(chunks),
    });

    const onDone = vi.fn();
    const fullText = await chat(
      { messages: [] },
      vi.fn(),
      onDone,
      vi.fn(),
    );

    expect(fullText).toBe('Response');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('should handle stream ending without explicit done event', async () => {
    const chunks = [sseData({ type: 'chunk', content: 'Partial' })];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: createMockStream(chunks),
    });

    const onDone = vi.fn();
    const fullText = await chat(
      { messages: [] },
      vi.fn(),
      onDone,
      vi.fn(),
    );

    expect(fullText).toBe('Partial');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('should handle error events in the stream', async () => {
    const chunks = [
      sseData({ type: 'chunk', content: 'Partial' }),
      sseData({ type: 'error', error: 'AI service unavailable' }),
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: createMockStream(chunks),
    });

    const onError = vi.fn();
    const fullText = await chat(
      { messages: [] },
      vi.fn(),
      vi.fn(),
      onError,
    );

    expect(fullText).toBe('Partial');
    expect(onError).toHaveBeenCalledWith('AI service unavailable');
  });

  it('should handle non-OK HTTP response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const onError = vi.fn();
    const fullText = await chat(
      { messages: [] },
      vi.fn(),
      vi.fn(),
      onError,
    );

    expect(fullText).toBe('');
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('500'));
  });

  it('should handle missing response body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: null,
    });

    const onError = vi.fn();
    const fullText = await chat(
      { messages: [] },
      vi.fn(),
      vi.fn(),
      onError,
    );

    expect(fullText).toBe('');
    expect(onError).toHaveBeenCalledWith('No response body received');
  });

  it('should handle network errors (fetch rejection)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failed'));

    const onError = vi.fn();
    const fullText = await chat(
      { messages: [] },
      vi.fn(),
      vi.fn(),
      onError,
    );

    expect(fullText).toBe('');
    expect(onError).toHaveBeenCalledWith('Network failed');
  });

  it('should handle split SSE events across chunks', async () => {
    // Split a single SSE event across two network chunks
    const part1 = 'data: {"type":"chu';
    const part2 = 'nk","content":"Hello"}\n\n';

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: createMockStream([part1, part2]),
    });

    const onChunk = vi.fn();
    const fullText = await chat(
      { messages: [] },
      onChunk,
      vi.fn(),
      vi.fn(),
    );

    expect(fullText).toBe('Hello');
    expect(onChunk).toHaveBeenCalledWith('Hello');
  });

  it('should ignore malformed JSON in SSE data', async () => {
    const chunks = [
      'data: {invalid json}\n\n',
      sseData({ type: 'chunk', content: 'Valid' }),
      sseData({ type: 'done' }),
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: createMockStream(chunks),
    });

    const onChunk = vi.fn();
    const fullText = await chat(
      { messages: [] },
      onChunk,
      vi.fn(),
      vi.fn(),
    );

    // Malformed JSON should be skipped, valid chunks should still work
    expect(fullText).toBe('Valid');
    expect(onChunk).toHaveBeenCalledTimes(1);
  });

  it('should send correct request body to the server', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: createMockStream([sseData({ type: 'done' })]),
    });

    const request: ChatRequest = {
      messages: [{ role: 'user', content: 'Hello AI' }],
      imageBase64: 'data:image/jpeg;base64,abc123',
    };

    await chat(request, vi.fn(), vi.fn(), vi.fn());

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/chat',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      }),
    );
  });
});

describe('api — condense()', () => {
  it('should return title and content from the response', async () => {
    const mockResult = {
      title: '夏日午后的回忆',
      content: '今天上传了一张照片...',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResult,
    });

    const result = await condense([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]);

    expect(result.title).toBe('夏日午后的回忆');
    expect(result.content).toBe('今天上传了一张照片...');
  });

  it('should throw on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Server error',
    });

    await expect(condense([])).rejects.toThrow('HTTP 500');
  });

  it('should send messages in the request body', async () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ title: 'T', content: 'C' }),
    });

    await condense(messages);

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/condense',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ messages }),
      }),
    );
  });
});
