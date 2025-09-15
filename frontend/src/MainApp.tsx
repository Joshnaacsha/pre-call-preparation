import { LandingPage } from './components/dashboard/LandingPage';
import { OAuthFlow } from './components/auth/OAuthFlow';
import { ChatInterface } from './components/chat/ChatInterface';
import { DashboardPage } from './components/dashboard/DashboardPage';
import { useAppContext } from './contexts/AppContext';

export function MainApp() {
  const { state } = useAppContext();

  const renderCurrentMode = () => {
    switch (state.currentMode) {
      case 'oauth':
        return <OAuthFlow />;
      case 'chat':
        return <ChatInterface />;
      case 'dashboard':
        return <DashboardPage />;
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