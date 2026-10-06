// Plant definition shared by the simulation engine (Node) and the 3D viewer (browser).
// All dimensions are metres, all durations are simulated seconds.

export const PLANT = { id:'kestrel-line2', company:'Kestrel Brake Works', line:'Line 2', product:'Vented brake disc, 300 mm' };

export const SHIFT_START = 6 * 3600;   // the simulated shift starts at 06:00
export const IDEAL_CT = 46;            // constraint cycle (lathe)
export const TARGET_RATE = 66;         // planned discs per hour
export const SPACING = 0.72;           // minimum part pitch on a conveyor
export const CONV_V = 0.3;             // conveyor speed, m/s
export const PALLET_QTY = 8;           // finished discs per pallet
export const RAW_PALLET_QTY = 12;      // raw castings per pallet
export const TOTE_RAW = 6, TOTE_WIP = 4;
export const BUFFER_CAP = 12;

// Process tags. `run`/`idle`/`off` are the values a signal settles at in each state (first-order lag `tau`),
// `noise` is measurement noise added when the value is read. `perPart` tags are measured once per cycle.
const T = (k, name, unit, run, idle, off, tau, noise, dec = 1) => ({k, name, unit, run, idle, off, tau, noise, dec});
const PP = (k, name, unit, mean, sd, dec = 1) => ({k, name, unit, mean, sd, dec, perPart:true});
const WEAR = (k, name, drop) => ({k, name, unit:'%', wear:true, drop, dec:1});

export const MACH = [
  {id:'M1', name:'CNC lathe', op:'OP10', desc:'Turns both braking faces and the hat', type:'lathe', x:-8, z:-5, hw:1.5, h:2.0,
   ct:46, kwRun:24, kwIdle:4.5, mtbf:3000, mttr:150, defect:.02, crew:true,
   tags:[T('spindleSpeed','Spindle speed','rpm',1450,0,0,2.5,9,0), T('spindleLoad','Spindle load','%',62,3,0,2,2.2), T('coolantTemp','Coolant temperature','°C',28.5,23.5,21,240,0.15),
         T('vibration','Spindle vibration','mm/s',1.8,0.1,0,2,0.12,2), T('chuckPressure','Chuck pressure','bar',32,32,0,4,0.25), WEAR('toolLife','Insert life remaining',0.9)]},
  {id:'M2', name:'Drilling centre', op:'OP20', desc:'Drills the bolt circle and vent holes', type:'mill', x:-2, z:-5, hw:1.2, h:2.95,
   ct:38, kwRun:16, kwIdle:3, mtbf:3600, mttr:140, defect:.012, crew:false,
   tags:[T('spindleSpeed','Spindle speed','rpm',3200,0,0,1.5,18,0), T('spindleLoad','Spindle load','%',48,2,0,1.5,2.5), T('coolantPressure','Coolant pressure','bar',18,2,0,2,0.3),
         T('coolantTemp','Coolant temperature','°C',27,23,21,260,0.15), WEAR('toolLife','Drill life remaining',0.6)]},
  {id:'M3', name:'Balancer', op:'OP30', desc:'Measures imbalance and mills a correction', type:'bal', x:4, z:-5, hw:1.1, h:2.2,
   ct:30, kwRun:6, kwIdle:1.2, mtbf:6000, mttr:110, defect:0, crew:true,
   tags:[T('spinSpeed','Spin speed','rpm',900,0,0,3,6,0), T('vibration','Bearing vibration','mm/s',0.9,0.05,0,2,0.08,2), PP('imbalance','Residual imbalance','g·cm',34,9,0)]},
  {id:'M4', name:'Washer', op:'OP40', desc:'Spray wash, rinse and hot-air dry', type:'wash', x:4, z:5, hw:1.7, h:1.75,
   ct:24, kwRun:19, kwIdle:7, mtbf:5000, mttr:120, defect:0, crew:false,
   tags:[T('bathTemp','Wash bath temperature','°C',62,60,24,600,0.2), T('sprayPressure','Spray pressure','bar',4.5,0.3,0,2,0.08,2), T('dryerTemp','Dryer air temperature','°C',95,70,24,120,0.6),
         T('conductivity','Rinse conductivity','µS/cm',860,840,820,900,6,0)]},
  {id:'M5', name:'Coating oven', op:'OP50', desc:'Zinc-flake spray coat and cure', type:'oven', x:-2, z:5, hw:1.8, h:2.1,
   ct:40, kwRun:36, kwIdle:15, mtbf:4200, mttr:160, defect:.02, crew:false,
   tags:[T('zone1Temp','Flash-off zone temperature','°C',82,78,24,400,0.5), T('zone2Temp','Cure zone temperature','°C',318,300,24,900,1.2), T('exhaustFlow','Exhaust air flow','m³/h',2400,900,0,6,25,0),
         T('paintPressure','Spray gun pressure','bar',2.8,0,0,1.5,0.05,2), PP('coatThickness','Coating thickness','µm',10.2,0.7,1)]},
  {id:'M6', name:'Inspection cell', op:'OP60', desc:'Checks runout, thickness variation and surface', type:'insp', x:-8, z:5, hw:1.1, h:2.2,
   ct:22, kwRun:3.5, kwIdle:1, mtbf:9000, mttr:90, defect:0, crew:true,
   tags:[PP('runout','Lateral runout','µm',18,5,0), PP('thicknessVar','Disc thickness variation','µm',6.2,1.6,1), T('cameraConfidence','Vision confidence','%',97.5,97.5,0,5,0.6)]},
  {id:'M7', name:'Palletising robot', op:'OP70', desc:'Stacks eight discs per pallet', type:'robot', x:-12.6, z:5, hw:1.2, h:2.3,
   ct:14, kwRun:5, kwIdle:1, mtbf:7000, mttr:100, defect:0, crew:false,
   tags:[T('vacuum','Gripper vacuum','kPa',-72,-4,0,0.8,1.2), T('axisTemp','Axis 2 motor temperature','°C',46,34,24,500,0.2), T('tcpSpeed','Tool speed','mm/s',850,0,0,1,30,0)]},
];

export const REASONS = {
  lathe:['insert wear limit reached','chuck pressure low','chip conveyor jam'],
  mill:['drill breakage','coolant level low','tool changer fault'],
  bal:['spindle vibration alarm','clamp sensor fault'],
  wash:['spray nozzle blocked','bath temperature low'],
  oven:['spray gun clogged','cure zone over temperature'],
  insp:['camera calibration drift','measuring probe fault'],
  robot:['gripper vacuum lost','light curtain tripped'],
};

export const CONV = [
  {id:'C1', from:'M1', to:'M2', x0:-6.5, x1:-3.2,  z:-5},
  {id:'C2', from:'M2', to:'M3', x0:-0.8, x1: 2.9,  z:-5},
  {id:'C3', from:'M3', to:'Buffer A-out', x0: 5.1, x1: 8.0,  z:-5},
  {id:'C4', from:'Buffer B-in', to:'M4', x0: 8.0, x1: 5.7,  z: 5},
  {id:'C5', from:'M4', to:'M5', x0: 2.3, x1:-0.2,  z: 5},
  {id:'C6', from:'M5', to:'M6', x0:-3.8, x1:-6.9,  z: 5},
  {id:'C7', from:'M6', to:'M7', x0:-9.1, x1:-11.5, z: 5},
];
CONV.forEach(c => { c.len = Math.abs(c.x1 - c.x0); });
export const SRC = [null, 0, 1, 3, 4, 5, 6];   // conveyor each station pulls from (M1 is hand loaded)
export const SNK = [0, 1, 2, 4, 5, 6, null];   // conveyor each station pushes to (M7 stacks the pallet)
export const STG = [1, 2, 2, 3, 4, 4, 4];      // part stage after each station
export const STAGE_NAME = ['Raw casting', 'Turned', 'Drilled and balanced', 'Washed', 'Coated'];

export const TBL = {
  ain:{id:'A-in',  name:'Raw casting buffer', x:-14.5, z:-5},
  aout:{id:'A-out', name:'Machined disc buffer', x:9.5, z:-5},
  bin:{id:'B-in',  name:'Finishing infeed buffer', x:9.5, z:5},
};
export const PALLET_POS = {x:-14.9, z:5};

// AGV loop: one-way rectangle, s runs 0..100 m from the back-left corner.
export const RING = {x0:-17.5, x1:12.5, z0:-10, z1:10};
export const RING_L = 100;
export const ST = { AOUT:35, BIN:45, RAWP:81.5, PAL:85, AIN:95, FGD:98.5 };
export const STOP_NAME = { 35:'Machined disc pick-up', 45:'Finishing drop-off', 81.5:'Raw casting pick-up', 85:'Pallet pick-up', 95:'Raw casting drop-off', 98.5:'Finished goods drop-off' };
export function ringPos(s) {
  s = ((s % RING_L) + RING_L) % RING_L;
  if (s < 30) return {x:RING.x0 + s, z:RING.z0, yaw:0};
  if (s < 50) return {x:RING.x1, z:RING.z0 + (s - 30), yaw:-Math.PI / 2};
  if (s < 80) return {x:RING.x1 - (s - 50), z:RING.z1, yaw:Math.PI};
  return {x:RING.x0, z:RING.z1 - (s - 80), yaw:Math.PI / 2};
}
export const fwd = (a, b) => (((b - a) % RING_L) + RING_L) % RING_L;
export const AGV_V = 1.4, AGV_GAP = 3.2, AGV_HANDLING = 8;

export const OP1 = { table:{x:-13.4, z:-3.45}, mach:{x:-8.5, z:-3.3} };
export const TECH_HOME = {x:7, z:1};
export const WALK_V = 1.45;
export const servicePt = i => ({ x:MACH[i].x + 0.95, z:MACH[i].z < 0 ? MACH[i].z + 1.85 : MACH[i].z - 1.85 });

export const PEOPLE = [
  {id:'OP-M1', role:'Machine operator', station:'M1', duty:'Loads castings into the lathe and checks first-off parts'},
  {id:'OP-M3', role:'Machine operator', station:'M3', duty:'Runs the balancer and clears rejected discs'},
  {id:'OP-M6', role:'Quality inspector', station:'M6', duty:'Supervises the inspection cell and audits measurements'},
  {id:'TECH-1', role:'Maintenance technician', station:'Line 2', duty:'Responds to station faults'},
  {id:'FLT-1', role:'Forklift driver', station:'Warehouse', duty:'Unloads trucks, replenishes the line and loads shipments'},
];

/* ---------------- Warehouse ---------------- */
export const WH = {
  rackX:-29.2, faceX:-26.6, aisle1:-24.6, aisle2:-38, bays:6, levels:3, bayPitch:1.6, levelPitch:1.45,
  standX:-20.3, standFaceX:-22.6, rawStandZ:[9.35, 7.65], fgStandZ:[-7.65, -9.35],
  dockX:-42.2, inboundZ:8, outboundZ:-8, wallX:-46, home:{x:-24.6, z:13.4, yaw:Math.PI},
  forkV:2.2, forkTurn:2.6, forkHandling:10,
  truckQty:8, shipQty:8, reorderPoint:7, shipTrigger:8, truckTravel:30,
};
// rack slots: zone raw on the +z side of the cross aisle, finished goods on the -z side
export const SLOTS = [];
for (const zone of ['raw', 'fg']) for (let bay = 0; bay < WH.bays; bay++) for (let level = 0; level < WH.levels; level++) {
  const z = zone === 'raw' ? 3.2 + bay * WH.bayPitch : -3.2 - bay * WH.bayPitch;
  SLOTS.push({id:`${zone === 'raw' ? 'R' : 'F'}-${String(bay + 1).padStart(2, '0')}-${level + 1}`, zone, bay, level, x:WH.rackX, z, y:0.12 + level * WH.levelPitch});
}

export const STATE_CODE = {OFF:0, IDLE:1, RUN:2, BLOCKED:3, DOWN:4};
export const STATE_LABEL = {RUN:'Running', IDLE:'Waiting for parts', BLOCKED:'Blocked', DOWN:'Down', OFF:'Off'};
