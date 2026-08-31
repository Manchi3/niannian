/**
 * Animated voice waveform — a soft sine-like line that drifts while the user
 * is holding the voice button. Compact enough to fit inside the input pill.
 */
export default function VoiceWaveform(): React.ReactElement {
  return (
    <div
      className="pointer-events-none relative flex items-center justify-center"
      style={{ width: '40px', height: '20px' }}
      aria-hidden="true"
    >
      <svg
        width="40"
        height="20"
        viewBox="0 0 40 20"
        fill="none"
        className="voice-waveform"
      >
        <path
          d="M0 10 Q 10 4, 20 10 T 40 10"
          stroke="rgba(212, 168, 83, 0.9)"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M0 10 Q 10 16, 20 10 T 40 10"
          stroke="rgba(232, 221, 208, 0.6)"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      <span
        className="absolute h-1.5 w-1.5 rounded-full"
        style={{
          background: '#d4a853',
          animation: 'voice-dot-pulse 1s ease-in-out infinite',
        }}
      />
    </div>
  );
}
