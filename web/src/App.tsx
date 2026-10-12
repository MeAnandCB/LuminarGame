import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Spinner } from './components/ui';

const TeamApp = lazy(() => import('./pages/Team').then((m) => ({ default: m.TeamApp })));
const DisplayApp = lazy(() => import('./pages/Display').then((m) => ({ default: m.DisplayApp })));
const AdminApp = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminApp })));
const CoordinatorApp = lazy(() => import('./pages/Coordinator').then((m) => ({ default: m.CoordinatorApp })));

export function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/display" element={<DisplayApp />} />
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="/coordinator" element={<CoordinatorApp />} />
        <Route path="*" element={<TeamApp />} />
      </Routes>
    </Suspense>
  );
}
