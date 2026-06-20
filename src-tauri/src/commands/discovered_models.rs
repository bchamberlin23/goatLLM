use std::collections::HashMap;

use serde_json::Value;

use super::db::DbState;

#[tauri::command]
pub(crate) fn discovered_models_load(
    state: tauri::State<'_, DbState>,
) -> Result<HashMap<String, Vec<Value>>, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let mut stmt = db
        .prepare("SELECT provider_id, models_json FROM discovered_models")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let provider_id: String = row.get(0)?;
            let raw: String = row.get(1)?;
            Ok((
                provider_id,
                serde_json::from_str::<Vec<Value>>(&raw).unwrap_or_default(),
            ))
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|row| row.ok()).collect())
}

#[tauri::command]
pub(crate) fn discovered_models_save(
    models: HashMap<String, Vec<Value>>,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    let mut db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let tx = db.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM discovered_models", [])
        .map_err(|e| e.to_string())?;
    for (provider_id, provider_models) in models {
        let models_json = serde_json::to_string(&provider_models).map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO discovered_models (provider_id, models_json, updated_at) VALUES (?1, ?2, ?3)", rusqlite::params![provider_id, models_json, now]).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}
