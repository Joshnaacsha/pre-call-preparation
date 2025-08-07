import React, { useEffect, useState } from 'react';

interface AuthResponse {
  success: boolean;
  message: string;
  error?: string;
}

function App() {
  const [status, setStatus] = useState<'initial' | 'success' | 'error'>('initial');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    
    if (code) {
      setStatus('success');
      setMessage('Authorization successful! Pre-call preparation process has started. You will receive summaries via email shortly.');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleSignIn = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/auth-url', {
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        mode: 'cors'
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      if (!data.url) {
        throw new Error('No authorization URL received');
      }
      
      window.location.href = data.url;
    } catch (error) {
      setStatus('error');
      setMessage('Failed to get authorization URL');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Card Container */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          
          {/* Header Section */}
          <div className="px-8 pt-8 pb-6 text-center bg-white">
            <img 
              src="https://awsmp-logos.s3.amazonaws.com/8dbda4db-e4f9-4e1d-b9d4-9f84dc105e1e/e64d79be1c781d5a94b07b772d0490f1.png" 
              alt="Cprime Logo" 
              className="h-12 mx-auto mb-4 object-contain"
            />
            <h1 className="text-2xl font-semibold text-gray-900 mb-2">
              Pre-Call Preparation
            </h1>
            <p className="text-gray-500 text-sm leading-relaxed">
              Automatically generate meeting summaries and preparation materials
            </p>
          </div>

          {/* Content Section */}
          <div className="px-8 pb-8">
            
            {status === 'initial' && (
              <div className="space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center space-x-3 text-sm text-gray-600">
                    <div className="w-2 h-2 bg-black rounded-full"></div>
                    <span>Connect your Google Calendar</span>
                  </div>
                  <div className="flex items-center space-x-3 text-sm text-gray-600">
                    <div className="w-2 h-2 bg-black rounded-full"></div>
                    <span>Automatic meeting analysis</span>
                  </div>
                  <div className="flex items-center space-x-3 text-sm text-gray-600">
                    <div className="w-2 h-2 bg-black rounded-full"></div>
                    <span>Email preparation summaries</span>
                  </div>
                </div>
                
                <button
                  onClick={handleSignIn}
                  className="w-full bg-black hover:bg-gray-800 text-white font-medium py-3 px-4 rounded-xl transition-all duration-200 flex items-center justify-center space-x-3 shadow-sm hover:shadow-md"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M12.545,10.239v3.821h5.445c-0.712,2.315-2.647,3.972-5.445,3.972c-3.332,0-6.033-2.701-6.033-6.032s2.701-6.032,6.033-6.032c1.498,0,2.866,0.549,3.921,1.453l2.814-2.814C17.503,2.988,15.139,2,12.545,2C7.021,2,2.543,6.477,2.543,12s4.478,10,10.002,10c8.396,0,10.249-7.85,9.426-11.748L12.545,10.239z"
                    />
                  </svg>
                  <span>Continue with Google</span>
                </button>
                
                <p className="text-xs text-gray-400 text-center leading-relaxed">
                  We'll only access your calendar events to generate meeting preparations. 
                  Your data is secure and never shared.
                </p>
              </div>
            )}

            {status === 'success' && (
              <div className="text-center space-y-6">
                <div className="w-16 h-16 mx-auto bg-gray-100 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 mb-2">All Set!</h2>
                  <p className="text-gray-600 text-sm leading-relaxed mb-4">
                    Your calendar has been connected successfully
                  </p>
                </div>

                <div className="bg-gray-50 rounded-xl p-4 text-left">
                  <h3 className="font-medium text-gray-900 text-sm mb-2">What happens next?</h3>
                  <ul className="space-y-1 text-xs text-gray-700">
                    <li>• Analyzing your upcoming meetings</li>
                    <li>• Generating preparation summaries</li>
                    <li>• Sending summaries to your email</li>
                  </ul>
                </div>
                
                <p className="text-xs text-gray-400">
                  You can safely close this window
                </p>
              </div>
            )}

            {status === 'error' && (
              <div className="text-center space-y-6">
                <div className="w-16 h-16 mx-auto bg-gray-100 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 mb-2">Connection Failed</h2>
                  <p className="text-gray-600 text-sm leading-relaxed mb-4">
                    {message}
                  </p>
                </div>
                
                <button
                  onClick={handleSignIn}
                  className="text-black hover:text-gray-700 font-medium text-sm transition-colors"
                >
                  Try Again
                </button>
              </div>
            )}
          </div>
        </div>
        
        {/* Footer */}
        <div className="text-center mt-6">
          <p className="text-xs text-gray-400">
            Powered by Cprime • Secure & Private
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;