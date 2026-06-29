// Thin wrappers over the Tauri commands. Mirrors src-tauri/src/commands.rs (camelCase contract).
import { invoke } from "@tauri-apps/api/core";
import type { Transcript, RecordWithHistory, MicStatus, FlagHit, NewRecordInput } from "./types";

// 02 Voice capture (mic via cpal + whisper.cpp, all on-device).
export const startRecording  = ()                  => invoke<void>("start_recording");
export const recordingStatus = ()                  => invoke<MicStatus | null>("recording_status");
export const stopRecording   = ()                  => invoke<string>("stop_recording");        // → wav path
export const transcribe      = (audioPath: string) => invoke<Transcript>("transcribe", { audioPath });

// 03 / 05 records (bodies land in Phase 2/3/5).
export const saveRecord   = (rec: NewRecordInput)                          => invoke<string>("save_record", { rec });
export const amendRecord  = (id: string, changes: unknown, reason: string) => invoke<number>("amend_record", { id, changes, reason });
export const getRecord    = (id: string)                                   => invoke<RecordWithHistory>("get_record", { id });
export const listRecords  = ()                                             => invoke<unknown[]>("list_records");

// 04 Safety flags (deterministic, offline rules + OSHA context).
export const scanFlags = (narrative: string, tradeNaics?: string) =>
  invoke<FlagHit[]>("scan_flags", { narrative, tradeNaics });
