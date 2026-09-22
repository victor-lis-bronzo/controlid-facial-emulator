import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.tsx';

interface WebGuiLayoutProps {
  children: React.ReactNode;
}

interface NavModule {
  name: string;
  path?: string;
  enabled: boolean;
}

const NAV_MODULES: NavModule[] = [
  { name: 'Usuários', path: '/admin/users', enabled: true },
  { name: 'Grupos', path: '/admin/groups', enabled: true },
  { name: 'Horários', path: '/admin/time-zones', enabled: true },
  { name: 'Portais', path: '/admin/portals', enabled: true },
  { name: 'Regras de Acesso', enabled: false },
  { name: 'Logs de Acesso', enabled: false },
  { name: 'Configurações', enabled: false },
];

export function WebGuiLayout({ children }: WebGuiLayoutProps) {
  const { logout } = useAuth();
  const location = useLocation();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-40 px-4 md:px-6 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="h-9 w-9 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center font-bold text-base shadow-inner">
            iD
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-base font-bold text-white leading-tight">Control-iD WebGUI</h1>
              <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 border border-emerald-500/20">
                <span className="mr-1 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Conectado
              </span>
            </div>
            <p className="text-xs text-slate-400">Emulador Facial</p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <button
            onClick={logout}
            className="text-xs font-semibold text-slate-300 hover:text-white px-3 py-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Sair
          </button>
        </div>
      </header>

      {/* Main layout with Sidebar + Content */}
      <div className="flex-1 flex flex-col md:flex-row">
        {/* Persistent Navigation Sidebar */}
        <aside className="w-full md:w-64 border-b md:border-b-0 md:border-r border-slate-800 bg-slate-900/40 p-4 shrink-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-3 mb-2">
            Módulos da Leitora
          </div>
          <nav className="space-y-1" aria-label="Navegação do WebGUI">
            {NAV_MODULES.map((module) => {
              if (module.enabled && module.path) {
                const isActive = location.pathname === module.path;
                return (
                  <NavLink
                    key={module.name}
                    to={module.path}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                        : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                    }`}
                  >
                    <span>{module.name}</span>
                  </NavLink>
                );
              }

              return (
                <div
                  key={module.name}
                  className="flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium text-slate-400 cursor-not-allowed select-none opacity-80"
                >
                  <span>{module.name}</span>
                  <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/50">
                    Em breve
                  </span>
                </div>
              );
            })}
          </nav>
        </aside>

        {/* Content Area */}
        <main className="flex-1 bg-slate-950 p-4 md:p-8 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
