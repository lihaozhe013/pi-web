/** Session management is the sidebar's only surface. */
export async function showSidebarSessions(page) {
  await page.locator('#session-sidebar-panel-sessions').waitFor({ state: 'visible' });
}
