/* NEST :: pin the search path on the four small helpers the security advisor
   named. None of them touches a table by an unqualified name that a caller
   could shadow, but a pinned path costs nothing and closes the class. */
alter function nest_private.valid_day(date) set search_path = public;
alter function nest_private.dome_state(public.nests) set search_path = public;
alter function nest_private.as_date(text) set search_path = public;
alter function nest_private.int_or(text, integer) set search_path = public;
