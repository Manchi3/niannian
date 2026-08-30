import { create } from 'zustand';
import { generateId } from '../utils/helpers';
import type { Message } from '../types';

/**
 * Chat state managed by Zustand.
 *
 * Holds the full message list plus streaming state for real-time
 * typewriter-like AI response rendering.
 */
interface ChatState {
  /** All messages in the conversation (user + assistant). */
  messages: Message[];
  /** Text accumulated during the current streaming response. */
  streamingContent: string;
  /** Whether a streaming response is in progress. */
  isStreaming: boolean;

  /** Append a complete message to the list. */
  addMessage: (msg: Message) => void;
  /** Begin a new streaming session (clears streamingContent, sets isStreaming). */
  startStreaming: () => void;
  /** Append a text chunk to the current streaming content. */
  appendStreamingContent: (text: string) => void;
  /** Finalize streaming: creates a complete Message and clears streaming state. */
  finishStreaming: (role?: 'assistant') => Message | null;
  /** Mark a message as having completed its typewriter reveal (Round 23). */
  markTyped: (msgId: string) => void;
  /** Clear all messages and streaming state. */
  clearMessages: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  streamingContent: '',
  isStreaming: false,

  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),

  startStreaming: () => set({ streamingContent: '', isStreaming: true }),

  appendStreamingContent: (text) =>
    set((state) => ({ streamingContent: state.streamingContent + text })),

  finishStreaming: (role = 'assistant') => {
    const { streamingContent } = get();
    if (!streamingContent) {
      set({ isStreaming: false, streamingContent: '' });
      return null;
    }
    const message: Message = {
      id: generateId(),
      role,
      content: streamingContent,
      timestamp: Date.now(),
    };
    set((state) => ({
      messages: [...state.messages, message],
      streamingContent: '',
      isStreaming: false,
    }));
    return message;
  },

  markTyped: (msgId) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === msgId ? { ...m, typed: true } : m,
      ),
    })),

  clearMessages: () => set({ messages: [], streamingContent: '', isStreaming: false }),
}));
