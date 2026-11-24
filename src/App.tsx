import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthModal } from './components/AuthModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FirebaseProvider } from './context/FirebaseProvider';
import { PreferencesProvider } from './context/PreferencesProvider';
import { PracticePlayerPage } from './pages/PracticePlayerPage';
import { SheetMusicEditorPage } from './pages/SheetMusicEditorPage';

export default function App() {
  return (
    <ErrorBoundary>
      <PreferencesProvider>
        <FirebaseProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<PracticePlayerPage />} />
              <Route path="/editor/:songId" element={<SheetMusicEditorPage />} />
              <Route path="/editor" element={<Navigate to="/editor/ode-to-joy" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            <AuthModal />
          </BrowserRouter>
        </FirebaseProvider>
      </PreferencesProvider>
    </ErrorBoundary>
  );
}
