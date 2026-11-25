const nodemailer = require('nodemailer');
const { getEmailConfig, getToolThresholdDetails } = require('./configService');

// Map of tool_id => last email sent timestamp ms (in-memory cooldown guard)
const lastSentTimestamps = new Map();
const emailDispatchHistory = [];

/**
 * Sensitive SMTP & Notification credentials sourced strictly from Environment Variables (.env)
 * No passwords, hostnames, or auth keys are hardcoded or stored in JSON files.
 */
function getSmtpCredentials() {
  return {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '',
    from: process.env.SMTP_FROM || process.env.ALERT_FROM_EMAIL || '"TNGA Pulse Alert System" <no-reply@toyota-tnga.com>',
    dashboardUrl: process.env.MAIN_DASHBOARD_URL || 'http://localhost:3010',
    adminPortalUrl: process.env.ADMIN_PORTAL_URL || 'http://localhost:3020'
  };
}

/**
 * Builds resilient Nodemailer Transporter using strictly environment credentials
 */
function getMailTransporter() {
  const smtp = getSmtpCredentials();

  // If environment provides valid SMTP credentials, use real authenticated transport
  if (smtp.user && smtp.pass) {
    return nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: {
        user: smtp.user,
        pass: smtp.pass
      },
      tls: {
        rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false'
      }
    });
  }

  // Fallback / Development mode (unconfigured SMTP in .env): logs to safe stream output without crashing
  return nodemailer.createTransport({
    streamTransport: true,
    newline: 'windows',
    buffer: true
  });
}

/**
 * Check if tool is currently in alert cooldown
 */
function isCooldownActive(wrenchId, cooldownMinutes = 10) {
  const lastTime = lastSentTimestamps.get(wrenchId);
  if (!lastTime) return false;
  const elapsed = (Date.now() - lastTime) / (60 * 1000);
  return elapsed < cooldownMinutes;
}

/**
 * Dispatches an automated email when a tool's pulse count breaches the configured limit
 */
async function dispatchPulseEmailAlert({
  wrenchId,
  toolName,
  station,
  folder,
  measuredPulse,
  pulseLimit,
  engineNumber = 'NG60201',
  torque = 22.0,
  angle = 45.0,
  tighteningTime = 1.45,
  timestamp = new Date().toISOString(),
  consecutiveBreaches = 1,
  recentPulses = []
}) {
  const emailConfig = getEmailConfig();
  if (!emailConfig.enabled) {
    console.log(`[Email Alert] Suppressed for ${wrenchId}: Master switch is disabled.`);
    return { status: 'DISABLED', reason: 'Email alerts globally disabled' };
  }

  const cooldown = emailConfig.cooldownMinutes || parseInt(process.env.ALERT_COOLDOWN_MINUTES || '10', 10);
  if (isCooldownActive(wrenchId, cooldown)) {
    console.log(`[Email Alert] Cooldown active for ${wrenchId} (${cooldown}m window). Skipping duplicate alert.`);
    return { status: 'COOLDOWN', reason: `In cooldown (${cooldown}m)` };
  }

  // Resolve recipients: dynamic Admin Portal list, with fallback to .env DEFAULT_ALERT_EMAILS
  let recipients = emailConfig.recipients || [];
  if (recipients.length === 0 && process.env.DEFAULT_ALERT_EMAILS) {
    recipients = process.env.DEFAULT_ALERT_EMAILS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }

  if (recipients.length === 0) {
    console.warn(`[Email Alert] No recipients configured in Admin Portal or .env. Alert not sent.`);
    return { status: 'NO_RECIPIENTS', reason: 'No recipients configured' };
  }

  const smtp = getSmtpCredentials();
  const subject = `[TNGA Alert] Station ${station} - ${toolName}: ${measuredPulse} pulses (Limit: ${pulseLimit})`;
  const streakLine = consecutiveBreaches > 1
    ? `Sustained Breach: ${consecutiveBreaches} consecutive cycles (${recentPulses.join(', ')})`
    : '';
  const streakHtml = consecutiveBreaches > 1
    ? `<strong>Sustained Breach:</strong> ${consecutiveBreaches} consecutive cycles (${recentPulses.join(', ')})<br>\n        `
    : '';

  const textContent = [
    `TNGA Impact Wrench Pulse Alert`,
    ``,
    `Tool: ${toolName} (${wrenchId})`,
    `Station: ${station} | Folder: ${folder}`,
    `Measured Pulses: ${measuredPulse} (Limit: ${pulseLimit})`,
    ...(streakLine ? [streakLine] : []),
    `Torque: ${torque} N·m`,
    `Time: ${timestamp}`,
    ``,
    `Dashboard: ${smtp.dashboardUrl}`
  ].join('\n');

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; font-size: 14px; color: #111827; line-height: 1.6;">
      <p><strong>TNGA Impact Wrench Pulse Alert</strong></p>
      <p>
        <strong>Tool:</strong> ${toolName} (${wrenchId})<br>
        <strong>Station:</strong> ${station} | <strong>Folder:</strong> ${folder}<br>
        <strong>Measured Pulses:</strong> <span style="color: #dc2626;"><strong>${measuredPulse}</strong></span> (Limit: ${pulseLimit})<br>
        ${streakHtml}<strong>Torque:</strong> ${torque} N·m<br>
        <strong>Time:</strong> ${timestamp}
      </p>
      <p><a href="${smtp.dashboardUrl}">Open Monitoring Dashboard</a></p>
    </div>
  `;

  try {
    const mailer = getMailTransporter();
    const info = await mailer.sendMail({
      from: smtp.from,
      to: recipients.join(', '),
      subject,
      text: textContent,
      html: htmlContent
    });

    lastSentTimestamps.set(wrenchId, Date.now());

    const dispatchRecord = {
      id: `mail_${Date.now()}`,
      wrenchId,
      toolName,
      station,
      measuredPulse,
      pulseLimit,
      recipients,
      timestamp: new Date().toISOString(),
      status: 'SENT',
      messageId: info.messageId || 'DEV_STREAM_LOGGED'
    };

    emailDispatchHistory.unshift(dispatchRecord);
    if (emailDispatchHistory.length > 50) emailDispatchHistory.pop();

    console.log(`✅ [Email Alert Sent] ${toolName}: ${measuredPulse} pulses (Limit: ${pulseLimit}) -> Dispatched to ${recipients.length} recipients.`);
    return { status: 'SENT', details: dispatchRecord };
  } catch (err) {
    console.error(`❌ [Email Alert Failed] Error sending alert for ${wrenchId}:`, err.message);
    return { status: 'FAILED', error: err.message };
  }
}

/**
 * Sends a test email to verify SMTP configuration from .env
 */
async function sendTestEmail(testRecipient) {
  const config = getEmailConfig();
  const recipient = testRecipient || (config.recipients && config.recipients[0]) || process.env.TEST_EMAIL_RECIPIENT || 'test@plant.toyota.com';
  const smtp = getSmtpCredentials();

  const mailer = getMailTransporter();
  const subject = '[TNGA Test] Pulse Alert System Verification';
  const text = `TNGA Pulse Alert System test email verified.\nSMTP Host: ${smtp.host}\nTime: ${new Date().toISOString()}`;
  const html = `
    <div style="font-family: Arial, sans-serif; font-size: 14px; color: #111827; line-height: 1.6;">
      <p><strong>TNGA Pulse Alert System - Test Email</strong></p>
      <p>Your email configuration (SMTP Host: ${smtp.host}) is verified and ready to send pulse limit alerts.</p>
      <p style="font-size: 12px; color: #6b7280;">Time: ${new Date().toISOString()}</p>
    </div>
  `;

  try {
    const info = await mailer.sendMail({
      from: smtp.from,
      to: recipient,
      subject,
      text,
      html
    });

    return { success: true, recipient, messageId: info.messageId || 'DEV_STREAM_TEST' };
  } catch (err) {
    throw new Error(`SMTP Test Error: ${err.message}`);
  }
}

/**
 * Sends a 6-digit Admin password-reset OTP to the configured recovery email.
 */
async function sendAdminOtpEmail(recipientEmail, otpCode, expiresMinutes = 10) {
  const smtp = getSmtpCredentials();
  const isSmtpConfigured = Boolean(smtp.user && smtp.pass);
  const mailer = getMailTransporter();
  const subject = '[TNGA Admin Portal] Password Reset OTP';
  const text = [
    'TNGA Admin Portal - Password Reset OTP',
    '',
    `Your One-Time Password (OTP) is: ${otpCode}`,
    '',
    `This code expires in ${expiresMinutes} minutes.`,
    'If you did not request a password reset, please ignore this email.'
  ].join('\n');
  const html = `
    <div style="font-family: Arial, sans-serif; font-size: 14px; color: #111827; line-height: 1.6;">
      <p><strong>TNGA Admin Portal - Password Reset OTP</strong></p>
      <p>Your One-Time Password (OTP) is: <strong style="font-size: 18px; letter-spacing: 2px;">${otpCode}</strong></p>
      <p>This code is valid for ${expiresMinutes} minutes.</p>
    </div>
  `;

  try {
    const info = await mailer.sendMail({
      from: smtp.from,
      to: recipientEmail,
      subject,
      text,
      html
    });

    if (isSmtpConfigured) {
      console.log(`✅ [Admin OTP Email Sent] Reset OTP dispatched to ${recipientEmail}.`);
    } else {
      console.log(`ℹ️ [Admin OTP Dev Mode] SMTP credentials not set in .env. OTP for ${recipientEmail}: ${otpCode}`);
    }

    return {
      success: true,
      smtpConfigured: isSmtpConfigured,
      recipient: recipientEmail,
      messageId: info.messageId || 'DEV_STREAM_OTP'
    };
  } catch (err) {
    throw new Error(`Failed to send OTP email: ${err.message}`);
  }
}

function getEmailHistory() {
  return emailDispatchHistory;
}

module.exports = {
  dispatchPulseEmailAlert,
  sendTestEmail,
  sendAdminOtpEmail,
  getEmailHistory,
  getSmtpCredentials
};
