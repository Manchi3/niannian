/**
 * ChatStore Tests — Message Management & Streaming
 *
 * Verifies that messages are added, streaming content accumulates,
 * and finishStreaming correctly finalizes messages.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from '../chatStore';
import type { Message } from '../../types';

describe('chatStore — Message & Streaming', () => {
  beforeEach(() => {
    useChatStore.getState().clearMessages();
  });

  describe('Initial State', () => {
    it('should have empty messages array', () => {
      expect(useChatStore.getState().messages).toEqual([]);
    });

    it('should have empty streamingContent', () => {
      expect(useChatStore.getState().streamingContent).toBe('');
    });

    it('should not be streaming initially', () => {
      expect(useChatStore.getState().isStreaming).toBe(false);
    });
  });

  describe('addMessage', () => {
    it('should add a user message to the list', () => {
      const msg: Message = {
        id: 'test-1',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      };

      useChatStore.getState().addMessage(msg);

      expect(useChatStore.getState().messages).toHaveLength(1);
      expect(useChatStore.getState().messages[0]).toEqual(msg);
    });

    it('should add multiple messages in order', () => {
      const msg1: Message = {
        id: 'test-1',
        role: 'user',
        content: 'First',
        timestamp: 1000,
      };
      const msg2: Message = {
        id: 'test-2',
        role: 'assistant',
        content: 'Second',
        timestamp: 2000,
      };

      useChatStore.getState().addMessage(msg1);
      useChatStore.getState().addMessage(msg2);

      expect(useChatStore.getState().messages).toHaveLength(2);
      expect(useChatStore.getState().messages[0].content).toBe('First');
      expect(useChatStore.getState().messages[1].content).toBe('Second');
    });
  });

  describe('startStreaming', () => {
    it('should set isStreaming to true', () => {
      useChatStore.getState().startStreaming();
      expect(useChatStore.getState().isStreaming).toBe(true);
    });

    it('should clear streamingContent', () => {
      useChatStore.getState().appendStreamingContent('partial');
      useChatStore.getState().startStreaming();
      expect(useChatStore.getState().streamingContent).toBe('');
    });
  });

  describe('appendStreamingContent', () => {
    it('should append text to streaming content', () => {
      useChatStore.getState().startStreaming();
      useChatStore.getState().appendStreamingContent('Hello');
      useChatStore.getState().appendStreamingContent(' World');

      expect(useChatStore.getState().streamingContent).toBe('Hello World');
    });

    it('should handle empty string append', () => {
      useChatStore.getState().startStreaming();
      useChatStore.getState().appendStreamingContent('');

      expect(useChatStore.getState().streamingContent).toBe('');
    });
  });

  describe('finishStreaming', () => {
    it('should create a message from accumulated streaming content', () => {
      useChatStore.getState().startStreaming();
      useChatStore.getState().appendStreamingContent('AI response');

      const result = useChatStore.getState().finishStreaming('assistant');

      expect(result).not.toBeNull();
      expect(result?.role).toBe('assistant');
      expect(result?.content).toBe('AI response');

      // Message should be added to the messages array
      expect(useChatStore.getState().messages).toHaveLength(1);
      expect(useChatStore.getState().messages[0].content).toBe('AI response');
    });

    it('should generate a unique id for the finalized message', () => {
      useChatStore.getState().startStreaming();
      useChatStore.getState().appendStreamingContent('Test');

      const result = useChatStore.getState().finishStreaming('assistant');

      expect(result?.id).toBeTruthy();
      expect(typeof result?.id).toBe('string');
    });

    it('should clear streaming state after finishing', () => {
      useChatStore.getState().startStreaming();
      useChatStore.getState().appendStreamingContent('Test');

      useChatStore.getState().finishStreaming('assistant');

      expect(useChatStore.getState().isStreaming).toBe(false);
      expect(useChatStore.getState().streamingContent).toBe('');
    });

    it('should return null when streaming content is empty', () => {
      useChatStore.getState().startStreaming();

      const result = useChatStore.getState().finishStreaming('assistant');

      expect(result).toBeNull();
      expect(useChatStore.getState().isStreaming).toBe(false);
    });
  });

  describe('clearMessages', () => {
    it('should clear all messages', () => {
      const msg: Message = {
        id: 'test-1',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      };
      useChatStore.getState().addMessage(msg);

      useChatStore.getState().clearMessages();

      expect(useChatStore.getState().messages).toEqual([]);
    });

    it('should reset streaming state', () => {
      useChatStore.getState().startStreaming();
      useChatStore.getState().appendStreamingContent('partial');

      useChatStore.getState().clearMessages();

      expect(useChatStore.getState().isStreaming).toBe(false);
      expect(useChatStore.getState().streamingContent).toBe('');
    });
  });
});
