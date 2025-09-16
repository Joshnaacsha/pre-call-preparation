import DatabaseService from './database.js';
import TokenService from './token.js';
// import { sendEmail } from '../utils/email.js';

interface CalendarEvent {
  id: string;
  subject: string;
  start: {
    dateTime: string;
    timeZone: string;
  };
  attendees: {
    emailAddress: {
      address: string;
      name: string;
    };
  }[];
}

class CalendarWorker {
  private static instance: CalendarWorker;
  private isRunning: boolean = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes
  private readonly NOTIFICATION_THRESHOLD = 3 * 60 * 60 * 1000; // 3 hours

  private constructor() {}

  static getInstance(): CalendarWorker {
    if (!CalendarWorker.instance) {
      CalendarWorker.instance = new CalendarWorker();
    }
    return CalendarWorker.instance;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    console.log('📅 Starting calendar polling worker...');
    this.isRunning = true;
    this.pollInterval = setInterval(() => this.pollCalendars(), this.POLL_INTERVAL);

    // Initial poll
    await this.pollCalendars();
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isRunning = false;
    console.log('📅 Calendar polling worker stopped');
  }

  private async pollCalendars(): Promise<void> {
    console.log('🔄 Polling calendars for all users...');
    const db = await DatabaseService;
    const tokenService = await TokenService;

    try {
      // Get all active subscriptions
      const subscriptions = await db.getAllActiveSubscriptions();
      console.log(`Found ${subscriptions.length} active subscriptions`);

      for (const sub of subscriptions) {
        try {
          // Check if token needs refresh
          if (new Date(sub.token_expiry) <= new Date()) {
            console.log(`Refreshing token for ${sub.email}`);
            const newTokens = await tokenService.refreshAccessToken(sub.refresh_token);
            const newExpiry = new Date();
            newExpiry.setSeconds(newExpiry.getSeconds() + newTokens.expires_in);
            
            await db.updateAccessToken(
              sub.email,
              newTokens.access_token,
              newExpiry
            );
            sub.access_token = newTokens.access_token;
          }

          // Fetch upcoming events
          await this.checkUserCalendar(sub.email, sub.access_token);
        } catch (error) {
          console.error(`Error processing calendar for ${sub.email}:`, error);
        }
      }
    } catch (error) {
      console.error('Error in calendar polling:', error);
    }
  }

  private async checkUserCalendar(email: string, accessToken: string): Promise<void> {
    try {
      const response = await fetch(
        'https://graph.microsoft.com/v1.0/me/calendar/events?' + 
        new URLSearchParams({
          $select: 'id,subject,start,attendees,body',
          $filter: 'start/dateTime ge ' + new Date().toISOString(),
          $orderby: 'start/dateTime',
          $top: '10'
        }),
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch calendar: ${response.statusText}`);
      }

      const data = await response.json();
      const events: CalendarEvent[] = data.value;

      for (const event of events) {
        const startTime = new Date(event.start.dateTime);
        const timeUntilEvent = startTime.getTime() - new Date().getTime();

        // Check if event is about 3 hours away (+/- 5 minutes to account for polling interval)
        if (Math.abs(timeUntilEvent - this.NOTIFICATION_THRESHOLD) <= 5 * 60 * 1000) {
          // Just log the found meeting, pdfEmailAgent will handle the rest
          console.log(`🎯 Found upcoming meeting "${event.subject}" for ${email}`);
          console.log(`   Time: ${startTime.toLocaleString()}`);
          console.log(`   Attendees: ${event.attendees.length}`);
          // Trigger the main pipeline for this user
          try {
            const mod = await import('../index.js');
            // @ts-ignore: dynamic import, main is present at runtime
            if (typeof mod['main'] === 'function') {
              // @ts-ignore: dynamic import, main is present at runtime
              await mod['main'](undefined, { session: { userEmail: email } });
              console.log(`🚀 Pipeline triggered for ${email} and meeting "${event.subject}"`);
            } else {
              console.error('main function not found in index.js');
            }
          } catch (pipelineError) {
            console.error(`Error triggering pipeline for ${email}:`, pipelineError);
          }
        }
      }
    } catch (error) {
      console.error(`Error checking calendar for ${email}:`, error);
    }
  }
}


export default CalendarWorker.getInstance();