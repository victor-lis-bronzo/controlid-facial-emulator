import { useState } from 'react';
import { EventControls } from './components/EventControls.tsx';
import { InterceptionLog } from './components/InterceptionLog.tsx';

type Tab = 'simulate' | 'interception';

/**
 * Root control-panel layout (Req 7). Composes the event-simulation controls and
 * the interception-log view into two tabs served at `/admin`.
 */
export function App() {
  const [tab, setTab] = useState<Tab>('simulate');

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Control-iD Facial Emulator</h1>
        <p className="app__subtitle">
          Trigger simulated access events and inspect intercepted requests and
          dispatched webhooks.
        </p>
      </header>

      <nav className="tabs" aria-label="Control panel sections">
        <button
          type="button"
          className={`tabs__button ${tab === 'simulate' ? 'tabs__button--active' : ''}`}
          aria-pressed={tab === 'simulate'}
          onClick={() => setTab('simulate')}
        >
          Simulate
        </button>
        <button
          type="button"
          className={`tabs__button ${tab === 'interception' ? 'tabs__button--active' : ''}`}
          aria-pressed={tab === 'interception'}
          onClick={() => setTab('interception')}
        >
          Interception Log
        </button>
      </nav>

      {tab === 'simulate' ? <EventControls /> : <InterceptionLog />}
    </div>
  );
}
