import { AppMark } from './components/AppMark';
import { AppShell } from './components/AppShell';
import { SetupNotice } from './components/SetupNotice';
import { SignInScreen } from './components/SignInScreen';
import { isFirebaseConfigured } from './firebase';
import { useAuthUser } from './hooks/useAuthUser';

export function App() {
  const { user, loading } = useAuthUser();

  if (!isFirebaseConfigured) {
    return <SetupNotice />;
  }

  if (loading) {
    return (
      <main className="screen screen--centred">
        <div className="splash">
          <AppMark size={56} />
          <p className="splash__label">Tuning up…</p>
        </div>
      </main>
    );
  }

  return user ? <AppShell user={user} /> : <SignInScreen />;
}
