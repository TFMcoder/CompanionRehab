import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DevicePreview } from './DevicePreview';

createRoot(document.getElementById('root')!).render(<StrictMode><DevicePreview /></StrictMode>);
