/**
  @file
  @brief Return the Macro Dash leaderboard
  @details Top 10 runs.  Finishers (done=1) rank by elapsed time (fastest
  wins, score breaks ties); DNFs (done=0) follow, most-recent first.  An
  empty table is returned when the backend is not configured or no scores
  exist yet.

  <h4> SAS Macros </h4>
  @li md_init.sas
  @li mf_existds.sas
**/

%md_init()

/* An empty table of the right shape.  A DATA step with LENGTH and STOP is the
   obvious construct, and on SAS 9.4M9 it fails: "ERROR: Variable rank is
   uninitialized." per column, after which OBS=0 suppresses md_read()'s result
   and the board is empty however many scores exist. */
proc sql;
  create table scores
    (rank num, name char(12), time num, score num, amps num, done num);
quit;

%macro md_read();
%if %length(&md_rootdir)>0 and %mf_existds(sb.scores) %then %do;
  proc sql;
    create table scores as
    select name, time, score, amps, done,
      monotonic() as rank
    from sb.scores
    order by done desc, time, score desc, submitted desc
    ;
  quit;

  data scores;
    set scores(obs=10);
  run;
%end;
%mend md_read;
%md_read()

%webout(OPEN)
%webout(OBJ,scores)
%webout(CLOSE)
