import { CalendarMonitor } from '../calendar/CalendarMonitor';
import { MeetingDashboard } from './MeetingDashboard';

export function DashboardPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-gray-900 dark:via-blue-900 dark:to-purple-900">
      <div className="container mx-auto px-6 py-12">
        <div className="grid gap-8 md:grid-cols-[300px_1fr]">
          {/* Sidebar */}
          <div className="space-y-8">
            <CalendarMonitor />
          </div>
          
          {/* Main Content */}
          <div>
            <MeetingDashboard />
          </div>
        </div>
      </div>
    </div>
  );
}
