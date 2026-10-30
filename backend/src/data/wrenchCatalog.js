/**
 * Master TNGA Impact Wrench Asset Register & Assembly Mapping
 * Covers all 73 production wrenches across Assembly 1, 2, and 3
 */

const RAW_URYU_TOOLS = [
  { contr_no: "1", station: "28", folder: "016", tool_name: "Ex manifold stud", line: "MK1", defaultThreshold: 25, targetTorque: 22.0, torqueMin: 18.0, torqueMax: 26.0 },
  { contr_no: "2", station: "Cam housing sub assy", folder: "005", tool_name: "Cam cap bolt", line: "CHS", defaultThreshold: 22, targetTorque: 14.5, torqueMin: 12.0, torqueMax: 17.0 },
  { contr_no: "3", station: "Cam housing sub assy", folder: "006", tool_name: "D4 lifter guide", line: "CHS", defaultThreshold: 20, targetTorque: 10.0, torqueMin: 8.5, torqueMax: 11.5 },
  { contr_no: "4", station: "Block sub assy", folder: "007", tool_name: "Oil jet bolt (Nozzle No.1)", line: "BS", defaultThreshold: 24, targetTorque: 18.0, torqueMin: 15.0, torqueMax: 21.0 },
  { contr_no: "5", station: "51", folder: "017", tool_name: "Knock sensor bolt", line: "MK3", defaultThreshold: 20, targetTorque: 20.0, torqueMin: 17.0, torqueMax: 23.0 },
  { contr_no: "6", station: "Block sub assy", folder: "015", tool_name: "Oil pump bolt", line: "BS", defaultThreshold: 25, targetTorque: 21.0, torqueMin: 18.0, torqueMax: 24.0 },
  { contr_no: "7", station: "Block sub assy", folder: "040", tool_name: "Oil strainer bolt", line: "BS", defaultThreshold: 22, targetTorque: 12.0, torqueMin: 10.0, torqueMax: 14.0 },
  { contr_no: "8", station: "Block sub assy", folder: "001", tool_name: "Crank case bolt", line: "BS", defaultThreshold: 30, targetTorque: 35.0, torqueMin: 31.0, torqueMax: 39.0 },
  { contr_no: "10", station: "1", folder: "059", tool_name: "Oil Pan drain bolt", line: "MK1", defaultThreshold: 28, targetTorque: 28.0, torqueMin: 24.0, torqueMax: 32.0 },
  { contr_no: "11", station: "46", folder: "020", tool_name: "Vacuum pump bolt", line: "MK2", defaultThreshold: 20, targetTorque: 15.0, torqueMin: 13.0, torqueMax: 17.0 },
  { contr_no: "12", station: "Cam housing sub assy", folder: "008", tool_name: "EX-VVT", line: "CHS", defaultThreshold: 25, targetTorque: 40.0, torqueMin: 36.0, torqueMax: 44.0 },
  { contr_no: "15", station: "31", folder: "021", tool_name: "Ex/In VVT solenoid bolt", line: "MK1", defaultThreshold: 18, targetTorque: 9.5, torqueMin: 8.0, torqueMax: 11.0 },
  { contr_no: "16", station: "23", folder: "022", tool_name: "Chain Tensioner nut", line: "MK1", defaultThreshold: 22, targetTorque: 21.0, torqueMin: 18.0, torqueMax: 24.0 },
  { contr_no: "17", station: "23", folder: "023", tool_name: "Chain Tensioner bolt", line: "MK1", defaultThreshold: 22, targetTorque: 21.0, torqueMin: 18.0, torqueMax: 24.0 },
  { contr_no: "18", station: "21", folder: "024", tool_name: "Chain support (slipper)bolt", line: "MK1", defaultThreshold: 20, targetTorque: 16.0, torqueMin: 14.0, torqueMax: 18.0 },
  { contr_no: "19", station: "21", folder: "025", tool_name: "Chain damper bolt", line: "MK1", defaultThreshold: 20, targetTorque: 16.0, torqueMin: 14.0, torqueMax: 18.0 },
  { contr_no: "20", station: "23", folder: "026", tool_name: "Oil Pump Sprocket bolt", line: "MK1", defaultThreshold: 26, targetTorque: 27.0, torqueMin: 24.0, torqueMax: 30.0 },
  { contr_no: "21", station: "1", folder: "027", tool_name: "Oil filter union", line: "MK1", defaultThreshold: 25, targetTorque: 30.0, torqueMin: 26.0, torqueMax: 34.0 },
  { contr_no: "23", station: "Block sub assy", folder: "018", tool_name: "Hydraulic oil sensor bolt", line: "BS", defaultThreshold: 18, targetTorque: 15.0, torqueMin: 13.0, torqueMax: 17.0 },
  { contr_no: "24", station: "46", folder: "029", tool_name: "Oil level gauge guide", line: "MK2", defaultThreshold: 18, targetTorque: 10.0, torqueMin: 8.5, torqueMax: 11.5 },
  { contr_no: "25", station: "46", folder: "019", tool_name: "PCV case bolt", line: "MK2", defaultThreshold: 20, targetTorque: 11.0, torqueMin: 9.5, torqueMax: 12.5 },
  { contr_no: "26", station: "Head sub assy", folder: "012", tool_name: "D4 delivery pipe bolt", line: "HS", defaultThreshold: 25, targetTorque: 24.0, torqueMin: 21.0, torqueMax: 27.0 },
  { contr_no: "27", station: "57", folder: "030", tool_name: "Fuel pressurs sensor holder bolt", line: "MK3", defaultThreshold: 20, targetTorque: 12.0, torqueMin: 10.0, torqueMax: 14.0 },
  { contr_no: "28", station: "52", folder: "031", tool_name: "D4 pump bolt", line: "MK3", defaultThreshold: 25, targetTorque: 24.0, torqueMin: 21.0, torqueMax: 27.0 },
  { contr_no: "29", station: "55", folder: "032", tool_name: "Fuel pipe stay bolt", line: "MK3", defaultThreshold: 22, targetTorque: 16.0, torqueMin: 14.0, torqueMax: 18.0 },
  { contr_no: "30", station: "Head sub assy", folder: "011", tool_name: "Low pressure fuel delivery pipe", line: "HS", defaultThreshold: 25, targetTorque: 21.0, torqueMin: 18.0, torqueMax: 24.0 },
  { contr_no: "31", station: "Head sub assy", folder: "010", tool_name: "Fuel press. sensor holder (Port)", line: "HS", defaultThreshold: 20, targetTorque: 15.0, torqueMin: 13.0, torqueMax: 17.0 },
  { contr_no: "32", station: "52", folder: "033", tool_name: "Wire harness bkt nut", line: "MK3", defaultThreshold: 18, targetTorque: 10.0, torqueMin: 8.5, torqueMax: 11.5 },
  { contr_no: "33", station: "52", folder: "034", tool_name: "Wire harness bkt bolt Base", line: "MK3", defaultThreshold: 18, targetTorque: 10.0, torqueMin: 8.5, torqueMax: 11.5 },
  { contr_no: "34", station: "22", folder: "035", tool_name: "Wire harness bkt bolt thermostat", line: "MK1", defaultThreshold: 18, targetTorque: 10.0, torqueMin: 8.5, torqueMax: 11.5 },
  { contr_no: "35", station: "53", folder: "036", tool_name: "Ingnition coil bolt", line: "MK3", defaultThreshold: 22, targetTorque: 11.0, torqueMin: 9.5, torqueMax: 12.5 },
  { contr_no: "36", station: "43", folder: "014", tool_name: "Water inlet pipe bolt", line: "SPS", defaultThreshold: 20, targetTorque: 15.0, torqueMin: 13.0, torqueMax: 17.0 },
  { contr_no: "37", station: "43", folder: "037", tool_name: "Water inlet housing", line: "MK3", defaultThreshold: 24, targetTorque: 19.0, torqueMin: 16.5, torqueMax: 21.5 },
  { contr_no: "38", station: "28", folder: "038", tool_name: "Water outlet bolt", line: "MK1", defaultThreshold: 24, targetTorque: 18.0, torqueMin: 15.5, torqueMax: 20.5 },
  { contr_no: "39", station: "17", folder: "039", tool_name: "Water bypass outlet", line: "MK1", defaultThreshold: 22, targetTorque: 15.0, torqueMin: 13.0, torqueMax: 17.0 },
  { contr_no: "41", station: "56", folder: "041", tool_name: "Water bypass hose no.1 bolt", line: "MK3", defaultThreshold: 18, targetTorque: 9.5, torqueMin: 8.0, torqueMax: 11.0 },
  { contr_no: "42", station: "59", folder: "042", tool_name: "Water bypass pipe no.2 bolt", line: "MK3", defaultThreshold: 20, targetTorque: 12.0, torqueMin: 10.0, torqueMax: 14.0 },
  { contr_no: "43", station: "62", folder: "043", tool_name: "Water bypass plug", line: "MK3", defaultThreshold: 25, targetTorque: 25.0, torqueMin: 22.0, torqueMax: 28.0 },
  { contr_no: "44", station: "62", folder: "044", tool_name: "Heat insulation bolt", line: "MK3", defaultThreshold: 20, targetTorque: 12.0, torqueMin: 10.0, torqueMax: 14.0 },
  { contr_no: "45", station: "58", folder: "045", tool_name: "Intake manifold bolt & nut", line: "MK3", defaultThreshold: 26, targetTorque: 25.0, torqueMin: 22.0, torqueMax: 28.0 },
  { contr_no: "46", station: "58", folder: "046", tool_name: "Delivery guard bolt", line: "MK3", defaultThreshold: 20, targetTorque: 13.0, torqueMin: 11.0, torqueMax: 15.0 },
  { contr_no: "47", station: "61", folder: "047", tool_name: "Intake manifold stay bolt M8", line: "MK3", defaultThreshold: 24, targetTorque: 24.0, torqueMin: 21.0, torqueMax: 27.0 },
  { contr_no: "48", station: "61", folder: "048", tool_name: "Intake manifold stay bolt M6", line: "MK3", defaultThreshold: 18, targetTorque: 11.0, torqueMin: 9.5, torqueMax: 12.5 },
  { contr_no: "49", station: "45", folder: "049", tool_name: "Throttle body bolt", line: "MK2", defaultThreshold: 22, targetTorque: 14.0, torqueMin: 12.0, torqueMax: 16.0 },
  { contr_no: "50", station: "61", folder: "020", tool_name: "EGR pipe bolt", line: "MK3", defaultThreshold: 24, targetTorque: 21.0, torqueMin: 18.0, torqueMax: 24.0 },
  { contr_no: "51", station: "60", folder: "051", tool_name: "EGR valve bolt", line: "MK3", defaultThreshold: 24, targetTorque: 21.0, torqueMin: 18.0, torqueMax: 24.0 },
  { contr_no: "52", station: "59", folder: "052", tool_name: "EGR adaptor bolt", line: "MK3", defaultThreshold: 20, targetTorque: 13.0, torqueMin: 11.0, torqueMax: 15.0 },
  { contr_no: "53", station: "59", folder: "053", tool_name: "EGR Cooler bolt", line: "MK3", defaultThreshold: 25, targetTorque: 24.0, torqueMin: 21.0, torqueMax: 27.0 },
  { contr_no: "54", station: "59", folder: "013", tool_name: "EGR cooler (SPS)", line: "SPS", defaultThreshold: 25, targetTorque: 24.0, torqueMin: 21.0, torqueMax: 27.0 },
  { contr_no: "56", station: "26", folder: "054", tool_name: "V-Rib Belt Tensioner", line: "MK1", defaultThreshold: 28, targetTorque: 35.0, torqueMin: 31.0, torqueMax: 39.0 },
  { contr_no: "57", station: "58", folder: "055", tool_name: "Engine hanger No.1 bolt", line: "MK3", defaultThreshold: 25, targetTorque: 28.0, torqueMin: 25.0, torqueMax: 31.0 },
  { contr_no: "58", station: "61", folder: "058", tool_name: "Engine hanger No.2 bolt", line: "MK3", defaultThreshold: 25, targetTorque: 28.0, torqueMin: 25.0, torqueMax: 31.0 },
  { contr_no: "59", station: "7", folder: "057", tool_name: "HV damper bolt", line: "MK1", defaultThreshold: 26, targetTorque: 32.0, torqueMin: 28.0, torqueMax: 36.0 },
  { contr_no: "60", station: "51", folder: "058", tool_name: "NE sensor", line: "ET", defaultThreshold: 18, targetTorque: 10.0, torqueMin: 8.5, torqueMax: 11.5 },
  { contr_no: "62", station: "62", folder: "063", tool_name: "Wire hrns bkt (EGR cooler)", line: "MK3", defaultThreshold: 18, targetTorque: 10.0, torqueMin: 8.5, torqueMax: 11.5 },
  { contr_no: "64", station: "22", folder: "062", tool_name: "Wire hrns bkt (Crank Case)", line: "MK1", defaultThreshold: 18, targetTorque: 10.0, torqueMin: 8.5, torqueMax: 11.5 },
  { contr_no: "65", station: "Cam housing sub assy", folder: "009", tool_name: "Wireharness Bkt (CHS)", line: "CHS", defaultThreshold: 18, targetTorque: 10.0, torqueMin: 8.5, torqueMax: 11.5 },
  { contr_no: "69", station: "26", folder: "060", tool_name: "Front oil seal press fit height", line: "MK1", defaultThreshold: 20, targetTorque: 18.0, torqueMin: 15.0, torqueMax: 21.0 },
  { contr_no: "70", station: "61", folder: "061", tool_name: "Intake manifold bracket bolt", line: "MK3", defaultThreshold: 22, targetTorque: 17.0, torqueMin: 15.0, torqueMax: 19.0 },
  { contr_no: "71", station: "51", folder: "064", tool_name: "Knock Control Sensor (1.5L)", line: "MK3", defaultThreshold: 18, targetTorque: 20.0, torqueMin: 17.0, torqueMax: 23.0 },
  { contr_no: "72", station: "7", folder: "072", tool_name: "Wire Hrns BKT HV", line: "MK1", defaultThreshold: 18, targetTorque: 10.0, torqueMin: 8.5, torqueMax: 11.5 }
];

const RAW_YOKOTA_TOOLS = [
  { contr_no: "12", station: "20", folder: "0257", tool_name: "EX-VVT - (YOKOTA)", line: "CHS", defaultThreshold: 24, targetTorque: 40.0, torqueMin: 36.0, torqueMax: 44.0 },
  { contr_no: "12", station: "Cam housing sub assy", folder: "0257", tool_name: "EX-VVT - (YOKOTA)", line: "CHS", defaultThreshold: 24, targetTorque: 40.0, torqueMin: 36.0, torqueMax: 44.0 },
  { contr_no: "35", station: "53", folder: "0103", tool_name: "IGNITION COIL BOLT - (YOKOTA)", line: "MK3", defaultThreshold: 20, targetTorque: 11.0, torqueMin: 9.5, torqueMax: 12.5 },
  { contr_no: "37", station: "21", folder: "0230", tool_name: "WATER INLET HOUSING - (YOKOTA)", line: "MK3", defaultThreshold: 22, targetTorque: 19.0, torqueMin: 16.5, torqueMax: 21.5 },
  { contr_no: "37", station: "43", folder: "0230", tool_name: "WATER INLET HOUSING - (YOKOTA)", line: "SPS", defaultThreshold: 22, targetTorque: 19.0, torqueMin: 16.5, torqueMax: 21.5 },
  { contr_no: "39", station: "17", folder: "0039", tool_name: "WATER BYPASS OUTLET BOLT (YOKOTA)", line: "MK1", defaultThreshold: 22, targetTorque: 15.0, torqueMin: 13.0, torqueMax: 17.0 },
  { contr_no: "45", station: "58", folder: "0250", tool_name: "I/M BOLT & NUT - (YOKOTA)", line: "MK3", defaultThreshold: 25, targetTorque: 25.0, torqueMin: 22.0, torqueMax: 28.0 },
  { contr_no: "49", station: "45", folder: "0104", tool_name: "THROTTOLE BODY BOLT - (YOKOTA)", line: "MK2", defaultThreshold: 20, targetTorque: 14.0, torqueMin: 12.0, torqueMax: 16.0 },
  { contr_no: "50", station: "61", folder: "0255", tool_name: "EGR PIPE BOLT - (YOKOTA)", line: "MK3", defaultThreshold: 25, targetTorque: 21.0, torqueMin: 18.0, torqueMax: 24.0 },
  { contr_no: "51", station: "60", folder: "0240", tool_name: "EGR VALVE BOLT (CHS) - (YOKOTA)", line: "MK3", defaultThreshold: 24, targetTorque: 21.0, torqueMin: 18.0, torqueMax: 24.0 },
  { contr_no: "53", station: "59", folder: "0053", tool_name: "EGR COOLER BOLT & NUT- (YOKOTA)", line: "MK3", defaultThreshold: 25, targetTorque: 24.0, torqueMin: 21.0, torqueMax: 27.0 },
  { contr_no: "70", station: "61", folder: "0102", tool_name: "I/M BKT BOLT (IN MANI) (YOKOTA)", line: "MK3", defaultThreshold: 22, targetTorque: 17.0, torqueMin: 15.0, torqueMax: 19.0 }
];

/**
 * Resolves Assembly and Sub-Assembly names from line code
 */
function resolveAssembly(line) {
  switch (line) {
    case 'BS':
      return { assembly_id: 'assembly-1', assembly_name: 'Assembly 1', sub_assembly_id: 'block-sub', sub_assembly_name: 'Block Sub-Assembly' };
    case 'HS':
      return { assembly_id: 'assembly-1', assembly_name: 'Assembly 1', sub_assembly_id: 'head-sub', sub_assembly_name: 'Head Sub-Assembly' };
    case 'CHS':
      return { assembly_id: 'assembly-1', assembly_name: 'Assembly 1', sub_assembly_id: 'cam-housing', sub_assembly_name: 'Cam Housing Sub-Assembly' };
    case 'MK1':
      return { assembly_id: 'assembly-2', assembly_name: 'Assembly 2', sub_assembly_id: 'mk1', sub_assembly_name: 'MK1' };
    case 'MK2':
      return { assembly_id: 'assembly-2', assembly_name: 'Assembly 2', sub_assembly_id: 'mk2', sub_assembly_name: 'MK2' };
    case 'MK3':
      return { assembly_id: 'assembly-2', assembly_name: 'Assembly 2', sub_assembly_id: 'mk3', sub_assembly_name: 'MK3' };
    case 'ET':
      return { assembly_id: 'assembly-3', assembly_name: 'Assembly 3', sub_assembly_id: 'et', sub_assembly_name: 'ET — Engine Testing' };
    case 'SPS':
      return { assembly_id: 'assembly-3', assembly_name: 'Assembly 3', sub_assembly_id: 'sps', sub_assembly_name: 'SPS — Sub-Part Supply' };
    default:
      return { assembly_id: 'assembly-2', assembly_name: 'Assembly 2', sub_assembly_id: 'mk1', sub_assembly_name: 'MK1' };
  }
}

// Build enriched Master Asset Register (73 Tools)
let serialCounter = 101;
const ALL_WRENCH_ASSETS = [
  ...RAW_URYU_TOOLS.map(t => {
    const assy = resolveAssembly(t.line);
    const stationClean = String(t.station).replace(/\s+/g, '_');
    const wrenchId = `URYU_ST${stationClean}_F${t.folder}`;
    serialCounter++;
    return {
      wrench_id: wrenchId,
      brand: 'URYU',
      contr_no: t.contr_no,
      station: t.station,
      folder: t.folder,
      tool_name: t.tool_name,
      line_code: t.line,
      assembly_id: assy.assembly_id,
      assembly_name: assy.assembly_name,
      sub_assembly_id: assy.sub_assembly_id,
      sub_assembly_name: assy.sub_assembly_name,
      default_pulse_threshold: t.defaultThreshold,
      approved_torque_target: t.targetTorque,
      approved_torque_min: t.torqueMin,
      approved_torque_max: t.torqueMax,
      tightening_time_target: 1.45,
      tool_serial: `SN-URYU-${serialCounter}`,
      controller_ip: `10.82.126.${100 + (parseInt(t.contr_no, 10) || 1)}`,
      status: 'ACTIVE',
      accumulated_pulses: 140000 + (serialCounter * 830) % 250000,
      last_calibration_date: '2026-08-15',
      created_at: new Date('2026-01-01')
    };
  }),
  ...RAW_YOKOTA_TOOLS.map(t => {
    const assy = resolveAssembly(t.line);
    const stationClean = String(t.station).replace(/\s+/g, '_');
    const wrenchId = `YOKOTA_ST${stationClean}_F${t.folder}`;
    serialCounter++;
    return {
      wrench_id: wrenchId,
      brand: 'YOKOTA',
      contr_no: t.contr_no,
      station: t.station,
      folder: t.folder,
      tool_name: t.tool_name,
      line_code: t.line,
      assembly_id: assy.assembly_id,
      assembly_name: assy.assembly_name,
      sub_assembly_id: assy.sub_assembly_id,
      sub_assembly_name: assy.sub_assembly_name,
      default_pulse_threshold: t.defaultThreshold,
      approved_torque_target: t.targetTorque,
      approved_torque_min: t.torqueMin,
      approved_torque_max: t.torqueMax,
      tightening_time_target: 1.60,
      tool_serial: `SN-YOKOTA-${serialCounter}`,
      controller_ip: `10.82.127.${50 + (parseInt(t.contr_no, 10) || 1)}`,
      status: 'ACTIVE',
      accumulated_pulses: 180000 + (serialCounter * 720) % 300000,
      last_calibration_date: '2026-08-20',
      created_at: new Date('2026-01-01')
    };
  })
];

const ASSEMBLIES_METADATA = [
  {
    id: 'assembly-1',
    name: 'Assembly 1',
    description: 'Sub-assembly line for Engine Block, Cylinder Head, and Cam Housing components.',
    sub_assemblies: [
      { id: 'block-sub', name: 'Block Sub-Assembly', code: 'BS', tool_count: 5 },
      { id: 'head-sub', name: 'Head Sub-Assembly', code: 'HS', tool_count: 3 },
      { id: 'cam-housing', name: 'Cam Housing Sub-Assembly', code: 'CHS', tool_count: 7 }
    ]
  },
  {
    id: 'assembly-2',
    name: 'Assembly 2',
    description: 'Main engine assembly line comprising MK1, MK2, and MK3 tightening stages.',
    sub_assemblies: [
      { id: 'mk1', name: 'MK1', code: 'MK1', tool_count: 16 },
      { id: 'mk2', name: 'MK2', code: 'MK2', tool_count: 5 },
      { id: 'mk3', name: 'MK3', code: 'MK3', tool_count: 33 }
    ]
  },
  {
    id: 'assembly-3',
    name: 'Assembly 3',
    description: 'Engine testing (ET) and sub-part supply (SPS) ancillary stations.',
    sub_assemblies: [
      { id: 'et', name: 'ET — Engine Testing', code: 'ET', tool_count: 1 },
      { id: 'sps', name: 'SPS — Sub-Part Supply', code: 'SPS', tool_count: 3 }
    ]
  }
];

module.exports = {
  ALL_WRENCH_ASSETS,
  ASSEMBLIES_METADATA,
  resolveAssembly
};
