import { logger } from './utils/logger';

const EMAIL_API_URL = 'https://google-twitter-scraper-dublin.vercel.app/email/send';
const EXTERNAL_API_KEY = process.env.SEARCH_API_KEY || '';

export async function sendEmail(toEmail: string, subject: string, htmlContent: string): Promise<void> {
  try {
    const response = await fetch(EMAIL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': EXTERNAL_API_KEY,
      },
      body: JSON.stringify({ to_email: toEmail, subject, html_content: htmlContent }),
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to send email: ${errorData.message || response.statusText}`);
    }
    logger.info('Email sent successfully', { toEmail, subject });
  } catch (error) {
    logger.error('Error sending email', { error });
    throw error;
  }
}
