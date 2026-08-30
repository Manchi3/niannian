/**
 * AppStore Tests — State Machine Transitions
 *
 * Verifies that the application phase (state machine) transitions
 * correctly through all defined phases, and that store actions
 * properly update state.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../appStore';
import type { AppPhase } from '../../types';

describe('appStore — State Machine', () => {
  beforeEach(() => {
    // Reset to initial state before each test
    useAppStore.getState().reset();
    useAppStore.setState({
      currentImageDataUrl: null,
      currentImageBlob: null,
    });
  });

  describe('Initial State', () => {
    it('should start in the idle phase', () => {
      expect(useAppStore.getState().phase).toBe('idle');
    });

    it('should have isLoading = false initially', () => {
      expect(useAppStore.getState().isLoading).toBe(false);
    });

    it('should have errorMessage = null initially', () => {
      expect(useAppStore.getState().errorMessage).toBe(null);
    });

    it('should have no current image data initially', () => {
      expect(useAppStore.getState().currentImageDataUrl).toBe(null);
      expect(useAppStore.getState().currentImageBlob).toBe(null);
    });
  });

  describe('Phase Transitions', () => {
    const phases: AppPhase[] = [
      'idle',
      'uploading',
      'particle',
      'chatting',
      'condensing',
      'diary',
      'saved',
      'reviewing',
    ];

    it.each(phases)('should transition to phase "%s"', (targetPhase) => {
      useAppStore.getState().setPhase(targetPhase);
      expect(useAppStore.getState().phase).toBe(targetPhase);
    });

    it('should clear error message when transitioning phases', () => {
      useAppStore.getState().setError('Some error');
      expect(useAppStore.getState().errorMessage).toBe('Some error');

      useAppStore.getState().setPhase('uploading');
      expect(useAppStore.getState().errorMessage).toBe(null);
    });

    it('should support the full lifecycle: idle → uploading → particle → chatting → condensing → diary → saved', () => {
      const { setPhase } = useAppStore.getState();

      setPhase('uploading');
      expect(useAppStore.getState().phase).toBe('uploading');

      setPhase('particle');
      expect(useAppStore.getState().phase).toBe('particle');

      setPhase('chatting');
      expect(useAppStore.getState().phase).toBe('chatting');

      setPhase('condensing');
      expect(useAppStore.getState().phase).toBe('condensing');

      setPhase('diary');
      expect(useAppStore.getState().phase).toBe('diary');

      setPhase('saved');
      expect(useAppStore.getState().phase).toBe('saved');
    });
  });

  describe('Loading State', () => {
    it('should set isLoading to true', () => {
      useAppStore.getState().setLoading(true);
      expect(useAppStore.getState().isLoading).toBe(true);
    });

    it('should set isLoading to false', () => {
      useAppStore.getState().setLoading(true);
      useAppStore.getState().setLoading(false);
      expect(useAppStore.getState().isLoading).toBe(false);
    });
  });

  describe('Error State', () => {
    it('should set an error message', () => {
      useAppStore.getState().setError('Test error');
      expect(useAppStore.getState().errorMessage).toBe('Test error');
    });

    it('should clear error message with null', () => {
      useAppStore.getState().setError('Test error');
      useAppStore.getState().setError(null);
      expect(useAppStore.getState().errorMessage).toBe(null);
    });
  });

  describe('Image Management', () => {
    it('should set current image data', () => {
      const dataUrl = 'data:image/png;base64,abc123';
      const blob = new Blob(['test'], { type: 'image/png' });

      useAppStore.getState().setCurrentImage(dataUrl, blob);

      expect(useAppStore.getState().currentImageDataUrl).toBe(dataUrl);
      expect(useAppStore.getState().currentImageBlob).toBe(blob);
    });

    it('should clear current image data', () => {
      const dataUrl = 'data:image/png;base64,abc123';
      const blob = new Blob(['test'], { type: 'image/png' });

      useAppStore.getState().setCurrentImage(dataUrl, blob);
      useAppStore.getState().clearCurrentImage();

      expect(useAppStore.getState().currentImageDataUrl).toBe(null);
      expect(useAppStore.getState().currentImageBlob).toBe(null);
    });
  });

  describe('Reset', () => {
    it('should reset to initial idle state', () => {
      // Mess up the state
      useAppStore.getState().setPhase('chatting');
      useAppStore.getState().setLoading(true);
      useAppStore.getState().setError('Some error');

      // Reset
      useAppStore.getState().reset();

      expect(useAppStore.getState().phase).toBe('idle');
      expect(useAppStore.getState().isLoading).toBe(false);
      expect(useAppStore.getState().errorMessage).toBe(null);
    });
  });

  // ---------------------------------------------------------------------------
  // Round 20: textDisplayMode (full | single | hidden)
  // ---------------------------------------------------------------------------
  describe('textDisplayMode', () => {
    beforeEach(() => {
      // Round Auth: the key is now uid-namespaced (guest by default in tests).
      window.localStorage.removeItem('nn_guest_textDisplayMode');
      useAppStore.setState({ textDisplayMode: 'full' });
    });

    it('should default to "full" when nothing is stored', () => {
      expect(useAppStore.getState().textDisplayMode).toBe('full');
    });

    it('should set and persist the mode', () => {
      useAppStore.getState().setTextDisplayMode('single');
      expect(useAppStore.getState().textDisplayMode).toBe('single');
      expect(window.localStorage.getItem('nn_guest_textDisplayMode')).toBe('single');
    });

    it('should support all three modes and persist each', () => {
      useAppStore.getState().setTextDisplayMode('full');
      expect(useAppStore.getState().textDisplayMode).toBe('full');
      useAppStore.getState().setTextDisplayMode('single');
      expect(useAppStore.getState().textDisplayMode).toBe('single');
      useAppStore.getState().setTextDisplayMode('hidden');
      expect(useAppStore.getState().textDisplayMode).toBe('hidden');
      expect(window.localStorage.getItem('nn_guest_textDisplayMode')).toBe('hidden');
    });

    it('should migrate old "subtitle" stored value to "single" on load', async () => {
      // Simulate a Round-18-era stored value (under the guest namespace).
      window.localStorage.setItem('nn_guest_textDisplayMode', 'subtitle');
      // Re-import the module fresh so its initializer re-runs
      vi.resetModules();
      const mod = await import('../appStore');
      expect(mod.useAppStore.getState().textDisplayMode).toBe('single');
    });

    it('should ignore unknown stored values and fall back to "full"', async () => {
      window.localStorage.setItem('nn_guest_textDisplayMode', 'bogus-mode');
      vi.resetModules();
      const mod = await import('../appStore');
      expect(mod.useAppStore.getState().textDisplayMode).toBe('full');
    });

    it('should re-read the current uid prefs via reloadLocalPrefs', () => {
      window.localStorage.setItem('nn_guest_textDisplayMode', 'single');
      useAppStore.getState().reloadLocalPrefs();
      expect(useAppStore.getState().textDisplayMode).toBe('single');
    });
  });
});
