'use client';

import { useState } from 'react';
import { useI18n } from '@/hooks/useI18n';
import { AboutDialog } from './AboutDialog';

/**
 * The sidebar's brand, at the top of the sessions panel: the app's pi mark, and
 * the way into About — the logo, the build's version with the commit it came
 * from, and the Pi release it runs.
 */

/** The mark the brand shows (the app icon). */
export const BRAND_ICON_SRC = '/icons/icon-192.png';
/** The mark's box, square like the file. */
export const BRAND_ICON_SIZE = 20;

export function PiWebTitle() {
  const { t } = useI18n();
  const [aboutOpen, setAboutOpen] = useState(false);
  const label = t('sidebar.brandLabel');

  return (
    <>
      <button
        type="button"
        className="sidebar-brand"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={aboutOpen}
        onClick={() => setAboutOpen(true)}
      >
        {/* A fixed 20px brand mark, not content: next/image buys nothing here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="sidebar-brand-icon"
          src={BRAND_ICON_SRC}
          alt=""
          width={BRAND_ICON_SIZE}
          height={BRAND_ICON_SIZE}
        />
      </button>
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </>
  );
}
