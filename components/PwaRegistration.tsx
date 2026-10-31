'use client';

import { formatAppVersion } from '@/lib/app-version';
import { useEffect } from 'react';

export function PwaRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) {
      return;
    }

    const register = () => {
      const appVersion = formatAppVersion(
        process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev',
        process.env.NEXT_PUBLIC_APP_COMMIT
      );
      const scriptUrl = `/sw.js?v=${encodeURIComponent(appVersion)}`;

      void navigator.serviceWorker
        .register(scriptUrl, {
          scope: '/',
          updateViaCache: 'none'
        })
        .catch((error: unknown) => {
          console.error('Failed to register the Pi Web service worker:', error);
        });
    };

    if (document.readyState === 'complete') {
      register();
      return;
    }

    window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
