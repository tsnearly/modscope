import { useState, useEffect } from 'react';

/**
 * Detects whether the client is running on a mobile / touch device deployment.
 * Returns true if pointer is coarse, hover is not supported, or viewport is mobile width (<768px).
 */
function checkMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;

  // 1. Mobile / tablet user agent detection
  const ua = navigator.userAgent || '';
  const isMobileUa =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (isMobileUa) {
    return true;
  }

  // 2. Desktop with mouse/trackpad has fine pointer and hover support
  const hasFinePointer =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: fine)').matches;
  const hasHover =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover)').matches;

  if (hasFinePointer && hasHover) {
    return false;
  }

  // 3. Touch-only or mobile viewport fallback
  const isCoarseOrNoHover =
    typeof window.matchMedia === 'function' &&
    (window.matchMedia('(pointer: coarse)').matches ||
      window.matchMedia('(hover: none)').matches);
  const isSmallViewport = window.innerWidth < 768;

  return isCoarseOrNoHover || isSmallViewport;
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(checkMobileDevice);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const checkMobile = () => {
      setIsMobile(checkMobileDevice());
    };

    checkMobile();

    const coarseQuery = window.matchMedia('(pointer: coarse)');
    const hoverQuery = window.matchMedia('(hover: none)');

    window.addEventListener('resize', checkMobile);

    try {
      coarseQuery.addEventListener('change', checkMobile);
      hoverQuery.addEventListener('change', checkMobile);
      return () => {
        window.removeEventListener('resize', checkMobile);
        coarseQuery.removeEventListener('change', checkMobile);
        hoverQuery.removeEventListener('change', checkMobile);
      };
    } catch {
      coarseQuery.addListener(checkMobile);
      hoverQuery.addListener(checkMobile);
      return () => {
        window.removeEventListener('resize', checkMobile);
        coarseQuery.removeListener(checkMobile);
        hoverQuery.removeListener(checkMobile);
      };
    }
  }, []);

  return isMobile;
}
