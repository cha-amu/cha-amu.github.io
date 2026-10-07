import { useState } from 'react';

/** Width where the map and the tags become a sticky rail beside the reading column (global.css). */
export const SIDEBAR_RAIL_MIN_WIDTH = 1400;

const STORAGE_PREFIX = 'cha-amu:section-open:';
const choices = new Map<string, boolean>();

function rememberedChoice(name: string): boolean | null {
  const remembered = choices.get(name);
  if (remembered !== undefined) return remembered;
  try {
    const stored = window.sessionStorage.getItem(STORAGE_PREFIX + name);
    if (stored === 'open' || stored === 'closed') return stored === 'open';
  } catch {
    // Blocked storage only loses the choice; the viewport default still applies.
  }
  return null;
}

function rememberChoice(name: string, open: boolean) {
  choices.set(name, open);
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + name, open ? 'open' : 'closed');
  } catch {
    // Keep the in-memory choice for this page.
  }
}

/**
 * Open state of a collapsible section such as the connection map or the tags.
 * A section starts open where there is room for it (`minWidth` and wider). Once the
 * reader toggles it, that choice holds for the rest of the tab session, so a new
 * selection that remounts the section, or a move to another page, does not undo it.
 */
export function useSectionOpen(name: string, minWidth: number): [boolean, () => void] {
  const [open, setOpen] = useState(() => rememberedChoice(name) ?? window.matchMedia(`(min-width: ${minWidth}px)`).matches);
  const toggle = () => {
    rememberChoice(name, !open);
    setOpen(!open);
  };
  return [open, toggle];
}
