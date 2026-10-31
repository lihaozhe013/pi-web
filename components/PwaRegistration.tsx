'use client';

import { formatAppVersion } from '@/lib/app-version';
import { useEffect } from 'react';

export function PwaRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) {
      return;
    }

    // The desktop shell loads this server in a system webview. A service worker
    // there caches by origin, outlives a port change, and can serve a stale shell
    // after an update, so the desktop build never registers one and removes any
    // registration an earlier build left behind.
    if (process.env.NEXT_PUBLIC_PI_WEB_DESKTOP === '1') {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(registrations.map((registration) => registration.unregister()))
        )
        .catch((error: unknown) => {
          console.error('Failed to remove the Pi Web service worker:', error);
        });
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
