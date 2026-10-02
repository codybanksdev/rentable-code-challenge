import React, { useState } from 'react';
import './App.css';
import Insights from './Insights';
import TenantList from './TenantList';

const TABS = [
  { key: 'tenants', label: 'Tenants' },
  { key: 'insights', label: 'Insights' },
];

function App() {
  const [tab, setTab] = useState('tenants');

  return (
    <div className="App">
      <header className="App-header-minimal">
        <h1>Property Management Dashboard</h1>
        <div className="tabs" role="tablist" aria-label="Views">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              id={`tab-${key}`}
              aria-selected={tab === key}
              aria-controls="tab-panel"
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      <main className="App-main" role="tabpanel" id="tab-panel" aria-labelledby={`tab-${tab}`}>
        {tab === 'tenants' ? <TenantList /> : <Insights />}
      </main>
    </div>
  );
}

export default App;
