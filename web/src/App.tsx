import { EventControls } from './components/EventControls.tsx';
import { InterceptionLog } from './components/InterceptionLog.tsx';
import { useHashRoute } from './hooks/useHashRoute.ts';
import type { Route } from './hooks/useHashRoute.ts';
import { Dashboard } from './sections/Dashboard.tsx';
import { UsersSection } from './sections/UsersSection.tsx';
import { GroupsSection } from './sections/GroupsSection.tsx';
import { TimeZonesSection } from './sections/TimeZonesSection.tsx';
import { AccessRulesSection } from './sections/AccessRulesSection.tsx';
import { PortalsSection } from './sections/PortalsSection.tsx';
import { AccessLogsSection } from './sections/AccessLogsSection.tsx';

/** Navigation entries in display order (Req 11.2). */
const NAV_ITEMS: ReadonlyArray<{ route: Route; label: string }> = [
  { route: 'dashboard', label: 'Dashboard' },
  { route: 'users', label: 'Users' },
  { route: 'groups', label: 'Groups' },
  { route: 'time-zones', label: 'Time Zones' },
  { route: 'access-rules', label: 'Access Rules' },
  { route: 'portals', label: 'Portals' },
  { route: 'access-logs', label: 'Access Logs' },
  { route: 'simulate', label: 'Simulate' },
  { route: 'interception', label: 'Interception Log' },
];

/** Render the section component for the active route. */
function renderSection(route: Route) {
  switch (route) {
    case 'dashboard':
      return <Dashboard />;
    case 'users':
      return <UsersSection />;
    case 'groups':
      return <GroupsSection />;
    case 'time-zones':
      return <TimeZonesSection />;
    case 'access-rules':
      return <AccessRulesSection />;
    case 'portals':
      return <PortalsSection />;
    case 'access-logs':
      return <AccessLogsSection />;
    case 'simulate':
      // Existing Simulate controls, rendered unchanged (Req 12.3).
      return <EventControls />;
    case 'interception':
      // Existing Interception Log, rendered unchanged (Req 12.4).
      return <InterceptionLog />;
  }
}

/**
 * Root Admin Panel layout (Req 11). A persistent sidebar (collapsing to a top
 * nav on narrow viewports via CSS) lists all nine sections; selecting one swaps
 * the section component with no full reload, driven by {@link useHashRoute}
 * (Req 11.2, 11.3). The existing Simulate + Interception Log sections are
 * preserved unchanged (Req 12.3, 12.4).
 */
export function App() {
  const [route, navigate] = useHashRoute();

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__title">Control-iD</span>
          <span className="sidebar__subtitle">Facial Emulator · Admin</span>
        </div>
        <nav className="sidebar__nav" aria-label="Admin panel sections">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.route}
              type="button"
              className={`sidebar__link ${route === item.route ? 'sidebar__link--active' : ''}`}
              aria-current={route === item.route ? 'page' : undefined}
              onClick={() => navigate(item.route)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="content">{renderSection(route)}</main>
    </div>
  );
}
