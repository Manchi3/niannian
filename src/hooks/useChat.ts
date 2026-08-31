import { useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import { useChatStore } from '../stores/chatStore';
import { chat as chatApi } from '../services/api';
import { generateId } from '../utils/helpers';
import type { Message } from '../types';

/**
 * useChat — encapsulates chat send + streaming receive logic.
 *
 * Coordinates between chatStore (state) and api.ts (network),
 * managing the streaming lifecycle: start → append chunks → finish.
 */
export function useChat() {
  const { setPhase, currentImageDataUrl, setError } = useAppStore();
  const {
    messages,
    addMessage,
    startStreaming,
    appendStreamingContent,
    finishStreaming,
    setImageDescription,
    isStreaming,
  } = useChatStore();

  /**
   * Send a message and receive the AI's streamed response.
   *
   * If `imageDataUrl` is provided (first greeting), it's sent as imageBase64.
   * If `text` is empty and imageDataUrl is provided, this is the initial greeting.
   *
   * @param text — The user's message text (empty for initial greeting)
   * @param imageDataUrl — Optional image data URL for the first message
   */
  const sendMessage = useCallback(
    async (text: string, imageDataUrl?: string) => {
      console.log('[useChat] sendMessage called', { text: text.slice(0, 50), hasImage: !!imageDataUrl, messagesLen: messages.length });
      // Clear any previous error before starting a new request
      setError(null);

      // If there's user text, add it as a message first
      if (text.trim()) {
        const userMessage: Message = {
          id: generateId(),
          role: 'user',
          content: text.trim(),
          timestamp: Date.now(),
        };
        addMessage(userMessage);
      }

      // Build the messages array for the API (exclude the new user message if we just added it)
      // The API expects all prior messages so the AI has context
      const apiMessages = text.trim()
        ? [
            ...messages,
            { role: 'user' as const, content: text.trim() },
          ].map((m) => ({ role: m.role, content: m.content }))
        : messages.map((m) => ({ role: m.role, content: m.content }));

      // Start streaming
      startStreaming();
      console.log('[useChat] startStreaming called, isStreaming should be true now');

      // Determine if this is the initial greeting (with image)
      const isGreeting = !!imageDataUrl && messages.length === 0 && !text.trim();
      console.log('[useChat] isGreeting:', isGreeting);

      // If this is the greeting and we have an image, don't send any messages
      // (the server will construct the prompt from the system prompt + image)
      const requestMessages = isGreeting
        ? []
        : apiMessages;

      console.log('[useChat] calling chatApi with', { messagesLen: requestMessages.length, hasImage: !!imageDataUrl, imageDataUrlLen: imageDataUrl?.length });

      try {
        await chatApi(
          {
            messages: requestMessages,
            imageBase64: imageDataUrl,
          },
          // onChunk
          (chunkText) => {
            console.log('[useChat] onChunk:', chunkText.slice(0, 50));
            appendStreamingContent(chunkText);
          },
          // onDone
          () => {
            console.log('[useChat] onDone called');
            const finalMessage = finishStreaming('assistant');
            console.log('[useChat] finishStreaming returned:', finalMessage ? `message(${finalMessage.content.slice(0, 50)})` : 'null');
            if (finalMessage) {
              // Transition to chatting phase if we were in particle phase
              const currentPhase = useAppStore.getState().phase;
              console.log('[useChat] current phase:', currentPhase);
              if (currentPhase === 'particle' || currentPhase === 'uploading') {
                setPhase('chatting');
              }
            }
          },
          // onError
          (errorMessage) => {
            console.error('[useChat] onError:', errorMessage);
            finishStreaming('assistant'); // Save whatever we got
            setError(errorMessage);
            console.error('[useChat] Stream error:', errorMessage);
          },
          // onImageDescription — stash it so the diary step can use the photo
          (description) => {
            setImageDescription(description);
          },
        );
      } catch (err) {
        console.error('[useChat] caught error:', err);
        const message = err instanceof Error ? err.message : '发送消息时出错';
        setError(message);
        finishStreaming('assistant');
      }
    },
    [
      messages,
      addMessage,
      startStreaming,
      appendStreamingContent,
      finishStreaming,
      setImageDescription,
      setPhase,
      setError,
    ],
  );

  /**
   * Reset the chat — clear all messages and streaming state.
   */
  const resetChat = useCallback(() => {
    useChatStore.getState().clearMessages();
  }, []);

  return {
    sendMessage,
    resetChat,
    isStreaming,
    messages,
  };
}
