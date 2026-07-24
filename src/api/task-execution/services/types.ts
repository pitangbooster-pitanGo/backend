import type { TaskSnapshot, TrackSnapshot } from '../../track/services/track-versioning';

export type TaskEntity = {
  id: number;
  documentId?: string | null;
  order_index: number;
  publishedAt?: string | null;
  requires_manual_approval?: boolean | null;
  requires_evidence?: boolean | null;
  depends_on?: Array<{ id: number }> | null;
};

export type TrackAssignmentEntity = {
  id: number;
  status?: string | null;
  progress_percentage?: number | string | null;
  started_at?: string | null;
  completed_at?: string | null;
  track?: {
    id: number;
  } | null;
  track_snapshot?: TrackSnapshot | null;
};

export type TaskExecutionEntity = {
  id: number;
  execution_status?: string | null;
  track_assignment?: {
    id: number;
    user?: { id: number } | null;
  } | null;
  task?: TaskEntity | null;
  task_source_document_id?: string | null;
  task_snapshot?: TaskSnapshot | null;
  evidences?: Array<{ id: number }> | null;
};
