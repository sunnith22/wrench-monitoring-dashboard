-- =============================================================================
-- TOYOTA INDUSTRIES ENGINE INDIA (TIEI)
-- TNGA Impact Wrench Telemetry Database Initialization
-- Dedicated Database: tnga_wrench_db
-- Host: 10.82.126.44:5432
-- User: tracedb
-- =============================================================================

-- Step 1: Create the dedicated database (Execute connected to postgres/template1)
CREATE DATABASE tnga_wrench_db;

-- Step 2: Grant permissions to tracedb
GRANT ALL PRIVILEGES ON DATABASE tnga_wrench_db TO tracedb;

-- Step 3: Connect to the new database
\c tnga_wrench_db;

-- Grant schema permissions
GRANT ALL ON SCHEMA public TO tracedb;

-- -----------------------------------------------------------------------------
-- Step 4: Create wrench_tightening_cycles table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wrench_tightening_cycles (
    id BIGSERIAL PRIMARY KEY,
    wrench_id VARCHAR(50) NOT NULL,
    tool_name VARCHAR(150),
    station VARCHAR(50) NOT NULL,
    line VARCHAR(50),
    engine_no VARCHAR(50),
    tightening_time TIMESTAMP WITH TIME ZONE NOT NULL,
    reception_time TIMESTAMP WITH TIME ZONE,
    torque_val NUMERIC(8,2),
    torque_status VARCHAR(20) DEFAULT 'OK',
    angle_val NUMERIC(8,2),
    angle_status VARCHAR(20) DEFAULT 'OK',
    pulse_count INTEGER NOT NULL,
    pulse_status VARCHAR(20) DEFAULT 'NORMAL',
    cycle_counter BIGINT DEFAULT 1,
    folder VARCHAR(20),
    controller_no VARCHAR(20),
    raw_payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Idempotency constraint: prevents duplicates and enables safe clubbing
    CONSTRAINT uq_wrench_cycle UNIQUE (wrench_id, tightening_time, cycle_counter)
);

-- Ultra-fast indexes for Dashboard graph queries
CREATE INDEX IF NOT EXISTS idx_cycles_wrench_time ON wrench_tightening_cycles(wrench_id, tightening_time DESC);
CREATE INDEX IF NOT EXISTS idx_cycles_station ON wrench_tightening_cycles(station);
CREATE INDEX IF NOT EXISTS idx_cycles_tightening_time ON wrench_tightening_cycles(tightening_time DESC);
CREATE INDEX IF NOT EXISTS idx_cycles_pulse_count ON wrench_tightening_cycles(pulse_count DESC);
CREATE INDEX IF NOT EXISTS idx_cycles_engine_no ON wrench_tightening_cycles(engine_no);

-- -----------------------------------------------------------------------------
-- Step 5: Create shift_sync_logs table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shift_sync_logs (
    id SERIAL PRIMARY KEY,
    sync_id VARCHAR(64) NOT NULL,
    sync_source VARCHAR(50) DEFAULT 'MOUNT_CSV',
    window_name VARCHAR(100),
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE,
    records_pulled INTEGER DEFAULT 0,
    records_inserted INTEGER DEFAULT 0,
    records_duplicated INTEGER DEFAULT 0,
    status VARCHAR(30) DEFAULT 'SUCCESS',
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_start_time ON shift_sync_logs(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_sync_id ON shift_sync_logs(sync_id);
