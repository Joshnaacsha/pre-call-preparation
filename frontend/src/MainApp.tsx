import { useEffect } from 'react';
import { LandingPage } from './components/dashboard/LandingPage';
import { OAuthFlow } from './components/auth/OAuthFlow';
import { ChatInterface } from './components/chat/ChatInterface';
import { useAppContext } from './contexts/AppContext';

export function MainApp() {
  const { state, dispatch } = useAppContext();

  // Check authentication status on mount and after any auth changes
  useEffect(() => {
    // Check if we were redirected from auth
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'success') {
      // Set authenticated state
      dispatch({ type: 'SET_AUTH_STATUS', payload: true });
      
      // Clear the URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
      
      // Get the stored redirect path and mode
      const redirectPath = localStorage.getItem('redirectAfterAuth');
      const redirectMode = localStorage.getItem('redirectMode');
      
      // Clean up storage
      localStorage.removeItem('redirectAfterAuth');
      localStorage.removeItem('redirectMode');
      
      if (redirectPath) {
        window.location.href = redirectPath;
        return;
      }
      
      // If no redirect path but we have a mode, use that
      if (redirectMode) {
        dispatch({ type: 'SET_MODE', payload: redirectMode as any });
        return;
      }
      
      // Default to chat mode
      dispatch({ type: 'SET_MODE', payload: 'chat' });
    }

    // Check if we need to restore previous session
    const savedAuth = localStorage.getItem('authState');
    if (savedAuth) {
      try {
        const { isAuthenticated } = JSON.parse(savedAuth);
        if (isAuthenticated) {
          dispatch({ type: 'SET_AUTH_STATUS', payload: true });
        }
      } catch (e) {
        console.error('Failed to parse auth state:', e);
      }
    }
  }, [dispatch]);

  // Render current mode
  const renderCurrentMode = () => {
    switch (state.currentMode) {
      case 'oauth':
        return <OAuthFlow />;
      case 'chat':
        return <ChatInterface />;
      default:
        return <LandingPage />;
    }
  };

  return (
    <>
      {renderCurrentMode()}
    </>
  );
}