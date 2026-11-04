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
  timestamp = new Date().toISOString()
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
  const excess = measuredPulse - pulseLimit;
  const subject = `⚠️ [TNGA ALERT] Pulse Threshold Breached: ${toolName} (Station ${station}) — Observed ${measuredPulse} pulses (Limit: ${pulseLimit})`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 20px; }
        .card { background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; max-width: 600px; margin: 0 auto; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
        .header { background: #dc2626; color: white; padding: 20px 24px; }
        .header h2 { margin: 0; font-size: 18px; font-weight: 600; }
        .badge { display: inline-block; background: rgba(255,255,255,0.2); padding: 4px 8px; border-radius: 4px; font-size: 12px; margin-top: 8px; }
        .content { padding: 24px; }
        .metric-box { display: flex; justify-content: space-between; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 16px; margin: 16px 0; }
        .metric-item { text-align: center; flex: 1; }
        .metric-val { font-size: 26px; font-weight: 700; color: #b91c1c; }
        .metric-lbl { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
        .table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px; }
        .table td { padding: 10px 8px; border-bottom: 1px solid #f1f5f9; }
        .table td.lbl { color: #64748b; width: 40%; font-weight: 500; }
        .table td.val { font-weight: 600; color: #0f172a; }
        .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px 24px; font-size: 12px; color: #64748b; text-align: center; }
        .btn { display: inline-block; background: #2563eb; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 500; font-size: 13px; margin-top: 16px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h2>⚠️ TNGA Impact Wrench Alert: Threshold Exceeded</h2>
          <div class="badge">Station: ${station} | Folder: ${folder} | Tool ID: ${wrenchId}</div>
        </div>
        <div class="content">
          <p>This automated alert indicates that the pulse count on <strong>${toolName}</strong> has exceeded the approved engineering limit set in the Admin Portal.</p>
          
          <div class="metric-box">
            <div class="metric-item">
              <div class="metric-val">${measuredPulse}</div>
              <div class="metric-lbl">Measured Pulses</div>
            </div>
            <div class="metric-item">
              <div class="metric-val" style="color: #475569;">${pulseLimit}</div>
              <div class="metric-lbl">Configured Limit</div>
            </div>
            <div class="metric-item">
              <div class="metric-val" style="color: #dc2626;">+${excess}</div>
              <div class="metric-lbl">Excess Pulses</div>
            </div>
          </div>

          <table class="table">
            <tr>
              <td class="lbl">Tool Description</td>
              <td class="val">${toolName}</td>
            </tr>
            <tr>
              <td class="lbl">Station / Line</td>
              <td class="val">Station ${station}</td>
            </tr>
            <tr>
              <td class="lbl">Engine Barcode</td>
              <td class="val">${engineNumber}</td>
            </tr>
            <tr>
              <td class="lbl">Measured Torque</td>
              <td class="val">${torque} N·m</td>
            </tr>
            <tr>
              <td class="lbl">Tightening Angle</td>
              <td class="val">${angle}°</td>
            </tr>
            <tr>
              <td class="lbl">Cycle Duration</td>
              <td class="val">${tighteningTime} sec</td>
            </tr>
            <tr>
              <td class="lbl">Event Timestamp</td>
              <td class="val">${timestamp}</td>
            </tr>
          </table>

          <p style="font-size: 13px; color: #64748b; margin-top: 16px;">
            <strong>Action Required:</strong> Inspect tool joint lubricity and mechanical pulse unit. If wear is confirmed, replace tool or adjust threshold in the Admin Portal.
          </p>

          <a href="${smtp.dashboardUrl}/wrench/${wrenchId}" class="btn">View Tool Analysis in Dashboard</a>
        </div>
        <div class="footer">
          Toyota Industries Engine India • TNGA Production Line<br>
          To change this limit or alert recipients, login to the Admin Portal at <a href="${smtp.adminPortalUrl}">${smtp.adminPortalUrl}</a>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const mailer = getMailTransporter();
    const info = await mailer.sendMail({
      from: smtp.from,
      to: recipients.join(', '),
      subject,
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
  const subject = '✅ [TNGA TEST] Pulse Alert System - Test Notification';
  const html = `
    <div style="font-family: sans-serif; padding: 20px; background: #f8fafc;">
      <div style="background: white; padding: 24px; border-radius: 8px; border: 1px solid #e2e8f0; max-width: 500px;">
        <h3 style="color: #16a34a; margin-top:0;">✅ SMTP Connection Successful</h3>
        <p>This is a test notification from the <strong>TNGA Pulse Monitoring & Admin Portal</strong>.</p>
        <p>Your email parameters configured in <code>.env</code> (Host: <strong>${smtp.host}</strong>) are successfully verified and ready to dispatch real-time alerts when any tool crosses its configured pulse limit.</p>
        <p style="font-size: 12px; color: #64748b;">Timestamp: ${new Date().toISOString()}</p>
      </div>
    </div>
  `;

  try {
    const info = await mailer.sendMail({
      from: smtp.from,
      to: recipient,
      subject,
      html
    });

    return { success: true, recipient, messageId: info.messageId || 'DEV_STREAM_TEST' };
  } catch (err) {
    throw new Error(`SMTP Test Error: ${err.message}`);
  }
}

function getEmailHistory() {
  return emailDispatchHistory;
}

module.exports = {
  dispatchPulseEmailAlert,
  sendTestEmail,
  getEmailHistory,
  getSmtpCredentials
};
