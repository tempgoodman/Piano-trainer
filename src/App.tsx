import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { PracticePlayerPage } from './pages/PracticePlayerPage';
import { SheetMusicEditorPage } from './pages/SheetMusicEditorPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PracticePlayerPage />} />
        <Route path="/editor/:songId" element={<SheetMusicEditorPage />} />
        <Route path="/editor" element={<Navigate to="/editor/ode-to-joy" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
