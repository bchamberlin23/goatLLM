use serde::{Deserialize, Serialize};

use super::db::DbState;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScheduledAgentPayload {
    id: String,
    name: String,
    prompt: String,
    schedule: String,
    enabled: bool,
    next_run_at: i64,
    last_run_at: Option<i64>,
    last_result: Option<String>,
    last_status: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScheduledAgentRunPayload {
    id: String,
    agent_id: String,
    agent_name: String,
    prompt: String,
    status: String,
    created_at: i64,
    started_at: Option<i64>,
    completed_at: Option<i64>,
    result: Option<String>,
    error: Option<String>,
    trace: Vec<String>,
    output_artifact_ids: Option<Vec<String>>,
    conversation_id: Option<String>,
    read_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScheduledAgentStatePayload {
    agents: Vec<ScheduledAgentPayload>,
    runs: Vec<ScheduledAgentRunPayload>,
}

#[tauri::command]
pub(crate) fn scheduled_agents_load(
    state: tauri::State<'_, DbState>,
) -> Result<ScheduledAgentStatePayload, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;

    let mut agent_stmt = db
        .prepare(
            "SELECT id, name, prompt, schedule, enabled, next_run_at, last_run_at, last_result, last_status \
             FROM scheduled_agents ORDER BY updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let agents = agent_stmt
        .query_map([], |row| {
            Ok(ScheduledAgentPayload {
                id: row.get(0)?,
                name: row.get(1)?,
                prompt: row.get(2)?,
                schedule: row.get(3)?,
                enabled: row.get::<_, i64>(4)? != 0,
                next_run_at: row.get(5)?,
                last_run_at: row.get(6)?,
                last_result: row.get(7)?,
                last_status: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|row| row.ok())
        .collect();

    let mut run_stmt = db
        .prepare(
            "SELECT id, agent_id, agent_name, prompt, status, created_at, started_at, completed_at, result, error, trace, output_artifact_ids, conversation_id, read_at \
             FROM scheduled_agent_runs ORDER BY created_at DESC LIMIT 200",
        )
        .map_err(|e| e.to_string())?;
    let runs = run_stmt
        .query_map([], |row| {
            let trace_raw: String = row.get(10)?;
            let artifact_raw: String = row.get(11)?;
            Ok(ScheduledAgentRunPayload {
                id: row.get(0)?,
                agent_id: row.get(1)?,
                agent_name: row.get(2)?,
                prompt: row.get(3)?,
                status: row.get(4)?,
                created_at: row.get(5)?,
                started_at: row.get(6)?,
                completed_at: row.get(7)?,
                result: row.get(8)?,
                error: row.get(9)?,
                trace: serde_json::from_str(&trace_raw).unwrap_or_default(),
                output_artifact_ids: serde_json::from_str(&artifact_raw).unwrap_or_default(),
                conversation_id: row.get(12)?,
                read_at: row.get(13)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|row| row.ok())
        .collect();

    Ok(ScheduledAgentStatePayload { agents, runs })
}

#[tauri::command]
pub(crate) fn scheduled_agents_save(
    payload: ScheduledAgentStatePayload,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let mut db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let tx = db.transaction().map_err(|e| e.to_string())?;

    for agent in &payload.agents {
        tx.execute(
            "INSERT OR REPLACE INTO scheduled_agents \
             (id, name, prompt, schedule, enabled, next_run_at, last_run_at, last_result, last_status, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, COALESCE((SELECT created_at FROM scheduled_agents WHERE id = ?1), ?10), ?10)",
            rusqlite::params![
                agent.id,
                agent.name,
                agent.prompt,
                agent.schedule,
                if agent.enabled { 1 } else { 0 },
                agent.next_run_at,
                agent.last_run_at,
                agent.last_result,
                agent.last_status,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    let agent_ids: Vec<String> = payload.agents.iter().map(|agent| agent.id.clone()).collect();
    if agent_ids.is_empty() {
        tx.execute("DELETE FROM scheduled_agents", []).map_err(|e| e.to_string())?;
    } else {
        let placeholders = agent_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!("DELETE FROM scheduled_agents WHERE id NOT IN ({})", placeholders);
        let params: Vec<&dyn rusqlite::ToSql> = agent_ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
        tx.execute(&sql, params.as_slice()).map_err(|e| e.to_string())?;
    }

    for run in &payload.runs {
        let trace = serde_json::to_string(&run.trace).map_err(|e| e.to_string())?;
        let artifacts = serde_json::to_string(&run.output_artifact_ids.clone().unwrap_or_default())
            .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT OR REPLACE INTO scheduled_agent_runs \
             (id, agent_id, agent_name, prompt, status, created_at, started_at, completed_at, result, error, trace, output_artifact_ids, conversation_id, read_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            rusqlite::params![
                run.id,
                run.agent_id,
                run.agent_name,
                run.prompt,
                run.status,
                run.created_at,
                run.started_at,
                run.completed_at,
                run.result,
                run.error,
                trace,
                artifacts,
                run.conversation_id,
                run.read_at,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}
