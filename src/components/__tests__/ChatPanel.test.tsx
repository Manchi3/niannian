import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, waitFor, cleanup } from '@testing-library/react';
import ChatPanel from '../ChatPanel';
import { useChatStore } from '../../stores/chatStore';
import { useAppStore } from '../../stores/appStore';
import type { Message } from '../../types';

/**
 * Round 64 — render-layer regression tests.
 *
 * The bug: ChatPanel used to SKIP the newest user message whenever
 * `isVoiceRecording || voiceTranscript` was truthy (a Round-61 de-dup hack so
 * the live voice draft wouldn't sit on top of the just-sent bubble). Because a
 * stale `voiceTranscript` could survive a release, that condition stayed true
 * forever — which hid every following message, keyboard ones included, until
 * an AI reply pushed it out of the "last message" slot. Hence the reported
 * "my typed message only appears after the AI answers".
 *
 * The contract now: the stream renders the store's messages verbatim, and the
 * draft bubble exists only while the microphone is genuinely open.
 */

vi.mock('../../utils/audioMeter', () => ({
  startAudioMeter: vi.fn(async () => {}),
  stopAudioMeter: vi.fn(),
  getAudioLevel: () => 0.4,
  getAudioEnv: () => 0,
  getAudioRms: () => 0,
  getWaveform: (n: number) => new Array(n).fill(0),
  isAudioMeterActive: () => false,
}));

function msg(id: string, role: 'user' | 'assistant', content: string): Message {
  return { id, role, content, timestamp: Date.now(), typed: true };
}

beforeEach(() => {
  useAppStore.setState({ textDisplayMode: 'full' });
  useChatStore.setState({
    messages: [],
    streamingContent: '',
    isStreaming: false,
    voiceTranscript: '',
    isVoiceRecording: false,
    showVoiceEmpty: false,
  });
});

afterEach(() => {
  cleanup();
});

describe('ChatPanel — R64 message stream / voice draft contract', () => {
  it('paints a newly appended user message immediately (no AI reply needed)', () => {
    useChatStore.setState({ messages: [msg('a1', 'assistant', '在呢')] });
    render(<ChatPanel />);

    // Exactly what a keyboard send does: append synchronously, nothing else.
    act(() => {
      useChatStore.getState().addMessage(msg('u1', 'user', '打字发送的这句话'));
    });

    expect(screen.getByText('打字发送的这句话')).toBeInTheDocument();
    expect(useChatStore.getState().isStreaming).toBe(false);
  });

  it('still renders the newest user message when a stale transcript lingers', () => {
    // Simulates the poisoned state the old hack choked on: transcript left
    // over from a finished recording while NOT recording.
    useChatStore.setState({
      messages: [msg('u1', 'user', '语音发出去的这句话')],
      voiceTranscript: '语音发出去的这句话',
      isVoiceRecording: false,
    });
    render(<ChatPanel />);

    // One bubble — not zero (hidden by the hack), not two (bubble + draft).
    expect(screen.getAllByText('语音发出去的这句话')).toHaveLength(1);
  });

  it('shows the live draft only while recording, and drops it on release', async () => {
    render(<ChatPanel />);

    act(() => {
      useChatStore.setState({ isVoiceRecording: true, voiceTranscript: '正在说的话' });
    });
    expect(screen.getByText('正在说的话')).toBeInTheDocument();

    // Release: `recording` flips to false. Even with the transcript still in
    // the store for one tick, the draft must go.
    act(() => {
      useChatStore.setState({ isVoiceRecording: false });
    });
    await waitFor(() => {
      expect(screen.queryByText('正在说的话')).toBeNull();
    });
  });

  it('never shows two bubbles for one utterance across the release', async () => {
    render(<ChatPanel />);

    act(() => {
      useChatStore.setState({ isVoiceRecording: true, voiceTranscript: '一句话一个泡' });
    });
    expect(screen.getAllByText('一句话一个泡')).toHaveLength(1);

    // The real release: draft off + real message in, one batched update.
    act(() => {
      useChatStore.setState({ isVoiceRecording: false, voiceTranscript: '' });
      useChatStore.getState().addMessage(msg('u1', 'user', '一句话一个泡'));
    });

    await waitFor(() => {
      expect(screen.getAllByText('一句话一个泡')).toHaveLength(1);
    });
  });
});
