# Pulse Monitoring Dashboard (TNGA Impact Wrench Monitoring System)

An industrial condition-monitoring and predictive maintenance dashboard for automotive engine assembly impulse wrenches (URYU UEC-4800 and Yokota controllers).

---

## 📌 System Overview

The system monitors 73 tightening tools across **Assembly 1, Assembly 2, and Assembly 3** lines in the TNGA engine plant:
- **Assembly 1 (14 Tools)**: Block Sub-Assembly, Head Sub-Assembly, and Cam Housing Sub-Assembly.
- **Assembly 2 (55 Tools)**: Main Engine Assembly Lines (MK1, MK2, and MK3).
- **Assembly 3 (4 Tools)**: Engine Testing (ET) and Sub-Part Supply (SPS).

---

## 🚀 Key Modules & Pages (9-Page Architecture)

1. **Home (Management Overview)**
   - Plant KPI cards (Total registered wrenches, OK/NG cycle counts, and active alerts).
   - OK vs. NG Donut chart with percentages.
   - Assembly line cards with one-click drilldowns.
   - Real-time data freshness indicator.

2. **Assembly 1 / 2 / 3 Drilldown**
   - Sub-assembly filter buttons.
   - Tool asset table with station, folder, target torque, pulse limit, and accumulated cycle counts.

3. **Wrench Analysis**
   - Individual tool search by unique Wrench ID (e.g. `URYU_ST28_F016`).
   - Per-cycle raw pulse scatter graph with reference limit line.
   - Daily average summary table showing number of operations per day.
   - Recent operation records table with engine barcodes, torque, angle, and duration.

4. **Trends (Main Trends Graph)**
   - **Avg pulse count per day vs. days**: Progressive upward degradation curve.
   - **Increasing trend alert** marker (Day 4).
   - **Tool changed milestone** (Day 5) with post-replacement recovery down to baseline.
   - Multi-wrench overlay comparison mode.

5. **Alerts Tracker**
   - Persistent alert lifecycle: `OPEN` → `ACKNOWLEDGED` → `INVESTIGATING` → `CLOSED`.
   - Investigation notes and corrective action tracking.

6. **Tool Change Log**
   - Manual tool replacement entry form.
   - Distinguishes planned threshold replacements from unplanned faults.
   - Resets tool cycle counter while preserving immutable history.

7. **Wrench Map (Asset Register)**
   - Master list of all 73 tools, controller IPs, calibration dates, and serial numbers.

8. **Raw Data Explorer**
   - Filterable, paginated raw operation table preserving vendor source fields.
   - One-click CSV export.

---

## 🛠️ Tech Stack

- **Frontend**: React 18, Vite, Recharts, Lucide Icons
- **Backend**: Node.js, Express, Axios, Nodemailer, Mongoose
- **Database**: MongoDB with automatic in-memory fallback

---

## 🏃 Getting Started

### 1. Prerequisites
- Node.js (v18+)
- npm or pnpm

### 2. Installation & Run

#### Backend (Port 8140)
```bash
cd backend
npm install
npm start
```

#### Frontend (Port 3010)
```bash
cd frontend
npm install
npm run dev
```

#### Or One-Click Launch (Windows)
Double-click `start_tnga_dashboard.bat` to launch both backend and frontend servers simultaneously.

---

## 📡 Endpoints
- **Frontend**: `http://localhost:3010`
- **Backend API**: `http://localhost:8140`
- **Health Check**: `http://localhost:8140/health`
- **Overview API**: `http://localhost:8140/api/dashboard/overview`
- **Daily Trends API**: `http://localhost:8140/api/trends/daily?wrench_id=URYU_ST28_F016&days=8`
