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
  /**
   * MiMo description of the uploaded photo, emitted by the server before the
   * first greeting chunk. Stored so `condense()` can replay it — otherwise the
   * diary is written without knowing what the picture showed.
   */
  imageDescription: string | null;
  /**
   * Live transcript of the current voice input. Rendered as a draft user
   * bubble while the user is holding the voice button / spacebar.
   */
  voiceTranscript: string;
  /** Whether the user is currently holding voice input (recording). */
  isVoiceRecording: boolean;
  /** Briefly true when voice input ended with no speech detected. */
  showVoiceEmpty: boolean;

  /** Append a complete message to the list. */
  addMessage: (msg: Message) => void;
  /** Store the MiMo photo description for the later condense call. */
  setImageDescription: (description: string) => void;
  /** Update the live voice transcript shown in the draft bubble. */
  setVoiceTranscript: (text: string) => void;
  /** Set whether voice recording is active. */
  setVoiceRecording: (recording: boolean) => void;
  /** Show/hide the 'no speech detected' empty state in the voice bar. */
  setShowVoiceEmpty: (show: boolean) => void;
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
  imageDescription: null,
  voiceTranscript: '',
  isVoiceRecording: false,
  showVoiceEmpty: false,

  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),

  setImageDescription: (description) => set({ imageDescription: description }),

  setVoiceTranscript: (text) => set({ voiceTranscript: text }),

  setVoiceRecording: (recording) => set({ isVoiceRecording: recording }),

  setShowVoiceEmpty: (show) => set({ showVoiceEmpty: show }),

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

  clearMessages: () =>
    set({
      messages: [],
      streamingContent: '',
      isStreaming: false,
      imageDescription: null,
      voiceTranscript: '',
      isVoiceRecording: false,
      showVoiceEmpty: false,
    }),
}));
