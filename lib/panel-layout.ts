export const MOBILE_MAX_WIDTH = 640;
export const SPLIT_PANEL_MIN_WIDTH = 960;

export const SIDEBAR_DEFAULT_WIDTH = 260;
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 480;

export const RIGHT_PANEL_FALLBACK_WIDTH = 560;
export const RIGHT_PANEL_MIN_WIDTH = 300;
export const RIGHT_PANEL_MAX_WIDTH = 1200;

const COMPACT_CHAT_MIN_WIDTH = 320;
const DESKTOP_CHAT_MIN_WIDTH = 420;

export function clampPanelWidth(width: number, minWidth: number, maxWidth: number): number {
  const finiteWidth = Number.isFinite(width) ? width : minWidth;
  const effectiveMax = Math.max(minWidth, maxWidth);
  return Math.round(Math.max(minWidth, Math.min(effectiveMax, finiteWidth)));
}

export function getDefaultRightPanelWidth(viewportWidth: number): number {
  return clampPanelWidth(viewportWidth * 0.42, 360, 640);
}

export function getSidebarMaxWidth(options: {
  viewportWidth: number;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
}): number {
  const { viewportWidth, rightPanelOpen, rightPanelWidth } = options;
  if (viewportWidth <= MOBILE_MAX_WIDTH) return SIDEBAR_MAX_WIDTH;

  const compact = viewportWidth < SPLIT_PANEL_MIN_WIDTH;
  const chatWidth = compact ? COMPACT_CHAT_MIN_WIDTH : DESKTOP_CHAT_MIN_WIDTH;
  const visibleRightPanelWidth = !compact && rightPanelOpen ? rightPanelWidth : 0;
  return Math.min(SIDEBAR_MAX_WIDTH, viewportWidth - chatWidth - visibleRightPanelWidth);
}

/** The Runs panel's choice for this page: nothing here is stored across reloads. */
export interface RunsPanelPreference {
  /** The user closed the panel; nothing opens it by itself afterwards. */
  collapsed: boolean;
  /** The user asked for the panel where it would overlay the conversation. */
  overlayRequested: boolean;
}

export const RUNS_PANEL_DEFAULT_PREFERENCE: RunsPanelPreference = {
  collapsed: false,
  overlayRequested: false
};

/**
 * The Runs panel is part of the default page: docked, it stays open until the
 * user collapses it, even before a command runs. Where it would overlay the
 * conversation it stays closed so the conversation remains visible, and opens
 * only when the user asks for it. Settings hides the panel without collapsing
 * it, so closing Settings brings it back.
 */
export function isRunsPanelOpen(
  preference: RunsPanelPreference,
  layout: { overlay: boolean; settingsOpen: boolean }
): boolean {
  if (preference.collapsed || layout.settingsOpen) return false;
  return !layout.overlay || preference.overlayRequested;
}

/**
 * The user's toggle: an open panel collapses and forgets an overlay request; a
 * closed one opens, remembering a request made where the panel overlays.
 */
export function toggleRunsPanelPreference(
  preference: RunsPanelPreference,
  context: { open: boolean; overlay: boolean }
): RunsPanelPreference {
  if (context.open) return { collapsed: true, overlayRequested: false };
  return {
    collapsed: false,
    overlayRequested: preference.overlayRequested || context.overlay
  };
}

export function getRightPanelMaxWidth(options: {
  viewportWidth: number;
  sidebarOpen: boolean;
  sidebarWidth: number;
}): number {
  const { viewportWidth, sidebarOpen, sidebarWidth } = options;
  if (viewportWidth < SPLIT_PANEL_MIN_WIDTH) return RIGHT_PANEL_MAX_WIDTH;

  const visibleSidebarWidth = sidebarOpen ? sidebarWidth : 0;
  return Math.min(
    RIGHT_PANEL_MAX_WIDTH,
    viewportWidth - DESKTOP_CHAT_MIN_WIDTH - visibleSidebarWidth
  );
}
