import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { TooltipProvider } from '@/components/ui/tooltip';
import './index.css';
import './core/nodes/registerAll';
import { router } from './router';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HelmetProvider>
      <TooltipProvider delayDuration={300}>
        <RouterProvider router={router} />
      </TooltipProvider>
    </HelmetProvider>
  </StrictMode>,
);
