import { useState, useCallback, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

// Stores
import { useAppStore } from '../stores/appStore';
import { useChatStore } from '../stores/chatStore';
import { useDiaryStore } from '../stores/diaryStore';
import { useToastStore } from '../stores/toastStore';
import { useNavStore } from '../stores/navStore';
import { useReviewStore } from '../stores/reviewStore';

// Services
import { condense as condenseApi } from '../services/api';
import {
  processImageBlob,
  createThumbnail,
  processImage,
} from '../services/imageProcessor';

// Components
import ParticleCanvas from './ParticleCanvas';
import UploadZone from './UploadZone';
import ChatPanel from './ChatPanel';
import LoadingOverlay from './LoadingOverlay';
import DiaryView from './DiaryView';
import DiaryList from './DiaryList';
import DiaryEmptyState from './DiaryEmptyState';
import CustomCursor from './CustomCursor';
import AtmospherePanel from './AtmospherePanel';
import ViewTabs from './ViewTabs';
import TextDisplayButtons from './TextDisplayButtons';
import AuthEntry from './AuthEntry';
import CondensingOverlay from './CondensingOverlay';

// Hooks
import { useChat } from '../hooks/useChat';

// Config
import { CONFIG } from '../utils/constants';

// Types
import type { ParticleData, Diary, CondenseResponse } from '../types';

// Utils
import {
  generateId,
  formatDateISO,
  resolveDiaryTitle,
  validateImageFile,
  blobToDataUrl,
  blobToImage,
  isValidCondenseResult,
  buildFallbackDiary,
  isDiaryAcceptable,
} from '../utils/helpers';

/**
 * Round 28 (④): extract an uploaded image's dominant color by shrinking it
 * onto a 50×50 offscreen canvas and averaging the opaque pixels. Runs once
 * per image (called from an effect on currentImageDataUrl) — cheap, and
 * gives the background glow a color that echoes the photo's mood. base64
 * dataURLs are same-origin, so the canvas is never tainted.
 */
function extractDominantColor(src: string): Promise<{ r: number; g: number; b: number }> {
  return new Promise((resolve) => {
    const fallback = { r: 255, g: 255, b: 255 };
    const img = new Image();
    img.onload = () => {
      try {
        const size = 50;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(fallback);
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue; // skip transparent pixels
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count += 1;
        }
        if (count === 0) {
          resolve(fallback);
          return;
        }
        resolve({
          r: Math.round(r / count),
          g: Math.round(g / count),
          b: Math.round(b / count),
        });
      } catch {
        resolve(fallback);
      }
    };
    img.onerror = () => resolve(fallback);
    img.src = src;
  });
}

/**
 * ChatMainView — the existing chat / particle interaction page, extracted
 * verbatim from the Round 18–21 App.tsx.
 *
 * The body of this component is IDENTICAL to the prior App.tsx's chat
 * section (phase state machine, tabs, text-display modes, particle
 * background, atmosphere panel, etc.) — only the wrapping div moved
 * to the new top-level App router.
 */
export default function ChatMainView(): React.ReactElement {
  // --- Stores ---
  const {
    phase,
    isLoading,
    errorMessage,
    currentImageDataUrl,
    setPhase,
    setLoading,
    setError,
    reset,
    viewTab,
    setViewTab,
  } = useAppStore();

  const { messages, clearMessages } = useChatStore();
  const { saveDiary, setCurrentDiary, currentDiary, loadDiaries } = useDiaryStore();
  const showToast = useToastStore((s) => s.showToast);
  const { currentView } = useNavStore();
  const { sendMessage } = useChat();
  // Round 42: transient hand-off from the landing page's "继续上传".
  const setPendingImageFile = useAppStore((s) => s.setPendingImageFile);
  // Round 26 (bug③): subscribe to the pending file so the idle branch can
  // suppress the UploadZone flash while a picked photo is being consumed.
  const pendingImageFile = useAppStore((s) => s.pendingImageFile);
  // Review entry passes a "messages hidden until formed" flag; normal entries
  // leave it false → messages reveal immediately.
  const messageRevealPending = useAppStore((s) => s.messageRevealPending);

  // --- Local state ---
  const [particleData, setParticleData] = useState<ParticleData | null>(null);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [thumbnailBlob, setThumbnailBlob] = useState<Blob | null>(null);
  const [showList, setShowList] = useState(false);
  const [currentTime, setCurrentTime] = useState<string>('');
  const [atmosphereOpen, setAtmosphereOpen] = useState(false);
  const [isCondensing, setIsCondensing] = useState(false);
  // Round 28 (④): dominant color of the current photo, drives the ambient
  // background glow. null in text-only mode (no image).
  const [glowColor, setGlowColor] = useState<{ r: number; g: number; b: number } | null>(null);

  // Round 55: gate chat text strictly on `messageRevealPending` — DERIVED
  // synchronously, never via a laggy local boolean. While pending (review
  // entry) text is hidden from the FIRST paint; the moment the flag flips
  // false the bubbles fade in (staggered, see ChatPanel). This kills the old
  // flash-then-fade-out-then-in flicker that happened because a local
  // `msgsRevealed` stayed true across a non-remounting review click. The
  // picture always forms once at NORMAL speed, so the gate fires after the
  // full ASSEMBLE_DURATION.
  const messagesVisible = !messageRevealPending;
  // The ids of the history messages present when the gate opens — only these
  // get the staggered fade-in. Messages sent AFTER reveal appear instantly.
  const [revealIds, setRevealIds] = useState<string[]>([]);
  useEffect(() => {
    if (!messageRevealPending) {
      setRevealIds([]);
      return;
    }
    setRevealIds(useChatStore.getState().messages.map((m) => m.id));
    const delay = Math.round(CONFIG.ASSEMBLE_DURATION * 1000) + 150;
    const t = setTimeout(() => {
      useAppStore.setState({ messageRevealPending: false });
    }, delay);
    return () => clearTimeout(t);
  }, [messageRevealPending]);

  // --- Live clock ---
  useEffect(() => {
    const update = (): void => {
      const now = new Date();
      const h = now.getHours().toString().padStart(2, '0');
      const m = now.getMinutes().toString().padStart(2, '0');
      setCurrentTime(`${h}:${m}`);
    };
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, []);

  // Round 28 (④): when the current photo's data URL is set (a new image was
  // picked / round started), sample its dominant color once and drive the
  // ambient glow. Cleared to null when the image is removed (e.g. a fresh
  // round resets currentImageDataUrl), so the glow disappears with it.
  useEffect(() => {
    if (!currentImageDataUrl) {
      setGlowColor(null);
      return;
    }
    let alive = true;
    void extractDominantColor(currentImageDataUrl).then((c) => {
      if (alive) setGlowColor(c);
    });
    return () => {
      alive = false;
    };
  }, [currentImageDataUrl]);

  // --- Handlers ---

  const handleParticleReady = useCallback((data: ParticleData) => {
    setParticleData(data);
  }, []);

  const handleImageBlobReady = useCallback((blob: Blob, thumb: Blob) => {
    setImageBlob(blob);
    setThumbnailBlob(thumb);
  }, []);

  /**
   * Round 42: consume an image picked on the LANDING page ("继续上传" skips
   * the intermediate upload page). Mirrors UploadZone's file pipeline:
   * validate → dataURL → process particles → thumbnail → phase particle →
   * initial AI greeting. Runs once on mount when a pending file exists.
   */
  const handlePendingUpload = useCallback(
    async (file: File) => {
      const validationError = validateImageFile(file);
      if (validationError) {
        showToast(validationError, { kind: 'error', duration: 4000 });
        return;
      }
      try {
        // Round 26 (bug③): raise the loading veil immediately so the upload
        // card (idle UploadZone) never flashes for a frame while the picked
        // photo is being processed — the screen stays covered until particles
        // are ready.
        setLoading(true);
        const dataUrl = await blobToDataUrl(file);
        useAppStore.getState().setCurrentImage(dataUrl, file);
        const imageElement = await blobToImage(file);
        const particleData = processImage(imageElement);
        setParticleData(particleData);
        const thumbnail = await createThumbnail(file);
        setImageBlob(file);
        setThumbnailBlob(thumbnail);
        setPhase('particle');
        // Particles are ready — drop the veil so the canvas + greeting show.
        setLoading(false);
        await sendMessage('', dataUrl);
      } catch (err) {
        const message = err instanceof Error ? err.message : '处理图片时出错';
        setError(message);
        setLoading(false);
        showToast(message, { kind: 'error', duration: 4000 });
      }
    },
    [setPhase, setError, setLoading, showToast, sendMessage],
  );

  // Consume the pending file as soon as this view mounts (idle phase).
  useEffect(() => {
    if (phase !== 'idle') return;
    const pending = useAppStore.getState().pendingImageFile;
    if (!pending) return;
    setPendingImageFile(null);
    void handlePendingUpload(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const handleSendMessage = useCallback(
    (text: string) => {
      sendMessage(text);
    },
    [sendMessage],
  );

  /**
   * Round 29 condense rework (③ reliability + ⑤ same-round replace):
   *   1. Condense from the FULL, fresh chat history of the round (never a
   *      slice) — see baseCallMessages below.
   *   2. Attempt loop: initial call + up to 2 auto-retries. On retry we feed
   *      the failure reason back into the prompt so the model self-corrects.
   *      Timeouts (60s hard limit each) are retried too.
   *   3. Relaxed gate (isDiaryAcceptable): only first-person + ≥40 chars —
   *      the old over-strict forbidden-word regex is gone, so a normal
   *      first-person diary is never mis-flagged.
   *   4. Toast mutex: only if ALL attempts fail do we fall back to a local
   *      template + a single failure toast — success and failure toasts can
   *      never stack.
   *   5. Ordering guarantee: write to the DB succeeds FIRST, then switch to
   *      the 日记 tab (no "jump-then-blank" race). Same conversationId
   *      replaces the existing diary in place (⑤).
   */
  const handleCondense = useCallback(async () => {
    if (isCondensing) return;
    setIsCondensing(true);
    setLoading(true);
    try {
      // Round 29 (⑤): always condense from the FULL, fresh chat history of
      // this round — never a slice.
      //
      // The image context is NOT embedded in the conversation: the MiMo
      // description lives in the greeting's system prompt, which the condense
      // call swaps out. So we replay it explicitly — it was stashed in
      // chatStore when the server emitted it over SSE.
      const fullMessages = useChatStore.getState().messages;
      const imageDescription = useChatStore.getState().imageDescription ?? undefined;
      const baseCallMessages = fullMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // --- Attempt loop: initial call + up to 2 retries (auto-retry) ---
      // Round 29 (③): relaxed gate (first-person + ≥40 chars) replaces the
      // old over-strict forbidden-word regex. On retry we feed the failure
      // reason back into the prompt so the model self-corrects. Timeouts are
      // retried too (60s hard limit each). Only if ALL attempts fail do we
      // fall back to a local template + a single failure toast — so success
      // and failure toasts can never stack.
      let result: CondenseResponse | null = null;
      let lastReason = '结果不合格';
      for (let attempt = 0; attempt < 3; attempt++) {
        // On retry, append a self-correction hint as a trailing user turn
        // (the persona / 语气 prompt is untouched — SYSTEM_PROMPT_CONDENSE
        // stays exactly as-is).
        const callMessages =
          attempt === 0
            ? baseCallMessages
            : [
                ...baseCallMessages,
                {
                  role: 'user',
                  content:
                    `【格式复核】上一次凝聚结果不合格（原因：${lastReason}）。` +
                    `请严格用第一人称（全文只能出现"我"）、150-220 字、3-4 个短段，` +
                    `要有具体感官细节（光线、动作、身体感觉、身边的物件），` +
                    `写成"我"写给自己的私密日记，不要出现"聊起 / 「」 / 你说 / 我们 / 咱们"等转述句式，` +
                    `直接输出 JSON {title, content}。`,
                },
              ];
        try {
          const candidate = await condenseApi(callMessages, 60000, imageDescription);
          if (!isValidCondenseResult(candidate)) {
            lastReason = '结果不完整（缺少标题或正文）';
            console.warn(
              `[ChatMainView] condense attempt ${attempt + 1} incomplete, retrying…`,
              candidate,
            );
            continue;
          }
          // Relaxed gate: only first-person + length ≥ 40.
          if (!isDiaryAcceptable(candidate.content)) {
            lastReason = (candidate.content ?? '').trim().length < 40
              ? '内容太短（不足 40 字）'
              : '缺少第一人称（我 / 咱们）';
            console.warn(
              `[ChatMainView] condense attempt ${attempt + 1} failed relaxed gate, retrying…`,
            );
            continue;
          }
          result = candidate;
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg === 'condense_timeout') {
            lastReason = '生成超时';
            console.warn(`[ChatMainView] condense attempt ${attempt + 1} timed out, retrying…`);
            continue; // retry up to 2 more times
          }
          lastReason = '生成出错';
          console.warn(`[ChatMainView] condense attempt ${attempt + 1} failed:`, msg);
          // other errors also retry
        }
      }

      // --- Fallback (only when every attempt failed) ---
      if (!result) {
        result = buildFallbackDiary(fullMessages);
        showToast('这次记忆没能凝成日记，已为你留一份安静的备份', {
          kind: 'error',
          duration: 3500,
        });
      }

      const resolvedTitle = resolveDiaryTitle(result.title, fullMessages);
      let thumbnail = thumbnailBlob;
      if (!thumbnail && imageBlob) {
        thumbnail = await createThumbnail(imageBlob);
        setThumbnailBlob(thumbnail);
      }
      const now = Date.now();
      // Round 29 (⑤): same conversationId replaces the existing diary in
      // place — keep its id / createdAt / imageRef so the list never grows
      // with duplicate entries for one round. A brand-new round (different
      // conversationId) gets a fresh diary.
      const currentConversationId = useAppStore.getState().conversationId;
      const existing = useDiaryStore.getState().diaryList.find(
        (d) => d.conversationId === currentConversationId,
      );
      // Round 41: original image no longer lives on the record — the store
      // routes it through OPFS (imageRef) and keeps only the thumbnail.
      const diary: Diary = {
        _schemaVersion: 2,
        id: existing?.id ?? generateId(),
        conversationId: currentConversationId,
        title: resolvedTitle,
        date: formatDateISO(now),
        content: result.content ?? '',
        chatHistory: [...fullMessages],
        thumbnailBlob: thumbnail ?? new Blob(),
        imageRef: existing?.imageRef ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      // 先写库成功，再跳转日记 tab（杜绝"先跳后空"）
      await saveDiary(diary, imageBlob ?? null);
      setCurrentDiary(diary);
      setViewTab('diary');
      showToast(`已凝聚为日记《${resolvedTitle}》`, { kind: 'success', duration: 3500 });
    } catch (err) {
      const message = err instanceof Error ? err.message : '凝聚失败，请重试';
      setError(message);
      showToast(message, { kind: 'error', duration: 4000 });
    } finally {
      setIsCondensing(false);
      setLoading(false);
    }
  }, [
    isCondensing, imageBlob, thumbnailBlob,
    setCurrentDiary, saveDiary, setViewTab, setLoading, setError, showToast,
  ]);

  const handleSaveDiary = useCallback(async () => {
    const diary = useDiaryStore.getState().currentDiary;
    if (!diary) return;
    setLoading(true);
    try {
      await saveDiary(diary);
      showToast('修改已保存', { kind: 'success', duration: 2500 });
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存失败';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [saveDiary, setLoading, setError, showToast]);

  const handleDiaryEdit = useCallback(
    (updates: { title: string; content: string }) => {
      useDiaryStore.getState().updateCurrentDiary(updates);
    },
    [],
  );

  const handleNewDiary = useCallback(() => {
    setParticleData(null);
    setImageBlob(null);
    setThumbnailBlob(null);
    clearMessages();
    setCurrentDiary(null);
    setShowList(false);
    setViewTab('chat');
    reset();
  }, [clearMessages, setCurrentDiary, reset, setViewTab]);

  const handleRebuildParticles = useCallback(async () => {
    if (!imageBlob) return;
    setLoading(true);
    try {
      const data = await processImageBlob(imageBlob);
      setParticleData(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : '粒子重建失败';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [imageBlob, setLoading, setError]);

  const handleOpenList = useCallback(() => {
    setShowList(true);
    loadDiaries();
  }, [loadDiaries]);

  const handleCloseList = useCallback(() => {
    setShowList(false);
  }, []);

  const handleSelectDiary = useCallback(
    (diary: Diary) => {
      // 翻开日记 → 打开记忆手卷卡片弹窗（背景保留日记列表暗化）。
      setShowList(true);
      useReviewStore.getState().openCard(diary.id);
    },
    [setShowList],
  );

  // 重温：恢复会话时若已有图片但粒子尚未重建，从原图重铺粒子云，
  // 并把原图同步回本地 imageBlob，供后续再次凝聚时正确存图。
  // 正常上传流程自行 setParticleData，且上传瞬间 phase==='idle'，不会进入此分支。
  useEffect(() => {
    if (!currentImageDataUrl || particleData || phase === 'idle') return;
    const blob = useAppStore.getState().currentImageBlob;
    if (!blob) return;
    let alive = true;
    void processImageBlob(blob)
      .then((data) => {
        if (alive) {
          setParticleData(data);
          setImageBlob(blob);
        }
      })
      .catch((err) => console.error('[ChatMainView] restore particle failed:', err));
    return () => {
      alive = false;
    };
  }, [currentImageDataUrl, particleData, phase]);

  // --- Render ---

  const loadingMessage = (() => {
    switch (phase) {
      case 'uploading':
        return '正在粒子化...';
      case 'condensing':
        // Condensing never uses LoadingOverlay anymore (CondensingOverlay
        // takes over) — kept only for safety if it ever leaks through.
        return '正在凝聚记忆...';
      case 'particle':
        return 'AI正在看图...';
      default:
        return '请稍候...';
    }
  })();

  const particlesVisible = particleData !== null && phase !== 'idle';

  const inMainView =
    phase === 'particle' ||
    phase === 'chatting' ||
    phase === 'condensing' ||
    phase === 'diary' ||
    phase === 'saved';

  return (
    <div
      className="relative min-h-screen w-full overflow-hidden text-warm-white"
      style={{ background: '#080605' }}
    >
      {CONFIG.CUSTOM_CURSOR && <CustomCursor />}

      {/* Round 28 (④): ambient glow echoing the photo's dominant color.
          Rendered BEFORE the particle layer (both z-0 → DOM order puts the
          stardust on top) so the picture "glows faintly in the dark" behind
          the particles. Only present in image-chat mode. */}
      {glowColor && (
        <div
          className="image-glow"
          aria-hidden="true"
          style={{
            // Round 29 (②): spread the glow to near full-screen — ellipse
            // 130%×100% so the gradient overshoots the viewport and even the
            // corners keep a faint tint. Center stays subtle (max 0.16); the
            // color simply "floods" the whole screen, no hard edge. Transition
            // (1.5s) and the CSS class are unchanged.
            background: `radial-gradient(ellipse 130% 100% at 50% 45%, rgba(${glowColor.r}, ${glowColor.g}, ${glowColor.b}, 0.16) 0%, rgba(${glowColor.r}, ${glowColor.g}, ${glowColor.b}, 0.11) 25%, rgba(${glowColor.r}, ${glowColor.g}, ${glowColor.b}, 0.07) 45%, rgba(${glowColor.r}, ${glowColor.g}, ${glowColor.b}, 0.03) 65%, rgba(${glowColor.r}, ${glowColor.g}, ${glowColor.b}, 0.012) 82%, transparent 100%)`,
          }}
        />
      )}

      {/* Particle canvas — wrapped in a container-level layer so ALL dim /
          breathe / sway effects are plain CSS on the OUTER wrapper (red line:
          never touch the particle engine). The wrapper is position:fixed +
          inset:0 so the sway transform cannot collapse the fixed canvas. */}
      <AnimatePresence>
        {particleData && (phase !== 'idle') && (
          <div
            key="particle-layer"
            className={`particle-layer ${
              isCondensing
                ? 'particle-condensing'
                : viewTab === 'diary'
                  ? 'particle-dim'
                  : ''
            }`}
            style={{ position: 'fixed', inset: 0, zIndex: 0 }}
          >
            <ParticleCanvas particleData={particleData} active={true} />
          </div>
        )}
      </AnimatePresence>

      {particleData && phase !== 'idle' && (
        <div
          className="pointer-events-none fixed inset-0 z-[1]"
          style={{
            background:
              'radial-gradient(ellipse at center, rgba(0,0,0,0) 30%, rgba(8,6,5,0.55) 75%, rgba(8,6,5,0.92) 100%)',
          }}
          aria-hidden="true"
        />
      )}

      {/* Round 22: 日记 tab readability — dark veil between the (dimmed)
          particle layer and the diary text, pointer-transparent. */}
      {viewTab === 'diary' && inMainView && (
        <div
          className="pointer-events-none fixed inset-0 z-[1]"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          aria-hidden="true"
        />
      )}

      {/* Round 22: condensing center copy (⑤) — no spinner, no veil; the
          particle wrapper above carries the breathe/sway CSS animation. */}
      {isCondensing && <CondensingOverlay />}

      <div className="pointer-events-none relative z-10 min-h-screen">
        <AnimatePresence mode="wait">
          {phase === 'idle' && !showList && (
            pendingImageFile ? (
              // Round 26 (bug③): a photo was just picked on Landing ("继续上传")
              // and is being consumed on mount. Render nothing here — showing
              // the UploadZone card for even one frame would flash the upload
              // UI. The global LoadingOverlay (isLoading) covers the screen
              // until particles are ready.
              <motion.div key="pending" className="min-h-screen" />
            ) : (
              <motion.div
                key="idle"
                exit={{ opacity: 0, transition: { duration: 0.3 } }}
                className="pointer-events-auto min-h-screen"
              >
                <div className="absolute right-6 top-6 z-20">
                  <button
                    onClick={handleOpenList}
                    className="flex items-center gap-2 rounded-full border px-4 py-2 text-xs text-warm-white/50 transition-colors hover:bg-white/5 hover:text-gold"
                    style={{ borderColor: 'rgba(255, 255, 255, 0.15)' }}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                    </svg>
                    日记列表
                  </button>
                </div>
                <UploadZone
                  onParticleReady={handleParticleReady}
                  onImageBlobReady={handleImageBlobReady}
                />
              </motion.div>
            )
          )}

          {inMainView && (
            <motion.div
              key="main"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.3 } }}
              className="relative min-h-screen"
            >
              <div className="pointer-events-auto fixed left-0 right-0 top-0 z-30 flex items-center justify-end px-6 py-4">
                {currentTime && (
                  <div
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-mono text-xs"
                    style={{ color: 'rgba(232, 221, 208, 0.3)' }}
                  >
                    {currentTime}
                  </div>
                )}
                <div className="flex items-center gap-3">
                  {viewTab === 'chat' && <TextDisplayButtons />}
                  <button
                    onClick={handleOpenList}
                    className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-white/5"
                    style={{ color: 'rgba(232, 221, 208, 0.4)' }}
                    aria-label="日记列表"
                    title="日记列表"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                    </svg>
                  </button>
                  {particlesVisible && (
                    <button
                      onClick={() => setAtmosphereOpen(true)}
                      className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-white/5"
                      style={{ color: 'rgba(232, 221, 208, 0.4)' }}
                      aria-label="氛围调节"
                      title="氛围调节"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.594c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.719.257 1.09.164l1.281-.387c.525-.16 1.097.082 1.366.551l1.297 2.248c.27.469.157 1.058-.244 1.402l-.973.836c-.285.245-.428.606-.428.972v.682c0 .366.143.727.428.972l.973.836c.401.344.514.933.244 1.402l-1.297 2.248c-.27.469-.841.711-1.366.551l-1.281-.387a1.46 1.46 0 00-1.09.164c-.073.044-.146.087-.22.127-.332.184-.582.496-.645.87l-.213 1.281c-.09.542-.56.94-1.11.94h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.063-.374-.313-.686-.645-.87a4.54 4.54 0 00-.22-.127 1.46 1.46 0 00-1.09-.164l-1.281.387c-.525.16-1.097-.082-1.366-.551l-1.297-2.248c-.27-.469-.157-1.058.244-1.402l.973-.836c.285-.245.428-.606.428-.972v-.682c0-.366-.143-.727-.428-.972l-.973-.836c-.401-.344-.514-.933-.244-1.402l1.297-2.248c.27-.469.841-.711 1.366-.551l1.281.387a1.46 1.46 0 001.09-.164c.074-.04.147-.083.22-.127.332-.184.582-.496.645-.87l.213-1.281z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </button>
                  )}
                  {/* Round Auth: account entry — hollow person (guest) or
                      circular avatar (signed in). Mounted LAST in the top
                      bar button group (P0-9). */}
                  <AuthEntry />
                </div>
              </div>

              <ViewTabs />

              <div className="pointer-events-none absolute inset-0 z-20 flex flex-col">
                <AnimatePresence mode="wait">
                  {viewTab === 'chat' && (
                    <motion.div
                      key="chat-pane"
                      initial={{ opacity: 0 }}
                      // Round 26 (bug②): while condensing, fade the entire
                      // conversation (messages + input + condense button) to 0
                      // so only the particle background + the centered
                      // CondensingOverlay copy remain visible — no overlap.
                      animate={{ opacity: isCondensing ? 0 : 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.35, ease: 'easeOut' }}
                      className="pointer-events-none absolute inset-0"
                    >
                      <ChatPanel
                        onSend={handleSendMessage}
                        onCondense={handleCondense}
                        isCondensing={isCondensing}
                        canCondense={phase === 'chatting'}
                        messagesVisible={messagesVisible}
                        revealIds={revealIds}
                      />
                    </motion.div>
                  )}
                  {viewTab === 'diary' && (
                    <motion.div
                      key="diary-pane"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      className="pointer-events-auto absolute inset-x-0 top-[110px] bottom-0 overflow-y-auto"
                    >
                      {currentDiary ? (
                        <DiaryView
                          diary={currentDiary}
                          variant="inline"
                          showBack={false}
                          onSave={(updates) => {
                            handleDiaryEdit(updates);
                            handleSaveDiary();
                          }}
                        />
                      ) : (
                        <DiaryEmptyState />
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showList && (
            <motion.div
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-auto fixed inset-0 z-40 overflow-y-auto"
              style={{ background: '#080605' }}
            >
              <DiaryList
                onSelectDiary={handleSelectDiary}
                onNew={() => {
                  setShowList(false);
                  handleNewDiary();
                }}
                onBack={handleCloseList}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AtmospherePanel
        open={atmosphereOpen}
        onClose={() => setAtmosphereOpen(false)}
        onRebuild={handleRebuildParticles}
      />

      <LoadingOverlay
        visible={
          !isCondensing &&
          phase !== 'condensing' &&
          (isLoading ||
            phase === 'uploading' ||
            (phase === 'particle' && !!errorMessage))
        }
        message={loadingMessage}
        error={errorMessage}
        onRetry={() => {
          setError(null);
          if (phase === 'condensing') {
            setPhase('chatting');
          } else {
            setPhase('idle');
          }
        }}
      />

      {/* Hide the in-chat logo on 'chat' / 'gallery' views; show otherwise.
          (The global Logo component on the top-level router handles its
          own auto-hide; this local "chat-page brand" label is redundant
          but kept as part of the untouched original markup.) */}
      {currentView !== 'landing' && null}
    </div>
  );
}