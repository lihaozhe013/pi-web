'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '@/hooks/useI18n';

export function informationPanelOverlays(viewportWidth: number, sidebarWidth: number): boolean {
  return viewportWidth - sidebarWidth < 820;
}

/** A single information surface; never restores the retired file workspace. */
export function SessionInfoSidebar({
  title,
  sidebarWidth,
  onClose,
  children
}: {
  title: string;
  sidebarWidth: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [overlay, setOverlay] = useState(false);
  useLayoutEffect(() => {
    const update = () => setOverlay(informationPanelOverlays(window.innerWidth, sidebarWidth));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [sidebarWidth]);
  useEffect(() => {
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        const otherDialog = [
          ...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')
        ].some((element) => element !== panelRef.current && !panelRef.current?.contains(element));
        if (otherDialog) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      // Wait until modal siblings have had their inert state restored.
      const opener = openerRef.current;
      queueMicrotask(() => {
        if (opener?.isConnected && opener.getClientRects().length > 0) opener.focus();
        else document.querySelector<HTMLElement>('[data-mobile-toolbar-more="true"]')?.focus();
      });
    };
  }, []);
  useEffect(() => {
    if (!overlay) return;
    const panel = panelRef.current;
    const siblings = [...(panel?.parentElement?.children ?? [])].filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        element !== panel &&
        !element.classList.contains('session-info-backdrop')
    );
    const previous = siblings.map((element) => element.inert);
    siblings.forEach((element) => {
      element.inert = true;
    });
    return () =>
      siblings.forEach((element, index) => {
        element.inert = previous[index];
      });
  }, [overlay]);
  return (
    <>
      {overlay && <div className="session-info-backdrop" aria-hidden="true" onClick={onClose} />}
      <aside
        ref={panelRef}
        id="session-information"
        tabIndex={-1}
        role={overlay ? 'dialog' : 'complementary'}
        aria-modal={overlay || undefined}
        aria-label={title}
        className={`session-info-sidebar${overlay ? ' is-overlay' : ''}`}
        onKeyDown={(event) => {
          if (!overlay || event.key !== 'Tab') return;
          const controls = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
            )
          ].filter((element) => element.getClientRects().length > 0);
          const first = controls[0];
          const last = controls.at(-1);
          if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === panelRef.current)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <header className="session-info-header">
          <span>{title}</span>
          <button type="button" onClick={onClose} aria-label={t('chat.close')}>
            ×
          </button>
        </header>
        <div className="session-info-content">{children}</div>
      </aside>
    </>
  );
}
