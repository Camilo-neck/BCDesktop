// Mirrors of the Rust types in crates/bc-core (serde camelCase).

export type Day = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
export const DAYS: Day[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export type Typology =
  | "FUND_OBLIGATORIA"
  | "FUND_OPTATIVA"
  | "DISC_OBLIGATORIA"
  | "DISC_OPTATIVA"
  | "LIBRE_ELECCION"
  | "NIVELACION"
  | "TRABAJO_GRADO"
  | "OTHER";

export interface Session {
  day: Day;
  /** Minutes since midnight. */
  start: number;
  end: number;
  room: string;
}

export interface Group {
  id: string;
  label: string;
  professors: string[];
  faculty: string;
  sessions: Session[];
  duration: string;
  shift: string;
  spots: number | null;
  startsOn: string | null;
  endsOn: string | null;
}

export interface CareerRef {
  level: string;
  campus: string;
  faculty: string;
  plan: string;
  name: string;
  electives: boolean;
}

export interface Course {
  code: string;
  name: string;
  credits: number;
  typology: Typology;
  groups: Group[];
  fetchedAt: string;
  source: "sia" | "manual";
  career: CareerRef | null;
}

export interface CourseSummary {
  code: string;
  name: string;
  credits: number | null;
  typology: Typology;
  row: number;
}

export interface LibraryCourse {
  course: Course;
  color: string;
  addedAt: string;
}

export interface Selection {
  courseCode: string;
  groupId: string;
}

export interface Block {
  day: Day;
  start: number;
  end: number;
  label: string;
}

export interface Schedule {
  id: string;
  name: string;
  selections: Selection[];
  blocks: Block[];
  createdAt: string;
  updatedAt: string;
}

export interface DropdownOption {
  value: string;
  label: string;
}

export interface Library {
  courses: LibraryCourse[];
  favorites: Selection[];
}

export interface FetchReport {
  updated: string[];
  failed: { code: string; message: string }[];
}

export type TimeOfDay = "any" | "morning" | "afternoon" | "evening";

export interface Constraints {
  days: Day[];
  window: [number, number] | null;
  maxCredits: number | null;
  onlyWithSpots: boolean;
  blocks: Block[];
  locked: Selection[];
  excluded: Selection[];
}

export interface Preferences {
  gaps: number;
  days: number;
  timeOfDay: TimeOfDay;
  favorites: Selection[];
  spots: number;
}

export interface GenerateRequest {
  courses: Course[];
  constraints: Constraints;
  preferences: Preferences;
  limit: number;
}

export interface Metrics {
  gapMinutes: number;
  days: number;
  credits: number;
  earliest: number;
  latest: number;
  favorites: number;
  minSpots: number | null;
}

export interface GeneratedSchedule {
  selections: Selection[];
  omitted: string[];
  score: number;
  metrics: Metrics;
}

export interface GenerateResult {
  schedules: GeneratedSchedule[];
  unschedulable: { code: string; name: string; reason: string }[];
  complete: boolean;
  explored: number;
  truncated: boolean;
}

export interface CreditSummary {
  required: number;
  approved: number;
  pending: number;
  enrolled: number;
  taken: number;
  progress: number;
}

export interface TakenCourse {
  code: string;
  name: string;
  credits: number;
  typology: Typology;
  typologyLabel: string;
  period: string;
  grade: number | null;
  passed: boolean;
}

export interface Period {
  name: string;
  courses: TakenCourse[];
  credits: number;
  levelingCredits: number;
  approvedCredits: number;
  approvedLevelingCredits: number;
  ungradedCredits: number;
  papi: number | null;
  papa: number | null;
  pa: number | null;
  progress: number;
  accumulatedProgress: number;
}

export interface AcademicHistory {
  username: string | null;
  plan: string;
  faculty: string;
  status: string;
  papa: number | null;
  pa: number | null;
  credits: Record<string, CreditSummary>;
  progress: number;
  progressFundamental: number;
  progressDisciplinary: number;
  progressElectives: number;
  surplusCredits: number;
  cancelledCredits: number;
  quota: { additional: number; quota: number; available: number; doubleDegree: number };
  periods: Period[];
  averageProgress: number;
  coursesSeen: number;
  highestGrade: number;
  highestGradeCount: number;
  lowestGrade: number;
  lowestGradeCount: number;
}

export interface StoredHistory {
  id: number;
  history: AcademicHistory;
  createdAt: string;
}

export interface Projection {
  currentPapa: number;
  approvedCredits: number;
  value: number;
  reachable: boolean;
}

export interface Condition {
  number: number;
  kind: string;
  all: boolean;
  required: number | null;
  courses: { code: string; name: string }[];
}

export type NodeStatus = "approved" | "available" | "locked" | "external";

export interface GraphNode {
  code: string;
  name: string;
  credits: number;
  typology: Typology;
  status: NodeStatus;
  layer: number;
  order: number;
  conditions: Condition[];
  unlocks: string[];
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: string;
  condition: number;
  all: boolean;
}

export interface CurriculumGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  layers: number;
  stats: { courses: number; approved: number; available: number; locked: number; approvedCredits: number };
}

export interface PlanSummary {
  careerKey: string;
  careerName: string;
  fetchedAt: string;
}

export interface Professor {
  name: string;
  url: string;
  rating: number | null;
  gradeAverage: number | null;
  approvalRatio: number | null;
  reviews: number;
  departments: string[];
}

export interface Term {
  from: string;
  until: string;
  useGroupDates: boolean;
}

export interface GoogleAccount {
  email: string;
  name: string | null;
  picture: string | null;
}

export interface AppInfo {
  version: string;
  dataDir: string;
  os: string;
  arch: string;
  googleConfigured: boolean;
}

export interface Progress {
  task: "courses" | "plan" | "google";
  done: number;
  total: number;
  current: string;
}

export interface CoreError {
  kind: string;
  message: string;
}
