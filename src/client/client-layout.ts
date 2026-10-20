import {useLayoutEffect,type RefObject} from 'react';

export type ClientLayout = 'current' | 'focus';

export function resolveClientLayout(search: string, enabled: boolean): ClientLayout {
  const choices = new URLSearchParams(search).getAll('layout');
  return enabled && choices.length === 1 && choices[0] === 'focus' ? 'focus' : 'current';
}

export function initialClientLayout(): ClientLayout {
  return resolveClientLayout(window.location.search,
    document.querySelector('meta[name="nancy-focus-review"]')?.getAttribute('content') === 'enabled');
}

// Measure the control area so enlarged text, wrapping and active voice controls
// reserve enough scroll space. The layout is chosen only when the client mounts.
export function useFocusDock(enabled: boolean, ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    if (!enabled || !ref.current) return;
    const root = document.documentElement, dock = ref.current;
    const oldAttribute = root.getAttribute('data-nancy-focus');
    const oldHeight = root.style.getPropertyValue('--nancy-focus-dock-height');
    const oldPriority = root.style.getPropertyPriority('--nancy-focus-dock-height');
    root.setAttribute('data-nancy-focus', 'true');
    const measure = () => {
      const height = dock.getBoundingClientRect().height;
      if (height > 0) root.style.setProperty('--nancy-focus-dock-height', `${Math.ceil(height)}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(dock);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      if (oldAttribute === null) root.removeAttribute('data-nancy-focus');
      else root.setAttribute('data-nancy-focus', oldAttribute);
      if (oldHeight) root.style.setProperty('--nancy-focus-dock-height', oldHeight, oldPriority);
      else root.style.removeProperty('--nancy-focus-dock-height');
    };
  }, [enabled, ref]);
}
