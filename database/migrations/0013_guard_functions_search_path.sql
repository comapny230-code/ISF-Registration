-- 0013: fixed search_path for the booking guard trigger functions (Supabase security advisor,
-- lint 0011 "function_search_path_mutable"). With an empty search_path a function cannot be
-- steered to another schema's objects by whoever calls it; every table these functions use is
-- already schema-qualified, and built-in functions (pg_catalog) are always found.

alter function booking.teams_guard() set search_path = '';
alter function booking.reservations_guard() set search_path = '';
alter function booking.audit_events_append_only() set search_path = '';
alter function booking.stalls_guard() set search_path = '';
