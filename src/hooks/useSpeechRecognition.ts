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
  /**
   * R63 semantics (important — read before touching):
   * this ref holds the identity of the CURRENT recognition session. It is
   *   - ASSIGNED  by startRecording()  (a new session supersedes the old one)
   *   - CLEARED   by abortRecording()  and by the unmount cleanup
   *   - **NOT** cleared by stopRecording()
   * That last point matters: `recognition.stop()` is asynchronous — Chrome
   * only fires `onend` once its speech service returns the final result,
   * which can take 300ms-1s+. So a deliberately stopped session MUST keep
   * its identity so the late onend still gets through and delivers the final
   * text — that is exactly how the 2.5s silence auto-stop sends the message.
   * Every callback therefore starts with an identity guard: a stale instance
   * whose onend lands after a newer session began (or after an abort) is
   * silently ignored instead of leaking a duplicate transcript.
   */
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
      // R63: identity guard — if a NEW session has superseded this instance
      // (or it was aborted), ignore the event. Otherwise an in-flight result
      // from a previous hold-release cycle would leak into the new session's
      // transcript, and its late onend would re-send the previous utterance.
      if (recognitionRef.current !== recognition) return;
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
      // R63: identity guard (see recognitionRef docs above). Blocks TWO cases:
      //   1. a newer session already started → this instance is stale;
      //   2. the session was aborted / the component unmounted.
      // A *deliberately stopped* session still passes (stopRecording no
      // longer clears the ref), so the silence auto-stop keeps working.
      if (recognitionRef.current !== recognition) return;
      // This session is over — release the identity so a later late event
      // from this same instance cannot deliver a second time.
      recognitionRef.current = null;
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
      if (recognitionRef.current !== recognition) return;
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
      // start() can throw if a session is already running. Drop the
      // identity so this dead instance can never deliver an onend.
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
      }
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
    // R63: deliberately NOT clearing recognitionRef here. `stop()` is
    // asynchronous — the session's `onend` must still be able to deliver the
    // final transcript (that is the ONLY send path for the 2.5s silence
    // auto-stop). The ref is released inside `onend` itself, or reassigned
    // by the next startRecording(), or nulled by abortRecording()/unmount.
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
