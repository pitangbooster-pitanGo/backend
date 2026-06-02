export type TaskEntity = {
  id: number;
  documentId?: string | null;
  order_index: number;
  publishedAt?: string | null;
  requires_manual_approval?: boolean | null;
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
};

export type TaskExecutionEntity = {
  id: number;
  execution_status?: string | null;
  track_assignment?: {
    id: number;
    user?: { id: number } | null;
  } | null;
  task?: TaskEntity | null;
};
