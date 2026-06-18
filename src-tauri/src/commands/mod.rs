#![allow(unused_imports)]

pub(crate) mod db;
pub(crate) mod documents;
pub(crate) mod embeddings;
pub(crate) mod extract;
pub(crate) mod files;
pub(crate) mod git;
pub(crate) mod latex;
pub(crate) mod memory;
pub(crate) mod misc;
pub(crate) mod scheduled_agents;
pub(crate) mod search;
pub(crate) mod tools;
pub(crate) mod workspace;

pub(crate) use crate::{escape_sql_like_query, init_db};
pub(crate) use db::{
    delete_conversation_db, delete_message_db, get_events, load_all_data,
    load_messages_for_conversation, log_event, save_conversation, save_message, search_messages,
};
pub(crate) use documents::{
    document_chunks_delete, document_chunks_replace, document_chunks_search, document_workspace_delete,
    document_workspace_save, document_workspaces_load,
};
pub(crate) use embeddings::{
    embeddings_clear, embeddings_count, embeddings_insert, embeddings_search, workspace_chunks,
};
pub(crate) use extract::{
    audio_transcription_available, extract_docx_text, extract_pdf_text, extract_pptx_text,
    extract_xlsx_text, ocr_available, ocr_image, read_pdf, transcribe_audio,
};
pub(crate) use files::{
    copy_dir_abs, create_dir_abs, delete_file, goat_agent_dir, home_dir, list_dir, list_dir_abs,
    os_temp_dir, path_exists_abs, read_file, read_file_bytes, read_text_file_abs, resource_dir,
    write_file, write_skill_file, write_temp_file,
};
pub(crate) use git::{diff_file, git_blame, git_branch, git_commit, git_log, git_push, git_status};
pub(crate) use latex::compile_latex;
pub(crate) use memory::{
    memory_delete, memory_increment_uses, memory_insert, memory_list, memory_search,
    memory_search_text, memory_settings_load, memory_settings_save, memory_update,
};
pub(crate) use misc::{
    run_python, sync_export_state, sync_import_state, unwatch_workspace, watch_workspace,
};
pub(crate) use scheduled_agents::{scheduled_agents_load, scheduled_agents_save};
pub(crate) use search::{normalize_for_fuzzy_match, search_content};
pub(crate) use tools::{edit_file, exec_command, read_lints};
pub(crate) use workspace::{
    add_workspace, get_workspace_denylist, list_workspaces, remove_workspace,
    set_workspace_denylist,
};

macro_rules! generate_handler {
    () => {
        tauri::generate_handler![
            crate::commands::db::load_all_data,
            crate::commands::db::load_messages_for_conversation,
            crate::commands::db::save_conversation,
            crate::commands::db::save_message,
            crate::commands::db::delete_conversation_db,
            crate::commands::db::delete_message_db,
            crate::commands::db::search_messages,
            crate::commands::db::log_event,
            crate::commands::db::get_events,
            crate::commands::files::workspace_files::read_file,
            crate::commands::files::workspace_files::read_file_bytes,
            crate::commands::files::workspace_files::list_dir,
            crate::commands::search::search_content,
            crate::commands::git::git_status,
            crate::commands::git::git_branch,
            crate::commands::git::git_commit,
            crate::commands::git::git_push,
            crate::commands::git::git_log,
            crate::commands::git::git_blame,
            crate::commands::git::diff_file,
            crate::commands::files::write_file,
            crate::commands::files::delete_file,
            crate::commands::files::write_temp_file,
            crate::commands::files::os_temp_dir,
            crate::commands::files::home_dir,
            crate::commands::files::goat_agent_dir,
            crate::commands::files::list_dir_abs,
            crate::commands::files::read_text_file_abs,
            crate::commands::files::path_exists_abs,
            crate::commands::files::create_dir_abs,
            crate::commands::files::copy_dir_abs,
            crate::commands::files::resource_dir,
            crate::commands::files::write_skill_file,
            crate::commands::tools::edit_file,
            crate::commands::tools::exec_command,
            crate::commands::tools::read_lints,
            crate::commands::workspace::list_workspaces,
            crate::commands::workspace::add_workspace,
            crate::commands::workspace::remove_workspace,
            crate::commands::workspace::get_workspace_denylist,
            crate::commands::workspace::set_workspace_denylist,
            crate::commands::latex::compile_latex,
            crate::commands::misc::run_python,
            crate::commands::embeddings::workspace_chunks,
            crate::commands::embeddings::embeddings_insert,
            crate::commands::embeddings::embeddings_search,
            crate::commands::embeddings::embeddings_clear,
            crate::commands::embeddings::embeddings_count,
            crate::commands::extract::read_pdf,
            crate::commands::extract::extract_pdf_text,
            crate::commands::extract::office::extract_docx_text,
            crate::commands::extract::office::extract_pptx_text,
            crate::commands::extract::office::extract_xlsx_text,
            crate::commands::extract::ocr_audio::ocr_available,
            crate::commands::extract::ocr_audio::ocr_image,
            crate::commands::extract::ocr_audio::audio_transcription_available,
            crate::commands::extract::ocr_audio::transcribe_audio,
            crate::commands::memory::memory_insert,
            crate::commands::memory::memory_list,
            crate::commands::memory::memory_delete,
            crate::commands::memory::memory_search,
            crate::commands::memory::memory_search_text,
            crate::commands::memory::memory_increment_uses,
            crate::commands::memory::memory_update,
            crate::commands::memory::memory_settings_load,
            crate::commands::memory::memory_settings_save,
            crate::commands::documents::document_workspaces_load,
            crate::commands::documents::document_workspace_save,
            crate::commands::documents::document_workspace_delete,
            crate::commands::documents::document_chunks_replace,
            crate::commands::documents::document_chunks_delete,
            crate::commands::documents::document_chunks_search,
            crate::commands::scheduled_agents::scheduled_agents_load,
            crate::commands::scheduled_agents::scheduled_agents_save,
            crate::commands::misc::watch_workspace,
            crate::commands::misc::unwatch_workspace,
            crate::commands::misc::sync_export_state,
            crate::commands::misc::sync_import_state,
            crate::ollama::ollama_system_info,
            crate::ollama::ollama_status,
            crate::ollama::ollama_start,
            crate::ollama::ollama_stop,
            crate::mcp::mcp_stdio_spawn,
            crate::mcp::mcp_stdio_send,
            crate::mcp::mcp_stdio_disconnect,
            crate::jj::is_jj_installed,
            crate::jj::is_jj_repo,
            crate::jj::jj_new,
            crate::jj::jj_squash,
            crate::jj::jj_describe,
            crate::jj::jj_abandon,
            crate::searxng::searxng_status,
            crate::searxng::searxng_start,
            crate::searxng::searxng_stop,
            crate::searxng::searxng_install_docker,
            crate::searxng::searxng_start_docker_daemon,
        ]
    };
}

pub(crate) use generate_handler;
