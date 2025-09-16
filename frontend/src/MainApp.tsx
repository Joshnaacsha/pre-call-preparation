import { LandingPage } from './components/dashboard/LandingPage';
import { OAuthFlow } from './components/auth/OAuthFlow';
import { ChatInterface } from './components/chat/ChatInterface';
import { useAppContext } from './contexts/AppContext';

export function MainApp() {
  const { state } = useAppContext();

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