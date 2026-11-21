export type Role = 'owner' | 'caretaker' | 'member';
export type MemberStatus = 'pending' | 'active' | 'removed';
export type BillingMode = 'monthly' | 'per_session';
export type SubStatus = 'active' | 'past_due' | 'suspended';
export type TrainingStatus = 'scheduled' | 'cancelled' | 'settled';
export type SignupStatus = 'main' | 'reserve' | 'late_cancel';
export type TxType = 'payment' | 'monthly_fee' | 'session_fee' | 'late_cancel_fee' | 'adjustment';
export type PlanCode = 'FREE' | 'CLUB_50' | 'CLUB_100' | 'CUSTOM';

export interface Profile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  is_superadmin: boolean;
}

export interface Membership {
  club_id: string;
  club_name: string;
  prefix: string;
  role: Role;
  status: MemberStatus;
  member_code: string | null;
  subscription_status: SubStatus;
}

export interface ClubInfo {
  id: string;
  name: string;
  prefix: string;
  invite_code: string;
  bank_account: string | null;
  bank_recipient: string | null;
  monthly_fee_amount: number;
  single_training_fee_amount: number;
  cancellation_deadline_hours: number;
  default_max_participants: number;
  default_location: string | null;
}

export interface PlatformInfo {
  plan: PlanCode;
  monthly_amount: number;
  unpaid_amount: number;
  unpaid_count: number;
  grace_period_days: number;
  suspend_after_days: number;
  bank_account: string | null;
  bank_recipient: string | null;
  platform_name: string;
  contact_email: string | null;
}

export interface ClubContextData {
  club: ClubInfo;
  my_role: Role | null;
  my_member_id: string | null;
  my_member_code: string | null;
  my_billing_mode: BillingMode | null;
  my_position?: string | null;
  subscription_status: SubStatus;
  is_superadmin: boolean;
  balances_updated_at?: string | null;
  last_import_at?: string | null;
  bank_data_until?: string | null;
  platform?: PlatformInfo;
  pending_members?: number;
}

export interface ClubMemberRow {
  id: string;
  user_id: string;
  role: Role;
  status: MemberStatus;
  billing_mode: BillingMode;
  member_code: string | null;
  position?: string | null;
  profiles: { full_name: string | null; avatar_url: string | null } | null;
}

export interface SignupLite {
  user_id: string;
  status: SignupStatus;
}

export interface Training {
  id: string;
  club_id: string;
  title: string;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  max_participants: number;
  notes: string | null;
  status: TrainingStatus;
  settled_at?: string | null;
  training_signups?: SignupLite[];
}

export interface Signup {
  id: string;
  training_id: string;
  user_id: string;
  status: SignupStatus;
  has_car: boolean;
  wants_beer: boolean;
  added_by_staff: boolean;
  signed_up_at: string;
}

export interface Attendance {
  user_id: string;
  present: boolean;
}

export interface Transaction {
  id: string;
  club_id: string;
  user_id: string;
  amount: number;
  type: TxType;
  description: string | null;
  booked_at: string;
  created_at: string;
}

export interface AdminMember {
  member_id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: Role;
  status: MemberStatus;
  billing_mode: BillingMode;
  member_code: string | null;
  aliases: string[];
  balance: number;
  joined_at: string | null;
  created_at: string;
}

export interface TeamMember {
  member_id: string;
  user_id: string;
  full_name: string | null;
  member_code: string | null;
  role: Role;
  billing_mode: BillingMode;
  balance: number;
  last_payment_at: string | null;
  last_present_at: string | null;
}

export interface SaClub {
  club_id: string;
  name: string;
  prefix: string;
  invite_code: string;
  created_at: string;
  plan: PlanCode;
  monthly_amount: number;
  status: SubStatus;
  grace_period_days: number;
  suspend_after_days: number;
  unlock_until: string | null;
  unpaid_amount: number;
  unpaid_count: number;
  last_paid_at: string | null;
  active_members: number;
  pending_members: number;
  owners: string | null;
  pending_owner_email: string | null;
}

export interface PlatformInvoice {
  id: string;
  club_id: string;
  period: string;
  amount: number;
  status: 'unpaid' | 'paid' | 'void';
  issued_at: string;
  paid_at: string | null;
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Właściciel',
  caretaker: 'Opiekun',
  member: 'Zawodnik',
};

export const BILLING_LABEL: Record<BillingMode, string> = {
  monthly: 'Składka miesięczna (wynajem sali)',
  per_session: 'Płatność za trening',
};

export const TX_LABEL: Record<TxType, string> = {
  payment: 'Wpłata',
  monthly_fee: 'Składka za wynajem sali',
  session_fee: 'Opłata za trening',
  late_cancel_fee: 'Późne wypisanie',
  adjustment: 'Korekta',
};

export const PLAN_LABEL: Record<PlanCode, string> = {
  FREE: 'FREE (0 zł)',
  CLUB_50: 'CLUB_50 (50 zł)',
  CLUB_100: 'CLUB_100 (100 zł)',
  CUSTOM: 'Własna kwota',
};

export const SUB_LABEL: Record<SubStatus, string> = {
  active: 'Aktywny',
  past_due: 'Zaległość',
  suspended: 'Zawieszony',
};
