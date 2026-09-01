import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Minimal SpeechRecognition type for the browser Web Speech API.
 * Falls back to `any` if the global type is unavailable.
 */
type SpeechRecognitionCtor =
  | (typeof window extends { SpeechRecognition: infer R } ? R : never)
  | (typeof window extends { webkitSpeechRecognition: infer R } ? R : never);

interface MinimalSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: MinimalSpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface MinimalSpeechRecognitionEvent {
  /** Index of the first NEW result in `results` — older entries have already
   *  been delivered in prior `onresult` callbacks. Honoring this kills the
   *  "one sentence recognized twice" bug some Chrome builds produce (they
   *  repeatedly re-emit the same `isFinal` result inside a continuous
   *  session, causing string concatenation to duplicate text). */
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: { transcript: string };
    };
  };
}

/**
 * React hook for the browser's built-in Web Speech API.
 *
 * Provides start / stop / abort and calls back with interim + final
 * transcripts. The parent is responsible for silence detection and for
 * persisting the final transcript into chat history.
 */
interface UseSpeechRecognitionOptions {
  /** Called every time the transcript updates (interim or final). */
  onTranscript?: (text: string) => void;
  /** Called once when recognition ends, with the accumulated final text. */
  onEnd?: (finalText: string) => void;
  /** Called when a recognition error occurs. */
  onError?: (error: string) => void;
}

export function useSpeechRecognition({
  onTranscript,
  onEnd,
  onError,
}: UseSpeechRecognitionOptions = {}) {
  const recognitionRef = useRef<MinimalSpeechRecognition | null>(null);
  const finalRef = useRef('');
  const abortedRef = useRef(false);
  const [isSupported, setIsSupported] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  // Detect support once on mount.
  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (Ctor) {
      setIsSupported(true);
    }
  }, []);

  const startRecording = useCallback(() => {
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;

    // Reset accumulated final text for a fresh recording.
    finalRef.current = '';
    abortedRef.current = false;

    const recognition = new (Ctor as unknown as {
      new (): MinimalSpeechRecognition;
    })();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: MinimalSpeechRecognitionEvent) => {
      let interim = '';
      // Iterate ONLY the freshly delivered slice. Older results were already
      // counted in `finalRef.current` — re-counting them doubled the text in
      // some Chrome continuous-mode builds.
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalRef.current += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      onTranscript?.(finalRef.current + interim);
    };

    recognition.onend = () => {
      setIsRecording(false);
      // If the session was aborted (e.g. ESC), do not treat this as a final
      // completion; the caller already reset its UI state.
      if (abortedRef.current) {
        abortedRef.current = false;
        return;
      }
      onEnd?.(finalRef.current.trim());
    };

    recognition.onerror = (event: { error: string; message?: string }) => {
      // 'aborted' is expected when the user manually cancels; 'no-speech'
      // means the microphone was active but nothing was recognized.
      if (event.error !== 'aborted') {
        onError?.(event.error);
      }
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    setIsRecording(true);
    try {
      recognition.start();
    } catch {
      setIsRecording(false);
    }
  }, [onTranscript, onEnd, onError]);

  const stopRecording = useCallback(() => {
    const recognition = recognitionRef.current;
    if (recognition && isRecording) {
      try {
        recognition.stop();
      } catch {
        // Already stopped or not started.
      }
    }
    recognitionRef.current = null;
    // If stop() does not fire onend synchronously, force state reset.
    setIsRecording(false);
  }, [isRecording]);

  const abortRecording = useCallback(() => {
    abortedRef.current = true;
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.abort();
      } catch {
        // Ignore.
      }
    }
    recognitionRef.current = null;
    finalRef.current = '';
    setIsRecording(false);
  }, []);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      const recognition = recognitionRef.current;
      if (recognition) {
        try {
          recognition.abort();
        } catch {
          // Ignore.
        }
      }
    };
  }, []);

  return {
    isSupported,
    isRecording,
    startRecording,
    stopRecording,
    abortRecording,
  };
}
