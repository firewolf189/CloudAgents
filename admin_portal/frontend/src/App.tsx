import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { LayoutDashboard, Building2, Zap, Bot, LogOut } from 'lucide-react';
import { authApi } from './api/client';
import { LoginPage } from './pages/login';
import { DashboardPage } from './pages/dashboard';
import { DepartmentsPage } from './pages/departments';
import { OrchestratePage } from './pages/orchestrate';
import { AgentsPage } from './pages/agents';
import { Button } from '@/components/ui/button';

function Sidebar() {
  const location = useLocation();
  const nav = [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/agents', label: 'Agent 总览', icon: Bot },
    { path: '/departments', label: '部门管理', icon: Building2 },
    { path: '/orchestrate', label: '跨部门编排', icon: Zap },
  ];

  return (
    <aside className="w-56 bg-sidebar border-r flex flex-col h-screen shrink-0">
      <div className="p-4 border-b">
        <h1 className="text-lg font-bold text-sidebar-foreground">CloudAgents</h1>
        <p className="text-xs text-muted-foreground">Admin Portal</p>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {nav.map((item) => {
          const active = location.pathname.startsWith(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-2 border-t">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => {
            localStorage.removeItem('admin_token');
            window.location.reload();
          }}
        >
          <LogOut className="w-4 h-4" />
          退出登录
        </Button>
      </div>
    </aside>
  );
}

function AppLayout() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-background">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/departments" element={<DepartmentsPage />} />
          <Route path="/orchestrate" element={<OrchestratePage />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(!!localStorage.getItem('admin_token'));
  const [checking, setChecking] = useState(authed);

  useEffect(() => {
    if (!authed) return;
    authApi.me().then(() => setChecking(false)).catch(() => {
      localStorage.removeItem('admin_token');
      setAuthed(false);
      setChecking(false);
    });
  }, [authed]);

  if (checking) return null;

  return (
    <BrowserRouter>
      {authed ? <AppLayout /> : <LoginPage onLogin={() => setAuthed(true)} />}
      <Toaster richColors position="top-right" />
    </BrowserRouter>
  );
}
