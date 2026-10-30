const mongoose = require('mongoose');

const ToolChangeLogSchema = new mongoose.Schema({
  change_id: {
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
  change_timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  pulses_at_change: {
    type: Number,
    required: true
  },
  change_type: {
    type: String,
    enum: ['PLANNED_THRESHOLD', 'UNPLANNED_FAULT', 'QUALITY_CONCERN', 'PREVENTATIVE'],
    default: 'PLANNED_THRESHOLD'
  },
  removed_tool_serial: {
    type: String,
    required: true
  },
  replacement_tool_serial: {
    type: String,
    required: true
  },
  technician_name: {
    type: String,
    required: true
  },
  comments: {
    type: String,
    default: ''
  }
}, { timestamps: true });

module.exports = mongoose.model('ToolChangeLog', ToolChangeLogSchema);
