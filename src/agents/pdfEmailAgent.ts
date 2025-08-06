import puppeteer from 'puppeteer';
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import type { GraphState, CalendarEvent } from '../graph/graphState.js';
import { hasPdfBeenGenerated, markPdfAsGenerated } from '../calendar/listEvents.js';

dotenv.config();

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

/**
 * Process multiple client meetings - generate PDFs for all meetings that need them
 */
export async function processMultipleClientMeetings(state: GraphState): Promise<GraphState> {
  if (!state.calendarEvents || state.calendarEvents.length === 0) {
    console.warn('⚠️ No calendar events found for processing.');
    return state;
  }

  console.log(`\n🔄 Processing ${state.calendarEvents.length} client meetings...`);
  
  const results = [];
  const clientEventIds = (state as any).clientEventIds || [];

  for (let i = 0; i < state.calendarEvents.length; i++) {
    const event = state.calendarEvents[i];
    const eventId = clientEventIds[i];
    
    console.log(`\n📋 Processing meeting ${i + 1}/${state.calendarEvents.length}: ${event.summary}`);
    
    // Check if PDF already exists
    if (hasPdfBeenGenerated(event, eventId)) {
      console.log(`⏭️  Skipping - PDF already exists for: ${event.summary}`);
      continue;
    }
    
    try {
      // Create individual state for this meeting
      const meetingState: GraphState = {
        ...state,
        calendarEvents: [event], // Process one meeting at a time
        summary: state.summary // Assume summary is relevant to current meeting
      };
      
      const result = await generatePdfAndSendEmail(meetingState, eventId);
      results.push(result);
      
      console.log(`✅ Successfully processed: ${event.summary}`);
      
    } catch (error) {
      console.error(`❌ Error processing meeting "${event.summary}":`, error);
      // Continue with other meetings even if one fails
    }
  }
  
  console.log(`\n📊 Processing Summary:`);
  console.log(`   Total meetings: ${state.calendarEvents.length}`);
  console.log(`   Successfully processed: ${results.length}`);
  console.log(`   Skipped (already had PDFs): ${state.calendarEvents.length - results.length}`);
  
  return state;
}

/**
 * Generate PDF and send email for a single meeting (with deduplication)
 */
export async function generatePdfAndSendEmail(
  state: GraphState, 
  eventId?: string
): Promise<GraphState> {
  if (!state.summary || !state.calendarEvents || state.calendarEvents.length === 0) {
    console.warn('⚠️ No summary or calendar events found for PDF generation.');
    return state;
  }

  const currentEvent = state.calendarEvents[0];
  
  // Check if PDF already exists (double-check)
  if (hasPdfBeenGenerated(currentEvent, eventId)) {
    console.log(`⏭️  PDF already exists for: ${currentEvent.summary}`);
    return {
      ...state,
      pdfPath: 'already-exists' // Indicate PDF already exists
    };
  }
  
  try {
    console.log('📄 Starting PDF generation...');
    
    // Generate PDF from summary
    const pdfPath = await generatePdfFromSummary(state.summary, currentEvent);
    console.log(`✅ PDF generated: ${pdfPath}`);
    
    // Mark PDF as generated to prevent duplicates
    markPdfAsGenerated(currentEvent, pdfPath, eventId);
    
    // Find Cprime sales person email
    const salesPersonEmail = findCprimeSalesPerson(currentEvent);
    
    if (salesPersonEmail) {
      console.log(`📧 Sending email to: ${salesPersonEmail}`);
      await sendEmailWithPdf(pdfPath, salesPersonEmail, currentEvent, state.summary);
      console.log('✅ Email sent successfully!');
    } else {
      console.warn('⚠️ No Cprime sales person found in attendees. PDF saved but not emailed.');
    }
    
    return {
      ...state,
      pdfPath,
    };
    
  } catch (error) {
    console.error('❌ Error in PDF generation and email:', error);
    return state;
  }
}

async function generatePdfFromSummary(summary: string, event: CalendarEvent): Promise<string> {
  // Create HTML template for better PDF formatting
  const htmlContent = convertMarkdownToHtml(summary, event);
  
  // Launch headless browser
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    
    // Set content
    await page.setContent(htmlContent, {
      waitUntil: 'networkidle0'
    });
    
    // Generate PDF with timestamp to avoid conflicts
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const timeStamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[1].split('.')[0];
    const projectName = event.summary.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const fileName = `briefing-${projectName}-${timestamp}-${timeStamp}.pdf`;
    
    // Ensure summaries directory exists
    const summariesDir = path.join(process.cwd(), 'summaries');
    if (!fs.existsSync(summariesDir)) {
      fs.mkdirSync(summariesDir, { recursive: true });
    }
    
    const pdfPath = path.join(summariesDir, fileName);
    
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '15mm',
        right: '15mm',
        bottom: '15mm',
        left: '15mm'
      },
      displayHeaderFooter: true,
      headerTemplate: `
        <div style="font-size: 10px; margin: 0 auto; color: #666;">
          <span>Cprime Technologies - Pre-Call Briefing</span>
        </div>
      `,
      footerTemplate: `
        <div style="font-size: 10px; margin: 0 auto; color: #666;">
          <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        </div>
      `
    });
    
    return pdfPath;
    
  } finally {
    await browser.close();
  }
}
function convertMarkdownToHtml(markdown: string, event: CalendarEvent): string {
  // Remove content before "## CLIENT CONTEXT" to avoid duplication
  const clientContextIndex = markdown.indexOf('## CLIENT CONTEXT');
  let processedMarkdown = markdown;
  
  if (clientContextIndex !== -1) {
    // Keep only the content from "## CLIENT CONTEXT" onwards
    processedMarkdown = markdown.substring(clientContextIndex);
  }
  
  // Convert markdown to HTML with professional styling - USE PROCESSED MARKDOWN
  let html = processedMarkdown
    .replace(/^# (.*$)/gm, '<h1>$1</h1>')
    .replace(/^## (.*$)/gm, '<h2>$1</h2>')
    .replace(/^### (.*$)/gm, '<h3>$1</h3>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Fixed: removed ^ anchor, made global
    .replace(/^\* (.*$)/gm, '<li>$1</li>')
    .replace(/^(\d+)\. (.*$)/gm, '<li>$1. $2</li>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\n\n/g, '</p><p>') // This creates paragraph breaks
    .replace(/\n/g, '<br>'); // This converts single line breaks to <br>
  
  // Wrap the entire content in paragraph tags first
  html = `<p>${html}</p>`;
  
  // Fix empty paragraphs and clean up formatting
  html = html
    .replace(/<p><\/p>/g, '') // Remove empty paragraphs
    .replace(/<p>(<h[1-6]>)/g, '$1') // Remove <p> before headers
    .replace(/(<\/h[1-6]>)<\/p>/g, '$1') // Remove </p> after headers
    .replace(/<p>(<hr>)<\/p>/g, '$1') // Remove <p> around <hr>
    .replace(/<p>(<li>.*?<\/li>)<\/p>/gs, '$1') // Remove <p> around list items
    .replace(/<br>\s*(<\/p>)/g, '$1') // Remove <br> before closing </p>
    .replace(/(<p>)\s*<br>/g, '$1') // Remove <br> after opening <p>
    .replace(/<p>\s*<\/p>/g, ''); // Remove any remaining empty paragraphs
  
  // Wrap orphaned <li> elements in <ul> tags
  html = html.replace(/(<li>.*?<\/li>)(?:\s*<li>.*?<\/li>)*/gs, (match) => {
    return `<ul>${match}</ul>`;
  });
  
  // Clean up any remaining formatting issues
  html = html
    .replace(/<\/ul>\s*<ul>/g, '') // Merge adjacent <ul> tags
    .replace(/<br>\s*(<h[1-6]>)/g, '$1') // Remove <br> before headers
    .replace(/(<\/h[1-6]>)\s*<br>/g, '$1') // Remove <br> after headers
    .replace(/<br>\s*(<ul>)/g, '$1') // Remove <br> before lists
    .replace(/(<\/ul>)\s*<br>/g, '$1'); // Remove <br> after lists
  
  // Get time until meeting for urgency context
  const now = new Date();
  const meetingTime = new Date(event.startTime);
  const diffMs = meetingTime.getTime() - now.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  let urgencyBadge = '';
  if (diffHours < 1) {
    urgencyBadge = `<div style="background: #e74c3c; color: white; padding: 10px 18px; border-radius: 15px; display: inline-block; margin-bottom: 18px; font-size: 16px; font-weight: bold;">🚨 URGENT: Meeting in ${diffMinutes} minutes</div>`;
  } else if (diffHours <= 2) {
    urgencyBadge = `<div style="background: #f39c12; color: white; padding: 10px 18px; border-radius: 15px; display: inline-block; margin-bottom: 18px; font-size: 16px; font-weight: bold;">⏰ Soon: Meeting in ${diffHours}h ${diffMinutes}m</div>`;
  }
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Pre-Call Briefing - ${event.summary}</title>
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 800px;
          margin: 0 auto;
          padding: 22px;
          background: #fff;
          font-size: 16px;
        }
        
        h1 {
          color: #2c5aa0;
          border-bottom: 2px solid #2c5aa0;
          padding-bottom: 10px;
          font-size: 28px;
          margin-top: 0;
          margin-bottom: 16px;
        }
        
        h2 {
          color: #34495e;
          font-size: 22px;
          margin-top: 20px;
          margin-bottom: 12px;
          border-left: 3px solid #3498db;
          padding-left: 14px;
        }
        
        h3 {
          color: #2c3e50;
          font-size: 18px;
          margin-top: 16px;
          margin-bottom: 8px;
          font-weight: 600;
        }
        
        p {
          margin-bottom: 12px;
          text-align: justify;
          line-height: 1.6;
          font-size: 16px;
        }
        
        ul, ol {
          margin-bottom: 12px;
          margin-top: 6px;
          padding-left: 28px;
        }
        
        li {
          margin-bottom: 6px;
          list-style-type: none;
          position: relative;
          line-height: 1.5;
          font-size: 16px;
        }
        
        li:before {
          content: "▸";
          color: #3498db;
          position: absolute;
          left: -20px;
          font-size: 14px;
        }
        
        hr {
          border: none;
          border-top: 1px solid #ecf0f1;
          margin: 18px 0;
        }
        
        strong {
          color: #2c3e50;
          font-weight: 600;
        }
        
        .meeting-header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 20px;
          border-radius: 6px;
          margin-bottom: 25px;
          text-align: center;
        }
        
        .meeting-header h1 {
          color: white;
          border: none;
          margin: 0;
          font-size: 26px;
        }
        
        .meeting-details {
          background: #f8f9fa;
          padding: 16px 20px;
          border-radius: 4px;
          margin-bottom: 20px;
          border-left: 3px solid #28a745;
          font-size: 15px;
        }
        
        .cprime-logo {
          text-align: center;
          margin-bottom: 25px;
          color: #2c5aa0;
          font-size: 20px;
          font-weight: bold;
        }
        
        .confidential {
          text-align: center;
          color: #e74c3c;
          font-size: 12px;
          margin-top: 25px;
          font-style: italic;
        }
        
        .compact-section h2 {
          margin-top: 18px;
          margin-bottom: 10px;
        }
        
        .compact-section h3 {
          margin-top: 14px;
          margin-bottom: 8px;
        }
        
        .compact-section p {
          margin-bottom: 10px;
        }
        
        .compact-section ul {
          margin-top: 6px;
          margin-bottom: 10px;
        }
        
        .compact-section li {
          margin-bottom: 4px;
          line-height: 1.5;
        }
        
        @media print {
          body { 
            margin: 0; 
            font-size: 15px;
          }
          .page-break { 
            page-break-before: always; 
          }
          .avoid-break {
            page-break-inside: avoid;
          }
        }
      </style>
    </head>
    <body>
      <div class="cprime-logo">🚀 CPRIME TECHNOLOGIES</div>
      <div class="meeting-header">
        <h1>PRE-CALL BRIEFING DOCUMENT</h1>
        <p style="margin: 10px 0 0 0; font-size: 16px;">Confidential & Internal Use Only</p>
      </div>
      
      ${urgencyBadge}
      
      <div class="meeting-details">
        <strong>Meeting:</strong> ${event.summary}<br>
        <strong>Date:</strong> ${new Date(event.startTime).toLocaleString()}
      </div>
      
      <div class="compact-section">
        ${html}
      </div>
      
      <div class="confidential">
        This document contains confidential and proprietary information. 
        Distribution is restricted to authorized Cprime personnel only.
      </div>
    </body>
    </html>
  `;
}

function findCprimeSalesPerson(event: CalendarEvent): string | null {
  const cprimeAttendee = event.attendees.find(email => 
    email.toLowerCase().includes('licet.ac.in')
  );
  
  return cprimeAttendee || null;
}

function convertSummaryToEmailHtml(summary: string): string {
  let html = summary
    .replace(/^# (.*$)/gm, '<h2 style="color: #2c5aa0; margin-top: 25px; margin-bottom: 15px;">$1</h2>')
    .replace(/^## (.*$)/gm, '<h3 style="color: #34495e; margin-top: 20px; margin-bottom: 12px; border-left: 3px solid #3498db; padding-left: 12px;">$1</h3>')
    .replace(/^### (.*$)/gm, '<h4 style="color: #2c3e50; margin-top: 15px; margin-bottom: 10px;">$1</h4>')
    .replace(/^\*\*(.*?)\*\*/gm, '<strong style="color: #2c3e50;">$1</strong>')
    .replace(/^\* (.*$)/gm, '<li style="margin-bottom: 6px;">$1</li>')
    .replace(/^(\d+)\. (.*$)/gm, '<li style="margin-bottom: 6px;">$2</li>')
    .replace(/^---$/gm, '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">')
    .replace(/\n\n/g, '</p><p style="margin-bottom: 12px; line-height: 1.6;">')
    .replace(/\n/g, '<br>');
  
  html = html.replace(/(<li[^>]*>.*?<\/li>)/gs, '<ul style="margin: 10px 0; padding-left: 20px;">$1</ul>');
  
  return `<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">${html}</div>`;
}

async function sendEmailWithPdf(
  pdfPath: string, 
  recipientEmail: string, 
  event: CalendarEvent,
  summary: string
): Promise<void> {
  const emailConfig: EmailConfig = {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
  };

  const transporter = nodemailer.createTransport(emailConfig);

  const meetingDate = new Date(event.startTime).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  // Calculate urgency for email subject
  const now = new Date();
  const meetingTime = new Date(event.startTime);
  const diffMs = meetingTime.getTime() - now.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  let urgencyPrefix = '';
  if (diffHours < 1) {
    urgencyPrefix = '🚨 URGENT - ';
  } else if (diffHours <= 2) {
    urgencyPrefix = '⏰ SOON - ';
  }

  const emailSubject = `${urgencyPrefix}📋 Pre-Call Briefing: ${event.summary}`;
  
  const summaryHtml = convertSummaryToEmailHtml(summary);
  
  // Add urgency banner to email if needed
  let urgencyBanner = '';
  if (diffHours < 1) {
    urgencyBanner = `
      <div style="background: #e74c3c; color: white; padding: 15px; text-align: center; border-radius: 8px; margin-bottom: 20px; font-weight: bold;">
        🚨 URGENT: Meeting starts in ${diffMinutes} minutes!
      </div>
    `;
  } else if (diffHours <= 2) {
    urgencyBanner = `
      <div style="background: #f39c12; color: white; padding: 15px; text-align: center; border-radius: 8px; margin-bottom: 20px; font-weight: bold;">
        ⏰ Meeting starts in ${diffHours}h ${diffMinutes}m
      </div>
    `;
  }
  
  const emailBody = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; border-radius: 8px; margin-bottom: 25px;">
        <h1 style="margin: 0; color: white; font-size: 24px;">🚀 Cprime Pre-Call Briefing</h1>
        <p style="margin: 8px 0 0 0; font-size: 16px; opacity: 0.9;">Confidential & Internal Use Only</p>
      </div>
      
      ${urgencyBanner}
      
      <div style="background: #f8f9fa; padding: 15px; border-left: 4px solid #28a745; margin-bottom: 25px; border-radius: 4px;">
        <div style="margin-bottom: 8px;"><strong style="color: #2c5aa0;">📅 Meeting:</strong> ${event.summary}</div>
        <div style="margin-bottom: 8px;"><strong style="color: #2c5aa0;">🕐 Date:</strong> ${meetingDate}</div>
        <div><strong style="color: #2c5aa0;">📎 Attachment:</strong> Detailed PDF briefing included</div>
      </div>
      
      ${summaryHtml}
      
      <div style="background: #e8f4fd; padding: 15px; border-radius: 6px; margin-top: 30px; border-left: 4px solid #3498db;">
        <p style="margin: 0; font-size: 14px; color: #2c5aa0;"><strong>💡 Quick Access:</strong> 
        This email contains the full briefing content for quick reference. The attached PDF provides the same information in a formatted document for sharing or printing.</p>
      </div>
      
      <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
      
      <p style="font-size: 12px; color: #666; margin: 0;">
        This briefing was automatically generated by Cprime's AI Pre-Call Preparation System.<br>
        For questions or feedback, contact the Business Development team.
      </p>
    </div>
  `;

  const mailOptions = {
    from: `"Cprime AI Assistant" <${emailConfig.auth.user}>`,
    to: recipientEmail,
    subject: emailSubject,
    html: emailBody,
    attachments: [
      {
        filename: path.basename(pdfPath),
        path: pdfPath,
        contentType: 'application/pdf'
      }
    ]
  };

  await transporter.sendMail(mailOptions);
}

// Enhanced GraphState interface to include PDF path
declare module '../graph/graphState.js' {
  interface GraphState {
    pdfPath?: string;
    clientEventIds?: string[];
  }
}