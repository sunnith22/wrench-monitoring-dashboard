const fs = require('fs');
const path = require('path');
const { ALL_WRENCH_ASSETS } = require('../data/wrenchCatalog');

const CONFIG_FILE_PATH = path.join(__dirname, '../data/runtimeConfig.json');

// Default initial schedule based on TNGA production line breaks
const DEFAULT_SCHEDULE = [
  { id: 'win_1', name: 'Morning Tea Break', startTime: '10:00', endTime: '10:10', enabled: true, description: 'Line paused for morning tea break. Covers 07:45 - 10:00 production block.' },
  { id: 'win_2', name: 'Lunch Break', startTime: '13:00', endTime: '13:30', enabled: true, description: 'Line stopped for lunch break. Covers 10:00 - 13:00 production block.' },
  { id: 'win_3', name: 'Afternoon Tea Break', startTime: '15:00', endTime: '15:10', enabled: true, description: 'Line paused for afternoon tea break. Covers 13:30 - 15:00 production block.' },
  { id: 'win_4', name: 'Shift End Wrap-up', startTime: '16:40', endTime: '16:45', enabled: true, description: 'Shift 1 wrap-up before handover. Covers 15:10 - 16:40 production block.' }
];

// Default initial email alert configuration
const DEFAULT_EMAIL_CONFIG = {
  enabled: true,
  recipients: (process.env.DEFAULT_ALERT_EMAILS || 'quality.lead@plant.toyota.com,maintenance.shift1@plant.toyota.com')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean),
  cooldownMinutes: parseInt(process.env.ALERT_COOLDOWN_MINUTES || '10', 10),
  sendOnWarning: true,
  sendOnCritical: true
};

let inMemoryConfig = null;

/**
 * Initializes and loads runtime configuration from JSON file or defaults
 */
function loadConfig() {
  if (inMemoryConfig) return inMemoryConfig;

  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const raw = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
      inMemoryConfig = JSON.parse(raw);
    }
  } catch (err) {
    console.warn('[ConfigService] Could not parse runtimeConfig.json, initializing defaults:', err.message);
  }

  if (!inMemoryConfig) {
    inMemoryConfig = {
      schedule: DEFAULT_SCHEDULE,
      thresholds: {},
      emailConfig: DEFAULT_EMAIL_CONFIG,
      auditLogs: []
    };

    // Populate default thresholds for all 73 tools from catalog
    for (const tool of ALL_WRENCH_ASSETS) {
      const defLimit = tool.default_pulse_threshold || 25;
      inMemoryConfig.thresholds[tool.wrench_id] = {
        wrench_id: tool.wrench_id,
        tool_name: tool.tool_name,
        station: tool.station,
        folder: tool.folder,
        brand: tool.brand,
        line_code: tool.line_code,
        assembly_name: tool.assembly_name,
        pulse_limit: defLimit,
        warning_limit: Math.max(1, defLimit - 3),
        target_torque: tool.approved_torque_target || 22.0,
        email_trigger_enabled: true,
        updated_at: new Date().toISOString(),
        updated_by: 'System Initializer'
      };
    }

    saveConfigToDisk();
  } else {
    // Ensure any newly added wrenches in catalog have threshold entries
    let updated = false;
    if (!inMemoryConfig.thresholds) inMemoryConfig.thresholds = {};
    for (const tool of ALL_WRENCH_ASSETS) {
      if (!inMemoryConfig.thresholds[tool.wrench_id]) {
        const defLimit = tool.default_pulse_threshold || 25;
        inMemoryConfig.thresholds[tool.wrench_id] = {
          wrench_id: tool.wrench_id,
          tool_name: tool.tool_name,
          station: tool.station,
          folder: tool.folder,
          brand: tool.brand,
          line_code: tool.line_code,
          assembly_name: tool.assembly_name,
          pulse_limit: defLimit,
          warning_limit: Math.max(1, defLimit - 3),
          target_torque: tool.approved_torque_target || 22.0,
          email_trigger_enabled: true,
          updated_at: new Date().toISOString(),
          updated_by: 'System Initializer'
        };
        updated = true;
      }
    }
    if (updated) saveConfigToDisk();
  }

  return inMemoryConfig;
}

function saveConfigToDisk() {
  try {
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(inMemoryConfig, null, 2), 'utf8');
  } catch (err) {
    console.error('[ConfigService] Failed to write runtimeConfig.json:', err.message);
  }
}

function recordAudit(action, details, user = 'Admin') {
  const config = loadConfig();
  if (!config.auditLogs) config.auditLogs = [];
  config.auditLogs.unshift({
    id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    action,
    details,
    user,
    timestamp: new Date().toISOString()
  });

  // Keep last 100 audit entries
  if (config.auditLogs.length > 100) {
    config.auditLogs = config.auditLogs.slice(0, 100);
  }
  saveConfigToDisk();
}

// ---------------- SCHEDULE MANAGEMENT ----------------
function getSchedule() {
  const config = loadConfig();
  return config.schedule || DEFAULT_SCHEDULE;
}

function setSchedule(newSchedule, user = 'Admin') {
  const config = loadConfig();
  config.schedule = newSchedule;
  recordAudit('UPDATE_SCHEDULE', `Updated sync schedule (${newSchedule.length} windows defined)`, user);
  saveConfigToDisk();
  return config.schedule;
}

function addScheduleWindow(windowData, user = 'Admin') {
  const config = loadConfig();
  const id = `win_${Date.now()}`;
  const newWin = {
    id,
    name: windowData.name || 'Custom Break Window',
    startTime: windowData.startTime || '10:00',
    endTime: windowData.endTime || '10:10',
    enabled: windowData.enabled !== undefined ? windowData.enabled : true,
    description: windowData.description || 'Custom line availability extraction window'
  };
  config.schedule.push(newWin);
  recordAudit('ADD_WINDOW', `Added pulling window "${newWin.name}" (${newWin.startTime} - ${newWin.endTime})`, user);
  saveConfigToDisk();
  return newWin;
}

function updateScheduleWindow(id, updateData, user = 'Admin') {
  const config = loadConfig();
  const win = config.schedule.find(w => w.id === id);
  if (!win) return null;

  if (updateData.name !== undefined) win.name = updateData.name;
  if (updateData.startTime !== undefined) win.startTime = updateData.startTime;
  if (updateData.endTime !== undefined) win.endTime = updateData.endTime;
  if (updateData.enabled !== undefined) win.enabled = updateData.enabled;
  if (updateData.description !== undefined) win.description = updateData.description;

  recordAudit('UPDATE_WINDOW', `Updated window "${win.name}" (${win.startTime} - ${win.endTime})`, user);
  saveConfigToDisk();
  return win;
}

function deleteScheduleWindow(id, user = 'Admin') {
  const config = loadConfig();
  const idx = config.schedule.findIndex(w => w.id === id);
  if (idx === -1) return false;
  const removed = config.schedule.splice(idx, 1)[0];
  recordAudit('DELETE_WINDOW', `Deleted pulling window "${removed.name}"`, user);
  saveConfigToDisk();
  return true;
}

// ---------------- THRESHOLD MANAGEMENT ----------------
function getToolThreshold(wrenchId) {
  const config = loadConfig();
  if (config.thresholds && config.thresholds[wrenchId]) {
    return config.thresholds[wrenchId].pulse_limit;
  }
  const tool = ALL_WRENCH_ASSETS.find(w => w.wrench_id === wrenchId);
  return tool ? (tool.default_pulse_threshold || 25) : 25;
}

function getToolThresholdDetails(wrenchId) {
  const config = loadConfig();
  if (config.thresholds && config.thresholds[wrenchId]) {
    return config.thresholds[wrenchId];
  }
  const tool = ALL_WRENCH_ASSETS.find(w => w.wrench_id === wrenchId);
  const defLimit = tool ? (tool.default_pulse_threshold || 25) : 25;
  return {
    wrench_id: wrenchId,
    tool_name: tool ? tool.tool_name : 'Unknown Tool',
    station: tool ? tool.station : '',
    folder: tool ? tool.folder : '',
    brand: tool ? tool.brand : 'URYU',
    pulse_limit: defLimit,
    warning_limit: Math.max(1, defLimit - 3),
    email_trigger_enabled: true
  };
}

function getAllThresholds() {
  const config = loadConfig();
  return Object.values(config.thresholds || {});
}

function updateToolThreshold(wrenchId, { pulse_limit, warning_limit, email_trigger_enabled, target_torque, torque_min, torque_max }, user = 'Admin') {
  const config = loadConfig();
  if (!config.thresholds[wrenchId]) {
    config.thresholds[wrenchId] = getToolThresholdDetails(wrenchId);
  }

  const oldLimit = config.thresholds[wrenchId].pulse_limit;
  const newLimit = parseInt(pulse_limit, 10);
  if (isNaN(newLimit) || newLimit < 1) {
    throw new Error('Pulse limit must be a positive integer greater than 0');
  }

  config.thresholds[wrenchId].pulse_limit = newLimit;
  if (warning_limit !== undefined) {
    config.thresholds[wrenchId].warning_limit = parseInt(warning_limit, 10);
  } else {
    config.thresholds[wrenchId].warning_limit = Math.max(1, newLimit - 3);
  }

  if (email_trigger_enabled !== undefined) {
    config.thresholds[wrenchId].email_trigger_enabled = Boolean(email_trigger_enabled);
  }

  if (target_torque !== undefined && !isNaN(parseFloat(target_torque))) {
    config.thresholds[wrenchId].target_torque = parseFloat(target_torque);
  }
  if (torque_min !== undefined && !isNaN(parseFloat(torque_min))) {
    config.thresholds[wrenchId].torque_min = parseFloat(torque_min);
  }
  if (torque_max !== undefined && !isNaN(parseFloat(torque_max))) {
    config.thresholds[wrenchId].torque_max = parseFloat(torque_max);
  }

  config.thresholds[wrenchId].updated_at = new Date().toISOString();
  config.thresholds[wrenchId].updated_by = user;

  const toolName = config.thresholds[wrenchId].tool_name || wrenchId;
  recordAudit('UPDATE_THRESHOLD', `Changed parameters for ${toolName} (${wrenchId}): pulse limit ${oldLimit} -> ${newLimit}${target_torque ? `, target torque -> ${target_torque} N·m` : ''}`, user);
  saveConfigToDisk();

  return config.thresholds[wrenchId];
}

function bulkUpdateThresholds(wrenchIds, { delta, pulse_limit, email_trigger_enabled }, user = 'Admin') {
  const config = loadConfig();
  const updated = [];

  for (const wrenchId of wrenchIds) {
    if (!config.thresholds[wrenchId]) {
      config.thresholds[wrenchId] = getToolThresholdDetails(wrenchId);
    }
    const item = config.thresholds[wrenchId];
    if (pulse_limit !== undefined) {
      item.pulse_limit = parseInt(pulse_limit, 10);
    } else if (delta !== undefined) {
      item.pulse_limit = Math.max(5, item.pulse_limit + parseInt(delta, 10));
    }
    item.warning_limit = Math.max(1, item.pulse_limit - 3);
    if (email_trigger_enabled !== undefined) {
      item.email_trigger_enabled = Boolean(email_trigger_enabled);
    }
    item.updated_at = new Date().toISOString();
    item.updated_by = user;
    updated.push(item);
  }

  recordAudit('BULK_UPDATE_THRESHOLDS', `Bulk updated pulse limits for ${updated.length} tools`, user);
  saveConfigToDisk();
  return updated;
}

// ---------------- EMAIL CONFIG ----------------
function getEmailConfig() {
  const config = loadConfig();
  const cfg = config.emailConfig || DEFAULT_EMAIL_CONFIG;
  // Always inject sensitive SMTP settings dynamically from .env so passwords are never stored in JSON
  return {
    ...cfg,
    smtp: {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
      user: process.env.SMTP_USER || '',
      from: process.env.SMTP_FROM || process.env.ALERT_FROM_EMAIL || '"TNGA Pulse Alert System" <no-reply@toyota-tnga.com>'
    }
  };
}

function updateEmailConfig(updateData, user = 'Admin') {
  const config = loadConfig();
  if (!config.emailConfig) config.emailConfig = { ...DEFAULT_EMAIL_CONFIG };

  if (updateData.enabled !== undefined) config.emailConfig.enabled = Boolean(updateData.enabled);
  if (Array.isArray(updateData.recipients)) {
    config.emailConfig.recipients = updateData.recipients.map(e => e.trim().toLowerCase()).filter(Boolean);
  }
  if (updateData.cooldownMinutes !== undefined) {
    config.emailConfig.cooldownMinutes = Math.max(1, parseInt(updateData.cooldownMinutes, 10));
  }
  if (updateData.sendOnWarning !== undefined) config.emailConfig.sendOnWarning = Boolean(updateData.sendOnWarning);
  if (updateData.sendOnCritical !== undefined) config.emailConfig.sendOnCritical = Boolean(updateData.sendOnCritical);

  // Never write passwords or sensitive auth keys into runtimeConfig.json
  if (updateData.smtp) {
    const { user: _u, pass: _p, password: _pwd, ...safeSmtp } = updateData.smtp;
    config.emailConfig.smtp = {
      ...(config.emailConfig.smtp || {}),
      ...safeSmtp
    };
  }

  recordAudit('UPDATE_EMAIL_CONFIG', `Updated email alert settings (${config.emailConfig.recipients.length} recipients, cooldown: ${config.emailConfig.cooldownMinutes}m)`, user);
  saveConfigToDisk();
  return getEmailConfig();
}

function getAuditLogs() {
  const config = loadConfig();
  return config.auditLogs || [];
}

module.exports = {
  loadConfig,
  getSchedule,
  setSchedule,
  addScheduleWindow,
  updateScheduleWindow,
  deleteScheduleWindow,
  getToolThreshold,
  getToolThresholdDetails,
  getAllThresholds,
  updateToolThreshold,
  bulkUpdateThresholds,
  getEmailConfig,
  updateEmailConfig,
  getAuditLogs,
  recordAudit
};
