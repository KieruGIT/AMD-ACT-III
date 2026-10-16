import { Dashboard } from './pages/Dashboard';
import { Landing } from './pages/Landing';

// Two pages only, so a pathname check beats adding a router.
export default function App() {
  return location.pathname.startsWith('/app') ? <Dashboard /> : <Landing />;
}
