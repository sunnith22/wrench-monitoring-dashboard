const mongoose = require('mongoose');

const AlertEventSchema = new mongoose.Schema({
  alert_id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  wrench_id: {
    type: String,
    required: true,
    index: true
  },
  tool_name: {
    type: String,
    required: true
  },
  assembly_name: {
    type: String,
    required: true
  },
  sub_assembly_name: {
    type: String,
    required: true
  },
  station: {
    type: String,
    required: true
  },
  event_time: {
    type: Date,
    default: Date.now,
    index: true
  },
  severity: {
    type: String,
    enum: ['CRITICAL', 'WARNING', 'INFO'],
    default: 'CRITICAL'
  },
  rule_reason: {
    type: String,
    required: true
  },
  observed_value: {
    type: Number,
    required: true
  },
  threshold_limit: {
    type: Number,
    required: true
  },
  unit: {
    type: String,
    default: 'pulses'
  },
  engine_number: {
    type: String,
    default: 'N/A'
  },
  work_no: {
    type: String,
    default: '1'
  },
  status: {
    type: String,
    enum: ['OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'CLOSED'],
    default: 'OPEN',
    index: true
  },
  acknowledged_by: {
    type: String,
    default: null
  },
  acknowledged_at: {
    type: Date,
    default: null
  },
  investigation_notes: {
    type: String,
    default: ''
  },
  action_taken: {
    type: String,
    default: ''
  },
  closed_by: {
    type: String,
    default: null
  },
  closed_at: {
    type: Date,
    default: null
  }
}, { timestamps: true });

module.exports = mongoose.model('AlertEvent', AlertEventSchema);
