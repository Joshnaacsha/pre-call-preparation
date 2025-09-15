import React from 'react';
import { motion } from 'framer-motion';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { useAppContext } from '../../contexts/AppContext';

export function CalendarMonitor() {
  const { state } = useAppContext();
  const [monitorStatus, setMonitorStatus] = React.useState<'idle' | 'active' | 'error'>('idle');
  const [lastCheck, setLastCheck] = React.useState<Date | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Check monitor status on mount
    checkMonitorStatus();
  }, []);

  const checkMonitorStatus = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/calendar/status', {
        credentials: 'include',
      });
      const data = await response.json();
      
      if (data.status === 'active') {
        setMonitorStatus('active');
        setLastCheck(new Date(data.lastCheck));
      } else {
        setMonitorStatus('idle');
      }
    } catch (error) {
      console.error('Error checking monitor status:', error);
      setMonitorStatus('error');
      setError('Failed to check monitor status');
    }
  };

  const startMonitoring = async () => {
    try {
      setMonitorStatus('idle');
      setError(null);

      const response = await fetch('http://localhost:3001/api/calendar/monitor', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        throw new Error('Failed to start calendar monitoring');
      }

      const data = await response.json();
      setMonitorStatus('active');
      setLastCheck(new Date());
    } catch (error) {
      console.error('Error starting monitor:', error);
      setMonitorStatus('error');
      setError(error instanceof Error ? error.message : 'Failed to start monitoring');
    }
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Calendar Monitor</h3>
        <div className="flex items-center gap-2">
          {monitorStatus === 'active' && (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              className="w-4 h-4 rounded-full bg-green-500"
            />
          )}
          <span className="text-sm capitalize">{monitorStatus}</span>
        </div>
      </div>

      {lastCheck && (
        <p className="text-sm text-gray-500 mb-4">
          Last checked: {lastCheck.toLocaleString()}
        </p>
      )}

      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {monitorStatus !== 'active' && (
        <Button
          onClick={startMonitoring}
          className="w-full"
          disabled={monitorStatus === 'error'}
        >
          Start Calendar Monitoring
        </Button>
      )}

      {monitorStatus === 'active' && (
        <div className="bg-green-50 text-green-600 p-3 rounded-lg">
          Calendar monitoring is active. You'll receive notifications for upcoming meetings.
        </div>
      )}
    </Card>
  );
}
