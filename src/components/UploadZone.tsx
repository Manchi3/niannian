import { useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { useAppStore } from '../stores/appStore';
import { validateImageFile, blobToDataUrl, blobToImage } from '../utils/helpers';
import { processImage, createThumbnail } from '../services/imageProcessor';
import { useChat } from '../hooks/useChat';
import type { ParticleData } from '../types';

/**
 * Props for the UploadZone component.
 */
interface UploadZoneProps {
  /** Callback invoked when particle data is generated from the uploaded image. */
  onParticleReady: (data: ParticleData) => void;
  /** Callback invoked when the image blob is ready (for diary save). */
  onImageBlobReady: (blob: Blob, thumbnail: Blob) => void;
}

/**
 * UploadZone — drag-and-drop / click-to-upload image input.
 *
 * Validates file type (JPG/PNG/WebP) and size (≤10MB),
 * processes the image into particle data, stores the blob,
 * and triggers the initial AI greeting.
 */
export default function UploadZone({
  onParticleReady,
  onImageBlobReady,
}: UploadZoneProps): React.ReactElement {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { setPhase, setCurrentImage } = useAppStore();
  const { sendMessage } = useChat();

  /**
   * Handle the selected image file: validate, process, and trigger AI greeting.
   */
  const handleFile = useCallback(
    async (file: File) => {
      setError(null);

      // Validate
      const validationError = validateImageFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }

      setIsProcessing(true);
      setPhase('uploading');

      try {
        // Convert to blob and data URL
        const dataUrl = await blobToDataUrl(file);
        setCurrentImage(dataUrl, file);

        // Load image element for processing
        const imageElement = await blobToImage(file);

        // Process into particle data
        const particleData = processImage(imageElement);
        onParticleReady(particleData);

        // Create thumbnail
        const thumbnail = await createThumbnail(file);
        onImageBlobReady(file, thumbnail);

        // Transition to particle phase
        setPhase('particle');

        // Trigger initial AI greeting with the image
        console.log('[UploadZone] About to call sendMessage with image, dataUrl length:', dataUrl.length);
        await sendMessage('', dataUrl);
        console.log('[UploadZone] sendMessage completed');
      } catch (err) {
        const message = err instanceof Error ? err.message : '处理图片时出错';
        setError(message);
        setPhase('idle');
      } finally {
        setIsProcessing(false);
      }
    },
    [setPhase, setCurrentImage, onParticleReady, onImageBlobReady, sendMessage],
  );

  /** Handle file input change. */
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      // Reset input so the same file can be selected again
      e.target.value = '';
    },
    [handleFile],
  );

  /** Handle drag events. */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  /** Trigger the file input dialog. */
  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.7, ease: 'easeOut' }}
      className="flex min-h-screen items-center justify-center px-6"
    >
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleClick();
        }}
        className={`
          relative flex flex-col items-center justify-center
          w-full max-w-md rounded-3xl border-2 border-dashed
          px-8 py-16 cursor-pointer transition-all duration-300
          ${
            isDragging
              ? 'border-gold bg-gold-soft scale-105'
              : 'border-glass-border hover:border-gold-muted hover:bg-white/5'
          }
        `}
        style={{
          borderColor: isDragging
            ? 'rgba(212, 168, 83, 0.8)'
            : 'rgba(255, 255, 255, 0.1)',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleInputChange}
          className="hidden"
        />

        {/* Upload icon */}
        {isProcessing ? (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
            className="mb-6 h-12 w-12 rounded-full border-2 border-gold-muted border-t-transparent"
          />
        ) : (
          <svg
            className="mb-6 h-12 w-12 text-gold"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 7.5m0 0L7.5 12m4.5-4.5v12"
            />
          </svg>
        )}

        {/* Label */}
        <p className="font-serif text-lg text-warm-white/80">
          {isProcessing ? '正在粒子化...' : '上传一张照片'}
        </p>
        <p className="mt-2 text-sm text-warm-white/40">
          {isProcessing ? '请稍候' : '拖拽或点击选择 · JPG / PNG / WebP · ≤10MB'}
        </p>

        {/* Error message */}
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 text-sm text-red-400"
          >
            {error}
          </motion.p>
        )}
      </div>
    </motion.div>
  );
}
