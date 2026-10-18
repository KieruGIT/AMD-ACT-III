import { Dashboard } from './pages/Dashboard';
import { Landing } from './pages/Landing';
import { Pair } from './pages/Pair';
import { SignIn } from './pages/SignIn';
import { Workspaces } from './pages/Workspaces';

// A handful of pages, so a pathname check beats adding a router.
export default function App() {
  const path = location.pathname.replace(/\/$/, '');
  if (path === '/demo') {
    location.replace('/workspaces?guest'); // the old demo link: straight into a guest workspace
    return null;
  }
  if (path.startsWith('/app')) return <Dashboard />;
  if (path === '/signin') return <SignIn />;
  if (path === '/workspaces') return <Workspaces />;
  if (path === '/pair') return <Pair />;
  return <Landing />;
}
