# Azure Data Factory (ADF) Pipeline: TNGA Torque & Pulse Telemetry to SQL

## 1. Architecture Overview
This ADF pipeline extracts torque and pulse count telemetry from the Toyota shop-floor local line PC (`10.82.126.73:8121`) into the on-premises PostgreSQL database (`10.82.126.27:5432/enginetracking`), completely eliminating continuous 1-second polling loads from the live production line.

```
┌──────────────────────────────────────┐
│  Shop-Floor Local PC (10.82.126.73)  │
│  Port 8121: /api/torque-data         │
└──────────────────┬───────────────────┘
                   │  Outbound TLS 443 via
                   │  Self-Hosted Integration Runtime (SHIR)
┌──────────────────▼───────────────────┐
│     Azure Data Factory (ADF)         │
│  Pipeline: PL_Sync_Torque_To_SQL    │
│  Trigger: 10:00, 13:00, 15:00, 16:40 │
└──────────────────┬───────────────────┘
                   │  Bulk Copy & Upsert
┌──────────────────▼───────────────────┐
│  PostgreSQL DB (10.82.126.27:5432)   │
│  - wrench_tightening_cycles          │
│  - shift_sync_logs                   │
└──────────────────┬───────────────────┘
                   │  Instant Read Queries (0ms line impact)
┌──────────────────▼───────────────────┐
│  TNGA Monitoring Dashboard           │
│  & Admin Control Portal              │
└──────────────────────────────────────┘
```

---

## 2. Directory Structure & ADF Artifacts

```
adf_pipeline/
├── linkedServices/
│   ├── LS_REST_ShopFloor_TorqueAPI.json   # Linked Service to 10.82.126.73:8121
│   └── LS_PostgreSQL_Target.json           # Linked Service to 10.82.126.27:5432/enginetracking
├── datasets/
│   ├── DS_REST_TorqueAPI_Source.json      # Parameterized REST dataset (station & date)
│   └── DS_PostgreSQL_Cycles_Sink.json     # Target PostgreSQL table dataset
├── pipelines/
│   └── PL_Sync_Torque_To_PostgreSQL.json  # Orchestration pipeline with logging & upsert
└── triggers/
    └── TR_Shift_Break_Windows.json        # 4 scheduled shift break triggers
```

---

## 3. Deployment Steps in Azure Data Factory Studio

### Step 1: Install Self-Hosted Integration Runtime (SHIR)
1. In Azure Data Factory Studio, navigate to **Manage** > **Integration runtimes** > **+ New**.
2. Select **Azure, Self-Hosted** > **Self-Hosted**.
3. Name it: `SHIR_Toyota_TIEI_Plant`.
4. Download the SHIR installer onto an on-premises VM or gateway machine on the plant subnet (`10.82.126.x`).
5. Complete installation and paste the authentication key. Verify state shows **Running**.

### Step 2: Initialize Database Tables
On your PostgreSQL server (`10.82.126.27`), run the provided DDL script:
```bash
psql -h 10.82.126.27 -U tracedb -d enginetracking -f "../backend/src/config/initPostgres.sql"
```

### Step 3: Import Linked Services & Datasets
1. In ADF Studio, open the **Author** tab.
2. In the top bar, click **Actions** > **Import template** (or paste the JSON files from `linkedServices/` and `datasets/`).
3. Test connection for `LS_REST_ShopFloor_TorqueAPI` and `LS_PostgreSQL_Target`.

### Step 4: Import Pipeline & Schedule Triggers
1. Import `pipelines/PL_Sync_Torque_To_PostgreSQL.json`.
2. Import `triggers/TR_Shift_Break_Windows.json`.
3. Activate the trigger.

---

## 4. Shift Schedule & Protection Windows
The trigger fires exclusively during conveyor pause / shift break windows:
- **Break 1**: 10:00 - 10:10
- **Lunch**: 13:00 - 13:30
- **Break 2**: 15:00 - 15:10
- **Shift End**: 16:40 - 16:45

During regular production (e.g. 07:45 - 10:00), zero HTTP requests hit the shop-floor local PC, guaranteeing 100% production uptime and CPU stability.
