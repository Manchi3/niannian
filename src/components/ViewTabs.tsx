import { motion } from 'framer-motion';
import { useAppStore } from '../stores/appStore';

/**
 * ViewTabs — top-center segmented control with two options: 日记 / 对话.
 *
 * Rendered above the particle image in the particle / chatting phase.
 * Both tabs share the same particle background — only the foreground
 * text layer (chat or diary content) changes.
 *
 * Visual: rounded capsule, subtle border, the active tab gets a pill
 * background tint and gold text.
 */
export default function ViewTabs(): React.ReactElement {
  const viewTab = useAppStore((s) => s.viewTab);
  const setViewTab = useAppStore((s) => s.setViewTab);

  // Don't disable "diary" tab even when there's no currentDiary — the
  // DiaryView will show an empty state instead. This is better UX than
  // a disabled button and matches the user's spec ("可从日记回到对话").
  const tabs: Array<{ key: 'chat' | 'diary'; label: string }> = [
    { key: 'chat', label: '对话' },
    { key: 'diary', label: '日记' },
  ];

  return (
    <div className="pointer-events-auto absolute left-1/2 top-[60px] z-30 -translate-x-1/2">
      <div
        className="relative flex items-center rounded-full border p-1"
        style={{
          borderColor: 'rgba(255, 255, 255, 0.1)',
          background: 'rgba(8, 6, 5, 0.5)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
      >
        {tabs.map((tab) => {
          const isActive = viewTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setViewTab(tab.key)}
              className="relative z-10 px-5 py-1.5 text-xs transition-colors duration-200"
              style={{
                color: isActive
                  ? 'rgba(212, 168, 83, 0.95)'
                  : 'rgba(232, 221, 208, 0.5)',
                fontWeight: isActive ? 500 : 400,
              }}
              aria-pressed={isActive}
              aria-label={tab.label}
            >
              {/* Pill background — slides between tabs */}
              {isActive && (
                <motion.span
                  layoutId="viewtab-pill"
                  className="absolute inset-0 -z-10 rounded-full"
                  style={{
                    background: 'rgba(212, 168, 83, 0.12)',
                    border: '1px solid rgba(212, 168, 83, 0.35)',
                  }}
                  transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                />
              )}
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
