const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();
const configService = require('../services/configService');
const { runSyncPass, getSyncStatus } = require('../services/shiftSyncWorker');
const { sendTestEmail, sendAdminOtpEmail, getEmailHistory } = require('../services/emailService');

const ENV_FILE_PATH = path.resolve(__dirname, '../../.env');
const DEFAULT_RECOVERY_EMAIL = 'g.sunnith@tiei.toyota-industries.com';
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

let pendingOtpReset = null;

function getAdminCredentials() {
  return {
    username: process.env.ADMIN_USER || 'admin',
    password: process.env.ADMIN_PASS || 'Tiei@2026',
    recoveryEmail: process.env.ADMIN_RECOVERY_EMAIL || DEFAULT_RECOVERY_EMAIL
  };
}

function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp)).digest();
}

function persistAdminPasswordToEnv(newPassword) {
  let content = '';
  try {
    if (fs.existsSync(ENV_FILE_PATH)) {
      content = fs.readFileSync(ENV_FILE_PATH, 'utf8');
    }
  } catch (err) {
    throw new Error(`Could not read .env file: ${err.message}`);
  }

  const lines = content ? content.split(/\r?\n/) : [];
  let replaced = false;
  const updatedLines = lines.map(line => {
    if (/^\s*ADMIN_PASS\s*=/.test(line)) {
      replaced = true;
      return `ADMIN_PASS=${newPassword}`;
    }
    return line;
  });

  if (!replaced) {
    updatedLines.push(`ADMIN_PASS=${newPassword}`);
  }

  fs.writeFileSync(ENV_FILE_PATH, updatedLines.join('\n'), 'utf8');
}

/**
 * Middleware: Simple Bearer / Session Auth Guard for Admin Actions
 */
function requireAdminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ success: false, message: 'Authorization header missing' });
  }

  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (token.startsWith('tnga_admin_token_')) {
    req.adminUser = getAdminCredentials().username;
    return next();
  }

  return res.status(403).json({ success: false, message: 'Invalid or expired admin session token' });
}

// ---------------- 1. AUTHENTICATION ----------------
router.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  const creds = getAdminCredentials();

  if (username === creds.username && password === creds.password) {
    const token = `tnga_admin_token_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    configService.recordAudit('LOGIN', `Admin user "${username}" logged in successfully`, username);
    return res.json({
      success: true,
      token,
      user: {
        username: creds.username,
        role: 'SUPER_ADMIN',
        permissions: ['MANAGE_SCHEDULE', 'MANAGE_THRESHOLDS', 'MANAGE_EMAIL_ALERTS']
      }
    });
  }

  return res.status(401).json({
    success: false,
    message: 'Invalid administrator credentials. Please check username and password.'
  });
});

router.post('/auth/forgot-password', async (req, res) => {
  try {
    const { recoveryEmail } = getAdminCredentials();
    const now = Date.now();

    if (pendingOtpReset && (now - pendingOtpReset.requestedAt) < OTP_RESEND_COOLDOWN_MS && now < pendingOtpReset.expiresAt) {
      const waitSec = Math.ceil((OTP_RESEND_COOLDOWN_MS - (now - pendingOtpReset.requestedAt)) / 1000);
      return res.status(429).json({
        success: false,
        message: `Please wait ${waitSec}s before requesting another OTP.`
      });
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    pendingOtpReset = {
      otpHash: hashOtp(otp),
      expiresAt: now + OTP_TTL_MS,
      requestedAt: now,
      attempts: 0,
      recipient: recoveryEmail
    };

    const mailResult = await sendAdminOtpEmail(recoveryEmail, otp, 10);
    configService.recordAudit('ADMIN_OTP_REQUESTED', `Password reset OTP dispatched to ${recoveryEmail}`, 'system');

    return res.json({
      success: true,
      recipient: recoveryEmail,
      smtpConfigured: mailResult.smtpConfigured,
      expiresInMinutes: 10,
      message: mailResult.smtpConfigured
        ? `A 6-digit OTP has been sent to ${recoveryEmail}.`
        : `OTP generated for ${recoveryEmail} (configure SMTP_USER & SMTP_PASS in .env to send email; check server log in dev mode).`
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/auth/reset-password', (req, res) => {
  try {
    const { otp, newPassword } = req.body || {};

    if (!pendingOtpReset) {
      return res.status(400).json({
        success: false,
        message: 'No active OTP request found. Please click "Forgot Password?" to request a new OTP.'
      });
    }

    if (Date.now() > pendingOtpReset.expiresAt) {
      pendingOtpReset = null;
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new OTP.'
      });
    }

    const otpStr = String(otp || '').trim();
    if (!/^\d{6}$/.test(otpStr)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid 6-digit OTP code.'
      });
    }

    const submittedHash = hashOtp(otpStr);
    const isMatch = submittedHash.length === pendingOtpReset.otpHash.length &&
      crypto.timingSafeEqual(submittedHash, pendingOtpReset.otpHash);

    if (!isMatch) {
      pendingOtpReset.attempts += 1;
      if (pendingOtpReset.attempts >= MAX_OTP_ATTEMPTS) {
        pendingOtpReset = null;
        return res.status(400).json({
          success: false,
          message: 'Too many invalid OTP attempts. Please request a new OTP.'
        });
      }
      return res.status(400).json({
        success: false,
        message: `Invalid OTP code (${MAX_OTP_ATTEMPTS - pendingOtpReset.attempts} attempts remaining).`
      });
    }

    if (typeof newPassword !== 'string' || newPassword.length < 6 || newPassword.length > 128 || /[\r\n#]/.test(newPassword)) {
      return res.status(400).json({
        success: false,
        message: 'New password must be 6–128 characters and cannot contain line breaks or "#".'
      });
    }

    process.env.ADMIN_PASS = newPassword;
    persistAdminPasswordToEnv(newPassword);
    pendingOtpReset = null;

    configService.recordAudit('ADMIN_PASSWORD_RESET', 'Admin password reset via OTP and saved to .env', 'admin');

    return res.json({
      success: true,
      message: 'Password reset successfully and saved to .env. Please sign in with your new password.'
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/auth/verify', requireAdminAuth, (req, res) => {
  res.json({ success: true, user: req.adminUser, valid: true });
});

// ---------------- 2. DYNAMIC SCHEDULE MANAGEMENT ----------------
router.get('/schedule', (req, res) => {
  const schedule = configService.getSchedule();
  const syncStatus = getSyncStatus();
  res.json({
    success: true,
    schedule,
    syncStatus
  });
});

router.post('/schedule', requireAdminAuth, (req, res) => {
  try {
    const { name, startTime, endTime, enabled, description } = req.body;
    if (!startTime || !endTime) {
      return res.status(400).json({ success: false, message: 'startTime and endTime are required (HH:mm format)' });
    }

    const created = configService.addScheduleWindow({ name, startTime, endTime, enabled, description }, req.adminUser);
    res.json({ success: true, window: created });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/schedule/:id', requireAdminAuth, (req, res) => {
  try {
    const { id } = req.params;
    const updated = configService.updateScheduleWindow(id, req.body, req.adminUser);
    if (!updated) {
      return res.status(404).json({ success: false, message: `Window '${id}' not found` });
    }
    res.json({ success: true, window: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/schedule/:id', requireAdminAuth, (req, res) => {
  try {
    const { id } = req.params;
    const deleted = configService.deleteScheduleWindow(id, req.adminUser);
    if (!deleted) {
      return res.status(404).json({ success: false, message: `Window '${id}' not found` });
    }
    res.json({ success: true, message: 'Window successfully removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Force Instant Trigger
router.post('/schedule/trigger-now', requireAdminAuth, async (req, res) => {
  try {
    configService.recordAudit('MANUAL_SYNC_TRIGGERED', 'Manual data extraction initiated via Admin Portal', req.adminUser);
    const result = await runSyncPass(`Admin Manual Trigger (${req.adminUser})`);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------- 3. PULSE COUNT THRESHOLD MANAGEMENT ----------------
// GET all 73 tools and current thresholds
router.get('/thresholds', (req, res) => {
  try {
    const { assembly, search } = req.query;
    let list = configService.getAllThresholds();

    if (assembly && assembly !== 'ALL') {
      list = list.filter(t => t.assembly_name === assembly || t.line_code === assembly);
    }

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(t =>
        t.wrench_id.toLowerCase().includes(q) ||
        t.tool_name.toLowerCase().includes(q) ||
        String(t.station).toLowerCase().includes(q) ||
        String(t.folder).includes(q)
      );
    }

    res.json({
      success: true,
      count: list.length,
      data: list
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update threshold for a specific tool (e.g. change 25 to 26!)
router.put('/thresholds/:wrenchId', requireAdminAuth, (req, res) => {
  try {
    const { wrenchId } = req.params;
    const { pulse_limit, warning_limit, email_trigger_enabled, target_torque, torque_min, torque_max } = req.body;

    if (pulse_limit === undefined) {
      return res.status(400).json({ success: false, message: 'pulse_limit is required' });
    }

    const updated = configService.updateToolThreshold(
      wrenchId,
      { pulse_limit, warning_limit, email_trigger_enabled, target_torque, torque_min, torque_max },
      req.adminUser
    );

    res.json({
      success: true,
      message: `Pulse count limit for ${updated.tool_name} successfully updated to ${updated.pulse_limit}!`,
      data: updated
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Bulk Update
router.put('/thresholds-bulk', requireAdminAuth, (req, res) => {
  try {
    const { wrenchIds, delta, pulse_limit, email_trigger_enabled } = req.body;
    if (!Array.isArray(wrenchIds) || wrenchIds.length === 0) {
      return res.status(400).json({ success: false, message: 'wrenchIds array is required' });
    }

    const updated = configService.bulkUpdateThresholds(
      wrenchIds,
      { delta, pulse_limit, email_trigger_enabled },
      req.adminUser
    );

    res.json({
      success: true,
      message: `Successfully updated pulse limits for ${updated.length} tools!`,
      count: updated.length,
      data: updated
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ---------------- 4. EMAIL TRIGGER SETTINGS ----------------
router.get('/email-config', (req, res) => {
  const emailConfig = configService.getEmailConfig();
  res.json({ success: true, emailConfig });
});

router.put('/email-config', requireAdminAuth, (req, res) => {
  try {
    const updated = configService.updateEmailConfig(req.body, req.adminUser);
    res.json({
      success: true,
      message: 'Email alert configuration updated successfully!',
      emailConfig: updated
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/email-config/test', requireAdminAuth, async (req, res) => {
  try {
    const { testRecipient } = req.body;
    const result = await sendTestEmail(testRecipient);
    configService.recordAudit('TEST_EMAIL_SENT', `Sent test alert email to ${result.recipient}`, req.adminUser);
    res.json({ success: true, message: `Test email dispatched to ${result.recipient}`, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/email-history', requireAdminAuth, (req, res) => {
  res.json({ success: true, history: getEmailHistory() });
});

// ---------------- 5. AUDIT LOGS & HEALTH ----------------
router.get('/audit-logs', (req, res) => {
  res.json({ success: true, logs: configService.getAuditLogs() });
});

router.get('/sync-status', (req, res) => {
  res.json({ success: true, status: getSyncStatus() });
});

module.exports = router;
