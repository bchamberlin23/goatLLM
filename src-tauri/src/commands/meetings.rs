use serde::{Deserialize, Serialize};

use super::db::DbState;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingSessionPayload {
    id: String,
    title: String,
    source: String,
    status: String,
    created_at: i64,
    updated_at: i64,
    started_at: Option<i64>,
    ended_at: Option<i64>,
    duration_ms: Option<i64>,
    audio_filename: Option<String>,
    transcript: Option<String>,
    summary: Option<String>,
    action_items: Vec<String>,
    decisions: Vec<String>,
    participants: Vec<String>,
    model_id: Option<String>,
    conversation_id: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingSettingsPayload {
    auto_summarize: bool,
    summary_style: String,
    speaker_labels: bool,
    store_transcripts: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingStatePayload {
    sessions: Vec<MeetingSessionPayload>,
    settings: MeetingSettingsPayload,
}

fn array_from_json(raw: String) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(&raw).unwrap_or_default()
}

fn default_settings() -> MeetingSettingsPayload {
    MeetingSettingsPayload {
        auto_summarize: true,
        summary_style: "concise".to_string(),
        speaker_labels: true,
        store_transcripts: true,
    }
}

#[tauri::command]
pub(crate) fn meetings_load(state: tauri::State<'_, DbState>) -> Result<MeetingStatePayload, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;

    let mut stmt = db
        .prepare(
            "SELECT id, title, source, status, created_at, updated_at, started_at, ended_at, duration_ms, audio_filename, transcript, summary, action_items, decisions, participants, model_id, conversation_id, error \
             FROM meeting_sessions ORDER BY updated_at DESC LIMIT 100",
        )
        .map_err(|e| e.to_string())?;
    let sessions = stmt
        .query_map([], |row| {
            let action_raw: String = row.get(12)?;
            let decision_raw: String = row.get(13)?;
            let participant_raw: String = row.get(14)?;
            Ok(MeetingSessionPayload {
                id: row.get(0)?,
                title: row.get(1)?,
                source: row.get(2)?,
                status: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                started_at: row.get(6)?,
                ended_at: row.get(7)?,
                duration_ms: row.get(8)?,
                audio_filename: row.get(9)?,
                transcript: row.get(10)?,
                summary: row.get(11)?,
                action_items: array_from_json(action_raw),
                decisions: array_from_json(decision_raw),
                participants: array_from_json(participant_raw),
                model_id: row.get(15)?,
                conversation_id: row.get(16)?,
                error: row.get(17)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|row| row.ok())
        .collect();

    let raw: Result<String, _> = db.query_row(
        "SELECT value FROM meeting_settings WHERE key = 'meeting-settings'",
        [],
        |row| row.get(0),
    );
    let settings = match raw {
        Ok(value) => serde_json::from_str::<MeetingSettingsPayload>(&value).unwrap_or_else(|_| default_settings()),
        Err(rusqlite::Error::QueryReturnedNoRows) => default_settings(),
        Err(e) => return Err(e.to_string()),
    };

    Ok(MeetingStatePayload { sessions, settings })
}

#[tauri::command]
pub(crate) fn meetings_save(
    payload: MeetingStatePayload,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let mut db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let tx = db.transaction().map_err(|e| e.to_string())?;

    for session in &payload.sessions {
        let action_items = serde_json::to_string(&session.action_items).map_err(|e| e.to_string())?;
        let decisions = serde_json::to_string(&session.decisions).map_err(|e| e.to_string())?;
        let participants = serde_json::to_string(&session.participants).map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT OR REPLACE INTO meeting_sessions \
             (id, title, source, status, created_at, updated_at, started_at, ended_at, duration_ms, audio_filename, transcript, summary, action_items, decisions, participants, model_id, conversation_id, error) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
            rusqlite::params![
                session.id,
                session.title,
                session.source,
                session.status,
                session.created_at,
                session.updated_at,
                session.started_at,
                session.ended_at,
                session.duration_ms,
                session.audio_filename,
                session.transcript,
                session.summary,
                action_items,
                decisions,
                participants,
                session.model_id,
                session.conversation_id,
                session.error,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    let ids: Vec<String> = payload.sessions.iter().map(|session| session.id.clone()).collect();
    if ids.is_empty() {
        tx.execute("DELETE FROM meeting_sessions", []).map_err(|e| e.to_string())?;
    } else {
        let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!("DELETE FROM meeting_sessions WHERE id NOT IN ({})", placeholders);
        let params: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
        tx.execute(&sql, params.as_slice()).map_err(|e| e.to_string())?;
    }

    let settings = serde_json::to_string(&payload.settings).map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT OR REPLACE INTO meeting_settings (key, value, updated_at) VALUES ('meeting-settings', ?1, ?2)",
        rusqlite::params![settings, now],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}
