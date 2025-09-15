import React from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Calendar, CheckCircle } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { useAppContext } from '../../contexts/AppContext';

const MSGraphSignInButton: React.FC = () => {
    const handleSignIn = () => {
        const CLIENT_ID = import.meta.env.VITE_MS_CLIENT_ID;
        const REDIRECT_URI = import.meta.env.VITE_MS_REDIRECT_URI;
        const TENANT_ID = import.meta.env.VITE_MS_TENANT_ID;

        if (!CLIENT_ID || !REDIRECT_URI || !TENANT_ID) {
            console.error('Missing required environment variables for OAuth');
            return;
        }

        const scope = encodeURIComponent('offline_access https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/User.Read');
        const authUrl = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_mode=query&scope=${scope}&state=${crypto.randomUUID()}`;

        window.location.href = authUrl;
    };

    return (
        <Button 
            size="lg" 
            onClick={handleSignIn}
            className="w-full"
        >
            Sign in with Microsoft
        </Button>
    );
};

export function OAuthFlow() {
  const { dispatch } = useAppContext();
  const [authSuccess, setAuthSuccess] = React.useState(false);
  const [pipelineStatus, setPipelineStatus] = React.useState('idle');
  const [pipelineError, setPipelineError] = React.useState<string | null>(null);

  const startPipeline = async () => {
    try {
      setPipelineStatus('starting');
      setPipelineError(null);
      
      const response = await fetch('http://localhost:3001/api/start-pipeline', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({}) // Send empty object as body
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to start pipeline');
      }

      console.log('Pipeline completed:', data);
      setPipelineStatus('completed');
      
      // If no events were found, we can show that information
      if (data.events === 0) {
        setPipelineError('No upcoming meetings found in the next 3 hours.');
      }
    } catch (error) {
      console.error('Error starting pipeline:', error);
      setPipelineError(error instanceof Error ? error.message : 'Failed to start pipeline');
      setPipelineStatus('error');
    }
  };

  React.useEffect(() => {
    // Check for auth success or error in URL parameters
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'success') {
      setAuthSuccess(true);
      // Set auth status in global state
      dispatch({ type: 'SET_AUTH_STATUS', payload: true });
      // Clean up the URL
      window.history.replaceState({}, document.title, '/oauth');
      // Start the pipeline
      startPipeline();
    } else if (params.get('auth') === 'error') {
      const errorMessage = params.get('message');
      console.error('Authentication error:', errorMessage);
      // You might want to show this error to the user
      alert(`Authentication failed: ${errorMessage || 'Unknown error'}`);
    }
  }, [dispatch]);

  if (authSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-gray-900 dark:via-blue-900 dark:to-purple-900 flex items-center justify-center p-6">
        <div className="w-full max-w-2xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <Card className="p-8 text-center">
              <div className="inline-flex p-4 rounded-2xl bg-gradient-to-br from-green-500 to-green-600 shadow-lg mb-6">
                <CheckCircle className="h-12 w-12 text-white" />
              </div>
              
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
                Calendar Connected Successfully! 🎉
              </h1>
              
              <div className="space-y-6 mb-8">
                <div className="text-gray-600 dark:text-gray-300 text-lg">
                  <p className="mb-4">
                    Great news! Your calendar has been connected and we're now preparing your meeting briefings.
                  </p>
                  <div className="bg-blue-50 dark:bg-blue-900/50 p-6 rounded-lg text-left space-y-4">
                    <h3 className="font-semibold text-gray-900 dark:text-white">What happens next:</h3>
                    <ul className="space-y-3">
                      <li className="flex items-start gap-2">
                        <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                        <span>We're analyzing your upcoming meetings</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                        <span>Preparing detailed briefing documents</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                        <span>You'll receive email notifications with meeting briefings</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                        <span>Briefings will arrive before each scheduled meeting</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {pipelineStatus === 'error' ? (
                  <div className="text-red-500 bg-red-50 dark:bg-red-900/50 p-4 rounded-lg mb-4">
                    <p>Error starting pipeline: {pipelineError}</p>
                    <Button
                      size="sm"
                      onClick={startPipeline}
                      className="mt-2"
                    >
                      Retry
                    </Button>
                  </div>
                ) : pipelineStatus === 'starting' ? (
                  <div className="text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/50 p-4 rounded-lg mb-4">
                    <div className="flex items-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 dark:border-blue-400"></div>
                      <span>Starting pipeline...</span>
                    </div>
                  </div>
                ) : pipelineStatus === 'completed' && pipelineError ? (
                  <div className="text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/50 p-4 rounded-lg mb-4">
                    <div className="flex items-start gap-2">
                      <CheckCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                      <div>
                        <p>Pipeline completed successfully</p>
                        <p className="text-sm mt-1">{pipelineError}</p>
                      </div>
                    </div>
                  </div>
                ) : pipelineStatus === 'completed' ? (
                  <div className="text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/50 p-4 rounded-lg mb-4">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-5 w-5" />
                      <span>Pipeline completed successfully!</span>
                    </div>
                  </div>
                ) : null}
                
                <Button
                  size="lg"
                  onClick={() => dispatch({ type: 'SET_MODE', payload: 'dashboard' })}
                  className="w-full bg-green-600 hover:bg-green-700"
                  disabled={pipelineStatus === 'starting' || pipelineStatus === 'running'}
                >
                  Continue to Dashboard
                </Button>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  You can always access your briefings from the dashboard
                </p>
              </div>
            </Card>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-gray-900 dark:via-blue-900 dark:to-purple-900 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <Button
            variant="ghost"
            onClick={() => dispatch({ type: 'SET_MODE', payload: 'landing' })}
            className="mb-8"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Home
          </Button>

          <Card className="p-8 text-center">
            <div className="inline-flex p-4 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg mb-6">
              <Calendar className="h-12 w-12 text-white" />
            </div>
            
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
              Connect Your Calendar
            </h1>
            
            <p className="text-gray-600 dark:text-gray-300 mb-8 text-lg">
              Securely connect your Microsoft Calendar to enable automatic meeting detection and preparation.
            </p>

            <div className="space-y-6">
              <MSGraphSignInButton />

              <div className="grid gap-4 text-left bg-gray-50 dark:bg-gray-800/50 rounded-xl p-6">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
                  What happens next:
                </h3>
                
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                    <span className="text-sm text-gray-600 dark:text-gray-300">
                      You'll be redirected to Microsoft's secure authentication
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                    <span className="text-sm text-gray-600 dark:text-gray-300">
                      Grant calendar read permissions
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                    <span className="text-sm text-gray-600 dark:text-gray-300">
                      Automatic meeting detection starts immediately
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                    <span className="text-sm text-gray-600 dark:text-gray-300">
                      AI preparation begins for upcoming meetings
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}